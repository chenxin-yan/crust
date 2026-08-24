import { isDeepStrictEqual } from "node:util";
// ────────────────────────────────────────────────────────────────────────────
// @crustjs/store — createStore factory and async object-store API
// ────────────────────────────────────────────────────────────────────────────

import { isJsonObject, type JsonValue } from "@crustjs/utils/json";
import { coerceBooleanString, tryCoerceNumber } from "@crustjs/utils/primitive";
import { normalizeStandardIssues, type StandardSchema } from "@crustjs/utils/schema";

import { CrustStoreError } from "./errors.ts";
import { applyFieldDefaults } from "./merge.ts";
import { resolveStorePath } from "./path.ts";
import { deleteJson, readJson, type WriteJsonOptions, writeJson } from "./persistence.ts";
import type {
	CreateStoreOptions,
	FieldDef,
	FieldsDef,
	InferStoreConfig,
	Store,
	StoreDocument,
	StoreUpdater,
	StoreValidatorIssue,
} from "./types.ts";

type FieldValidationResult = void | { value: JsonValue | undefined };
type FieldValidator = (
	value: JsonValue | undefined,
) => FieldValidationResult | Promise<FieldValidationResult>;

function makeSchemaValidator(schema: StandardSchema<unknown, unknown>): FieldValidator {
	return async (value) => {
		const result = await schema["~standard"].validate(value);
		if (result.issues) {
			const normalized = normalizeStandardIssues(result.issues);
			const messages = normalized.map((issue) =>
				issue.path ? `${issue.path}: ${issue.message}` : issue.message,
			);
			throw new Error(messages.join("; "));
		}
		// SAFETY: createStore's field constraint only admits recursively JSON-compatible schema outputs.
		return { value: result.value as JsonValue | undefined };
	};
}

/** Narrow a field validator return to the exact transform-result shape. */
function isFieldValueResult(
	result: Awaited<ReturnType<FieldValidator>>,
): result is { value: JsonValue | undefined } {
	return (
		typeof result === "object" &&
		result !== null &&
		Object.hasOwn(result, "value") &&
		Object.keys(result).length === 1
	);
}

function isString(value: JsonValue | undefined): value is string {
	return typeof value === "string";
}

// ────────────────────────────────────────────────────────────────────────────
// createStore — Public factory
// ────────────────────────────────────────────────────────────────────────────

/**
 * Creates a typed async config store backed by a local JSON file.
 *
 * The store resolves its file path once at creation time from `dirPath` and
 * `name`. Core field definitions infer from `type` and `default`;
 * schema-backed fields use the Standard Schema's exact output type.
 *
 * @typeParam F - Field definitions record (inferred via `const` generic).
 * @param options - Store configuration options.
 * @returns A {@link Store} instance with `read`, `write`, `update`, `patch`, and `reset` methods.
 * @throws {CrustStoreError} `PATH` if `dirPath` or `name` is invalid.
 *
 * @example
 * ```ts
 * import { createStore, configDir } from "@crustjs/store";
 *
 * const store = createStore({
 *   dirPath: configDir("my-cli"),
 *   name: "config",
 *   fields: {
 *     theme: { type: "string", default: "light" },
 *     verbose: { type: "boolean", default: false },
 *     token: { type: "string" },
 *   },
 * });
 *
 * const config = await store.read();
 * // → { theme: "light", verbose: false, token: undefined }
 *
 * await store.write({ theme: "dark", verbose: true, token: "abc" });
 * await store.update((c) => ({ ...c, theme: "light" }));
 * await store.patch({ theme: "solarized" });
 * await store.reset();
 * ```
 */
export function createStore<const F extends FieldsDef>(
	options: CreateStoreOptions<F>,
): Store<InferStoreConfig<F>> {
	const { dirPath, name, fields, pruneUnknown, access } = options;
	type Config = InferStoreConfig<F>;
	const validators = new Map<string, FieldValidator>();

	function configFromDocument(document: StoreDocument): Config {
		// SAFETY: this conversion is used only after normalization and either validation or before a full validated replacement.
		return document as Config;
	}

	function documentFromConfig(config: Config): StoreDocument {
		// SAFETY: field definitions constrain config values and schema outputs to JSON-compatible values.
		return { ...config } as StoreDocument;
	}

	for (const [key, def] of Object.entries(fields)) {
		if (def.schema !== undefined) {
			for (const option of ["default", "validate"] as const) {
				if (def[option] !== undefined) {
					throw new CrustStoreError(
						"DEFINITION",
						`field "${key}" mixes "schema" with "${option}" — the schema exclusively owns validation, transformation, defaults, and optionality`,
					);
				}
			}
			validators.set(key, makeSchemaValidator(def.schema));
		} else if (def.validate !== undefined) {
			// SAFETY: each validator is only called for its own field. Coercion does not guarantee the
			// persisted value matches the validator's declared parameter type: corrupt files can hand a
			// wrong-typed value to it, which surfaces as a validator throw → VALIDATION issue.
			validators.set(key, def.validate as FieldValidator);
		}
	}

	// Resolve the config file path once at creation time (synchronous)
	const filePath = resolveStorePath(dirPath, name);

	// Resolve pruneUnknown — defaults to true when not provided
	const shouldPrune = pruneUnknown ?? true;

	// Permission bits forwarded to every write (default → platform behavior).
	const writeOptions: WriteJsonOptions =
		access === "private"
			? { fileMode: 0o600, directoryMode: 0o700 }
			: access === undefined || access === "default"
				? {}
				: { fileMode: access.file, directoryMode: access.directory };

	// ──────────────────────────────────────────────────────────────────────
	// normalizeStateTypes — Coerce values by field `type`
	// ──────────────────────────────────────────────────────────────────────

	function coerceByType(value: JsonValue, type: FieldDef["type"]): JsonValue {
		if (type === undefined) return value;
		if (type === "number" && isString(value)) {
			return tryCoerceNumber(value) ?? value;
		}

		if (type === "boolean" && isString(value)) {
			return coerceBooleanString(value);
		}

		return value;
	}

	function normalizeStateTypes(state: StoreDocument): StoreDocument {
		const normalized = { ...state };

		for (const [key, def] of Object.entries(fields)) {
			if (!(key in normalized) || def.schema !== undefined) continue;

			const value = normalized[key];
			if (value === undefined) continue;

			if (def.array === true && Array.isArray(value)) {
				normalized[key] = value.map((item) => coerceByType(item, def.type));
				continue;
			}

			normalized[key] = coerceByType(value, def.type);
		}

		return normalized;
	}

	// ──────────────────────────────────────────────────────────────────────
	// runFieldValidators — Execute per-field validate functions
	// ──────────────────────────────────────────────────────────────────────

	async function runFieldValidators(
		mutableState: StoreDocument,
		operation: "read" | "write" | "update" | "patch",
	): Promise<void> {
		const issues: StoreValidatorIssue[] = [];

		for (const [key, def] of Object.entries(fields)) {
			const validator = validators.get(key);
			if (!validator) continue;

			const value = mutableState[key];

			if (value === undefined && def.schema === undefined) continue;

			let result: Awaited<ReturnType<FieldValidator>>;
			try {
				result = await validator(value);
			} catch (cause) {
				const message = cause instanceof Error ? cause.message : "Validation failed";
				issues.push({ message, path: key });
				continue;
			}

			// Validation-only: validator returned no transformed value.
			if (result === undefined) continue;

			// Transform path: validator returned `{ value }`.
			if (isFieldValueResult(result)) {
				const transformed = result.value;

				// On read, preserve persisted values verbatim, but allow schemas to
				// materialize missing values by validating `undefined` (e.g. defaults).
				if (operation === "read") {
					if (value === undefined) mutableState[key] = transformed;
					continue;
				}

				// Persist-time path: if the transform changed the value,
				// re-validate the output once. This catches cross-type
				// transforms like `z.string().transform(Number)` whose output
				// would fail the schema on the next read. Compare structurally
				// because Standard Schema parsers (e.g. Zod arrays/objects)
				// return fresh references even when contents are identical.
				if (!isDeepStrictEqual(transformed, value)) {
					let recheck: Awaited<ReturnType<FieldValidator>>;
					try {
						recheck = await validator(transformed);
					} catch (cause) {
						const message = cause instanceof Error ? cause.message : "re-validation failed";
						issues.push({
							message: `read-unstable transform: ${message}`,
							path: key,
						});
						continue;
					}

					// Recheck must accept the transformed value: either `void`
					// (validation-only contract) or `{ value }` that is
					// structurally stable under another round of the same
					// transform. Anything else means the next read would see a
					// different value than the one we'd persist now.
					if (
						recheck !== undefined &&
						(!isFieldValueResult(recheck) || !isDeepStrictEqual(recheck.value, transformed))
					) {
						issues.push({
							message: `read-unstable transform: output would be transformed again on re-read`,
							path: key,
						});
						continue;
					}

					mutableState[key] = transformed;
				}
			}
		}

		if (issues.length > 0) {
			const lines = issues.map((i) => `  - ${i.path}: ${i.message}`);
			const message = `Store validation failed (${operation})\n${lines.join("\n")}`;

			throw new CrustStoreError("VALIDATION", message, {
				operation,
				issues,
			});
		}
	}

	// ──────────────────────────────────────────────────────────────────────
	// readRaw — Load persisted config, apply field defaults (no validation)
	// ──────────────────────────────────────────────────────────────────────

	async function readRaw(): Promise<StoreDocument> {
		const persisted = await readJson(filePath);
		const persistedObject =
			persisted !== undefined && isJsonObject(persisted) ? persisted : undefined;
		if (persisted !== undefined && persistedObject === undefined) {
			// A syntactically valid non-object root is still corrupt store data; do not silently reset it.
			throw new CrustStoreError("PARSE", `Expected a JSON object in config file: ${filePath}`, {
				path: filePath,
			});
		}
		const merged = applyFieldDefaults(persistedObject, fields, shouldPrune);
		return normalizeStateTypes(merged);
	}

	// ──────────────────────────────────────────────────────────────────────
	// read — Load persisted config, apply field defaults, validate
	// ──────────────────────────────────────────────────────────────────────

	async function read(): Promise<Config> {
		const document = await readRaw();
		await runFieldValidators(document, "read");
		return configFromDocument(document);
	}

	// ──────────────────────────────────────────────────────────────────────
	// write — Validate then atomically persist full config
	// ──────────────────────────────────────────────────────────────────────

	async function write(config: Config): Promise<void> {
		const normalized = normalizeStateTypes(documentFromConfig(config));
		await runFieldValidators(normalized, "write");
		await writeJson(filePath, normalized, writeOptions);
	}

	// ──────────────────────────────────────────────────────────────────────
	// update — Read current (raw), apply updater, validate, persist
	// ──────────────────────────────────────────────────────────────────────

	async function update(updater: StoreUpdater<Config>): Promise<void> {
		const current = await readRaw();
		const updated = updater(configFromDocument(current));
		const normalized = normalizeStateTypes(documentFromConfig(updated));
		await runFieldValidators(normalized, "update");
		await writeJson(filePath, normalized, writeOptions);
	}

	// ──────────────────────────────────────────────────────────────────────
	// patch — Shallow merge into current config, validate, persist
	// ──────────────────────────────────────────────────────────────────────

	async function patch(partial: Partial<Config>): Promise<void> {
		const current = await readRaw();
		const normalized = normalizeStateTypes({ ...current, ...partial });
		await runFieldValidators(normalized, "patch");
		await writeJson(filePath, normalized, writeOptions);
	}

	// ──────────────────────────────────────────────────────────────────────
	// reset — Remove persisted config file
	// ──────────────────────────────────────────────────────────────────────

	async function reset(): Promise<void> {
		await deleteJson(filePath);
	}

	return { read, write, update, patch, reset };
}
