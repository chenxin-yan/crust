// ────────────────────────────────────────────────────────────────────────────
// @crustjs/store — createStore factory and async object-store API
// ────────────────────────────────────────────────────────────────────────────

import { isDeepStrictEqual } from "node:util";

import { isJsonObject, type JsonValue } from "@crustjs/utils/json";
import { coerceBooleanString, tryCoerceNumber } from "@crustjs/utils/primitive";
import { normalizeStandardIssues, type StandardSchema } from "@crustjs/utils/schema";

import { CrustStoreError, type ValidationErrorDetails } from "./errors.ts";
import { applyFieldDefaults, setDocumentValue, withUnknownKeys } from "./merge.ts";
import { resolveStorePath } from "./path.ts";
import {
	deleteJson,
	readJson,
	withFileLock,
	type WriteJsonOptions,
	writeJson,
} from "./persistence.ts";
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
		return typeof item === def.type && (def.type !== "number" || Number.isFinite(item));
	};
	return def.array === true ? Array.isArray(value) && value.every(matches) : matches(value);
}

function expectedTypeMessage(def: { type: ValueType; array?: true }): string {
	return `Expected ${def.type}${def.array === true ? "[]" : ""}`;
}

function coerceByType(value: JsonValue, type: ValueType): JsonValue {
	if (type === "number" && typeof value === "string") {
		return tryCoerceNumber(value) ?? value;
	}

	if (type === "boolean" && typeof value === "string") {
		return coerceBooleanString(value);
	}

	return value;
}

/**
 * Re-validates a changed transform output once. This catches cross-type
 * transforms like `z.string().transform(Number)` whose output would fail the
 * schema on the next read.
 *
 * @returns The issue message when the next read would see a different value.
 */
async function readUnstableTransformMessage(
	validator: FieldValidator,
	transformed: JsonValue | undefined,
): Promise<string | undefined> {
	let recheck: Awaited<ReturnType<FieldValidator>>;
	try {
		recheck = await validator(transformed);
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : "re-validation failed";
		return `read-unstable transform: ${message}`;
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
		return "read-unstable transform: output would be transformed again on re-read";
	}
	return undefined;
}

/**
 * Mutations promise to return exactly what the next read() sees, so any
 * value JSON serialization would alter (NaN/Infinity → null, -0 → 0,
 * array holes → null, dropped undefined object properties) is rejected.
 */
function jsonInstabilityIssues(document: StoreDocument): StoreValidatorIssue[] {
	const issues: StoreValidatorIssue[] = [];
	for (const [key, value] of Object.entries(document)) {
		// Required fields are type-checked separately; optional undefined can be omitted.
		if (value === undefined) continue;
		try {
			if (isDeepStrictEqual(JSON.parse(JSON.stringify(value)), value)) continue;
		} catch {
			// Cycles and other serialization failures use the same typed error path.
		}
		issues.push({
			message:
				"value does not survive JSON serialization (cycles, NaN, Infinity, -0, sparse arrays, or undefined properties)",
			path: key,
		});
	}
	return issues;
}

/** Tail of each store file's mutation queue, shared by every store instance in the process. */
const mutationQueues = new Map<string, Promise<unknown>>();

/** Runs `task` after every mutation already queued for `filePath` settles, in call order. */
function enqueue<T>(filePath: string, task: () => Promise<T>): Promise<T> {
	const run = (mutationQueues.get(filePath) ?? Promise.resolve()).then(task);
	const tail = run.catch(() => {});
	mutationQueues.set(filePath, tail);
	void tail.then(() => {
		if (mutationQueues.get(filePath) === tail) mutationQueues.delete(filePath);
	});
	return run;
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
 * @throws {CrustStoreError} `DEFINITION` if a field mixes `schema` with `default` or `validate`.
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

	const filePath = resolveStorePath(dirPath, name);

	// Permission bits forwarded to every write (default → platform behavior).
	const writeOptions: WriteJsonOptions =
		access === "private"
			? { fileMode: 0o600, directoryMode: 0o700 }
			: access === undefined || access === "default"
				? {}
				: { fileMode: access.file, directoryMode: access.directory };

	function normalizeStateTypes(state: StoreDocument): StoreDocument {
		const normalized = { ...state };

		for (const [key, def] of Object.entries(fields)) {
			if (!Object.hasOwn(normalized, key)) {
				// A missing field named like an inherited member (`constructor`, `toString`,
				// `__proto__`) would expose that member; store it as own `undefined` instead.
				if (key in normalized) setDocumentValue(normalized, key, undefined);
				continue;
			}
			if (def.schema !== undefined) continue;

			const value = normalized[key];
			if (value === undefined) continue;

			if (def.array === true && Array.isArray(value)) {
				setDocumentValue(
					normalized,
					key,
					value.map((item) => coerceByType(item, def.type)),
				);
				continue;
			}

			setDocumentValue(normalized, key, coerceByType(value, def.type));
		}

		return normalized;
	}

	async function runFieldValidators(
		mutableState: StoreDocument,
		operation: ValidationErrorDetails["operation"],
	): Promise<void> {
		const issues: StoreValidatorIssue[] = [];

		for (const [key, def] of Object.entries(fields)) {
			const value = Object.hasOwn(mutableState, key) ? mutableState[key] : undefined;

			if (value === undefined && def.schema === undefined) {
				if (def.default !== undefined) {
					issues.push({ message: expectedTypeMessage(def), path: key });
				}
				continue;
			}

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

				// Schemas own their output, including coercion and nested defaults.
				// Core callback transforms remain mutation-only; reads never persist.
				if (operation === "read") {
					if (def.schema !== undefined) setDocumentValue(mutableState, key, transformed);
					continue;
				}

				// Core transforms must stay within the declared type; a wrong-typed
				// output would persist a value the next read() rejects.
				if (def.schema === undefined && !matchesDeclaredType(def, transformed)) {
					issues.push({ message: expectedTypeMessage(def), path: key });
					continue;
				}

				// Persist-time path: if the transform changed the value, re-validate
				// it. Compare structurally because Standard Schema parsers (e.g. Zod
				// arrays/objects) return fresh references even when contents are identical.
				if (!isDeepStrictEqual(transformed, value)) {
					const unstable = await readUnstableTransformMessage(validator, transformed);
					if (unstable !== undefined) {
						issues.push({ message: unstable, path: key });
						continue;
					}
					setDocumentValue(mutableState, key, transformed);
				}
			}
		}

		if (operation !== "read") issues.push(...jsonInstabilityIssues(mutableState));

		if (issues.length > 0) {
			const lines = issues.map((i) => `  - ${i.path}: ${i.message}`);
			const message = `Store validation failed (${operation})\n${lines.join("\n")}`;

			throw new CrustStoreError("VALIDATION", message, {
				operation,
				issues,
			});
		}
	}

	async function readPersisted(): Promise<StoreDocument | undefined> {
		const persisted = await readJson(filePath);
		if (persisted === undefined || isJsonObject(persisted)) return persisted;
		// A syntactically valid non-object root is still corrupt store data; do not silently reset it.
		throw new CrustStoreError("PARSE", `Expected a JSON object in store file: ${filePath}`, {
			path: filePath,
		});
	}

	/** The declared fields of a persisted object, with defaults and core coercion applied. */
	function toDocument(persisted: StoreDocument | undefined): StoreDocument {
		return normalizeStateTypes(applyFieldDefaults(persisted, fields));
	}

	/** Serialized within the process, then locked across processes. */
	function mutate<T>(operation: "write" | "delete", task: () => Promise<T>): Promise<T> {
		return enqueue(filePath, () =>
			withFileLock(filePath, task, { operation, directoryMode: writeOptions.directoryMode }),
		);
	}

	async function read(): Promise<Config> {
		const document = toDocument(await readPersisted());
		await runFieldValidators(document, "read");
		// SAFETY: the document was normalized and validated against every field definition.
		return document as Config;
	}

	async function persist(
		document: StoreDocument,
		operation: Exclude<ValidationErrorDetails["operation"], "read">,
		persisted: StoreDocument | undefined,
	): Promise<Config> {
		const normalized = normalizeStateTypes(document);
		await runFieldValidators(normalized, operation);
		const output =
			pruneUnknown === true ? normalized : withUnknownKeys(normalized, persisted, fields);
		await writeJson(filePath, output, writeOptions);
		// SAFETY: the normalized document was validated against every field definition.
		return normalized as Config;
	}

	function write(config: Config): Promise<Config> {
		return mutate("write", async () => {
			// write() replaces a corrupt file, which leaves no unknown keys to keep.
			const persisted =
				pruneUnknown === true
					? undefined
					: await readPersisted().catch((err: unknown) => {
							if (err instanceof CrustStoreError && err.is("PARSE")) return undefined;
							throw err;
						});
			// SAFETY: field definitions constrain config values and schema outputs to JSON-compatible values.
			return persist({ ...config } as StoreDocument, "write", persisted);
		});
	}

	function update(updater: StoreUpdater<Config>): Promise<Config> {
		return mutate("write", async () => {
			const persisted = await readPersisted();
			const current = toDocument(persisted);
			await runFieldValidators(current, "read");
			// SAFETY: the document was normalized and validated against every field definition.
			const updated = updater(current as Config);
			// SAFETY: field definitions constrain updater output to JSON-compatible values.
			return persist({ ...updated } as StoreDocument, "update", persisted);
		});
	}

	function patch(partial: Partial<Config>): Promise<Config> {
		return mutate("write", async () => {
			const persisted = await readPersisted();
			return persist({ ...toDocument(persisted), ...partial }, "patch", persisted);
		});
	}

	function reset(): Promise<void> {
		return mutate("delete", () => deleteJson(filePath));
	}

	return { read, write, update, patch, reset };
}
