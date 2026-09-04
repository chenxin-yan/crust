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
	FieldsDef,
	InferStoreConfig,
	Store,
	StoreDocument,
	StoreUpdater,
	StoreValidatorIssue,
	ValueType,
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

function matchesDeclaredType(
	def: { type: ValueType; array?: true },
	value: JsonValue | undefined,
): boolean {
	const matches = (item: JsonValue | undefined) => {
		// oxlint-disable-next-line anti-slop/no-runtime-typeof -- comparing against the declared field type.
		return typeof item === def.type && (def.type !== "number" || Number.isFinite(item));
	};
	return def.array === true ? Array.isArray(value) && value.every(matches) : matches(value);
}

function expectedTypeMessage(def: { type: ValueType; array?: true }): string {
	return `Expected ${def.type}${def.array === true ? "[]" : ""}`;
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
			// SAFETY: each validator is only called for its own field after coercion and type checking.
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

	function coerceByType(value: JsonValue, type: ValueType): JsonValue {
		// oxlint-disable-next-line anti-slop/no-runtime-typeof -- typed store values are coerced by their declaration.
		if (type === "number" && typeof value === "string") {
			return tryCoerceNumber(value) ?? value;
		}

		// oxlint-disable-next-line anti-slop/no-runtime-typeof -- typed store values are coerced by their declaration.
		if (type === "boolean" && typeof value === "string") {
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
			const value = mutableState[key];

			if (value === undefined && def.schema === undefined) continue;

			if (value !== undefined && def.schema === undefined && !matchesDeclaredType(def, value)) {
				issues.push({ message: expectedTypeMessage(def), path: key });
				continue;
			}

			const validator = validators.get(key);
			if (!validator) continue;

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

				// Core transforms must stay within the declared type; a wrong-typed
				// output would persist a value the next read() rejects.
				if (def.schema === undefined && !matchesDeclaredType(def, transformed)) {
					issues.push({ message: expectedTypeMessage(def), path: key });
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

		// Mutations promise to return exactly what the next read() sees, so any
		// value JSON serialization would alter (NaN/Infinity → null, -0 → 0,
		// array holes → null, dropped undefined object properties) is rejected.
		if (operation !== "read") {
			for (const [key, value] of Object.entries(mutableState)) {
				// A dropped undefined key is harmless: the next read reapplies defaults identically.
				if (value === undefined) continue;
				if (!isDeepStrictEqual(JSON.parse(JSON.stringify(value)), value)) {
					issues.push({
						message:
							"value does not survive JSON serialization (NaN, Infinity, -0, sparse arrays, or undefined properties)",
						path: key,
					});
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
	// readRaw — Load persisted config and materialize defaults without rejecting
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
		for (const [key, def] of Object.entries(fields)) {
			if (merged[key] !== undefined || def.schema === undefined) continue;
			try {
				const result = await validators.get(key)?.(undefined);
				if (result !== undefined && isFieldValueResult(result)) merged[key] = result.value;
			} catch {
				// Required schemas are validated after the updater or patch can supply a value.
			}
		}
		return normalizeStateTypes(merged);
	}

	// ──────────────────────────────────────────────────────────────────────
	// read — Load persisted config, apply field defaults, validate
	// ──────────────────────────────────────────────────────────────────────

	async function read(): Promise<Config> {
		const document = await readRaw();
		await runFieldValidators(document, "read");
		// SAFETY: the document was normalized and validated against every field definition.
		return document as Config;
	}

	// ──────────────────────────────────────────────────────────────────────
	// write — Validate then atomically persist full config
	// ──────────────────────────────────────────────────────────────────────

	async function write(config: Config): Promise<Config> {
		// SAFETY: field definitions constrain config values and schema outputs to JSON-compatible values.
		const normalized = normalizeStateTypes({ ...config } as StoreDocument);
		await runFieldValidators(normalized, "write");
		await writeJson(filePath, normalized, writeOptions);
		// SAFETY: the normalized document was validated against every field definition.
		return normalized as Config;
	}

	// ──────────────────────────────────────────────────────────────────────
	// update — Read current effective state, apply updater, validate, persist
	// ──────────────────────────────────────────────────────────────────────

	async function update(updater: StoreUpdater<Config>): Promise<Config> {
		const current = await readRaw();
		// SAFETY: readRaw normalizes the current document against the field definitions.
		const updated = updater(current as Config);
		// SAFETY: field definitions constrain updater output to JSON-compatible values.
		const normalized = normalizeStateTypes({ ...updated } as StoreDocument);
		await runFieldValidators(normalized, "update");
		await writeJson(filePath, normalized, writeOptions);
		// SAFETY: the normalized document was validated against every field definition.
		return normalized as Config;
	}

	// ──────────────────────────────────────────────────────────────────────
	// patch — Shallow merge into current config, validate, persist
	// ──────────────────────────────────────────────────────────────────────

	async function patch(partial: Partial<Config>): Promise<Config> {
		const current = await readRaw();
		const normalized = normalizeStateTypes({ ...current, ...partial });
		await runFieldValidators(normalized, "patch");
		await writeJson(filePath, normalized, writeOptions);
		// SAFETY: the merged document was normalized and validated against every field definition.
		return normalized as Config;
	}

	// ──────────────────────────────────────────────────────────────────────
	// reset — Remove persisted config file
	// ──────────────────────────────────────────────────────────────────────

	async function reset(): Promise<void> {
		await deleteJson(filePath);
	}

	return { read, write, update, patch, reset };
}
