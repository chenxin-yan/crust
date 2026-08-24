// ────────────────────────────────────────────────────────────────────────────
// @crustjs/store — Public type contracts
// ────────────────────────────────────────────────────────────────────────────

import type { JsonCompatible, JsonValue } from "@crustjs/utils/json";
import type { BaseValueType, ResolvePrimitive } from "@crustjs/utils/primitive";
import type { InferOutput, StandardSchema } from "@crustjs/utils/schema";

// ────────────────────────────────────────────────────────────────────────────
// Primitive type vocabulary
// ────────────────────────────────────────────────────────────────────────────

/** Supported type literals for store fields. */
export type ValueType = BaseValueType;

// ────────────────────────────────────────────────────────────────────────────
// FieldDef — Store field definition (discriminated by `type` × `array`)
// ────────────────────────────────────────────────────────────────────────────

/** Shared fields present on every store field definition. */
interface FieldDefBase<V> {
	/** Human-readable description for documentation and tooling. */
	description?: string;
	/** Standard Schemas are an exclusive definition mode. */
	schema?: never;

	/**
	 * Optional per-field validation function.
	 *
	 * Called during `read`, `write`, `update`, and `patch` operations when
	 * the field has a value (not `undefined`).
	 *
	 * Return shapes:
	 * - `void` (or `Promise<void>`) — validation-only; the input value is
	 *   persisted as-is. This is the contract for hand-rolled validators.
	 * - `{ value }` (or `Promise<{ value }>`) — the schema (or transform)
	 *   produced a JSON-compatible output value. On `write` / `update` /
	 *   `patch`, the transformed
	 *   value replaces the input before persistence and is re-validated
	 *   once to catch read-unstable transforms (cross-type transforms
	 *   whose output would fail the schema on the next read). On `read`,
	 *   the transformed value is discarded — reads always return the
	 *   on-disk value verbatim.
	 * - Throwing an error — the value is rejected; the error message is
	 *   captured as a validation issue with the field name as `path`.
	 *
	 * @param value - The field value to validate.
	 */
	validate?: (
		value: V,
	) => void | Promise<void> | { value: JsonValue } | Promise<{ value: JsonValue }>;
}

// ── Scalar fields ─────────────────────────────────────────────────────────

/** Base for scalar (non-array) fields — `array` must be omitted. */
interface ScalarFieldBase<V> extends FieldDefBase<V> {
	/** Must be omitted for scalar fields — set to `true` for array fields. */
	array?: never;
}

/** A scalar string field. */
interface StringFieldDef extends ScalarFieldBase<string> {
	type: "string";
	/** Default string value when the field is not persisted. */
	default?: string;
}

/** A scalar number field. */
interface NumberFieldDef extends ScalarFieldBase<number> {
	type: "number";
	/** Default number value when the field is not persisted. */
	default?: number;
}

/** A scalar boolean field. */
interface BooleanFieldDef extends ScalarFieldBase<boolean> {
	type: "boolean";
	/** Default boolean value when the field is not persisted. */
	default?: boolean;
}

// ── Array fields ──────────────────────────────────────────────────────────

/** Base for array fields — `array` is required as `true`. */
interface ArrayFieldBase<V> extends FieldDefBase<V> {
	/** Collect values into an array. */
	array: true;
}

/** An array of strings field. */
interface StringArrayFieldDef extends ArrayFieldBase<string[]> {
	type: "string";
	/** Default string array value when the field is not persisted. */
	default?: readonly string[];
}

/** An array of numbers field. */
interface NumberArrayFieldDef extends ArrayFieldBase<number[]> {
	type: "number";
	/** Default number array value when the field is not persisted. */
	default?: readonly number[];
}

/** An array of booleans field. */
interface BooleanArrayFieldDef extends ArrayFieldBase<boolean[]> {
	type: "boolean";
	/** Default boolean array value when the field is not persisted. */
	default?: readonly boolean[];
}

/** A field whose Standard Schema exclusively owns its value semantics. */
interface SchemaFieldDef {
	/** Standard Schema that owns validation, transformation, defaults, and optionality. */
	schema: StandardSchema<unknown, unknown>;
	/** Human-readable description for documentation and tooling. */
	description?: string;
	/** Optional primitive metadata for tooling; the schema still owns coercion. */
	type?: BaseValueType;
	/** Optional array metadata for tooling; the schema's output type remains authoritative. */
	array?: true;
	default?: never;
	validate?: never;
}

/**
 * Defines a single field in a store's config schema.
 *
 * Core definitions are discriminated by `type` and `array`. Schema-backed
 * definitions use a `schema` key and cannot mix schema semantics with
 * `default` or `validate`.
 *
 * @example
 * ```ts
 * const fields = {
 *   theme: { type: "string", default: "light" },
 *   port: { schema: z.coerce.number().int().positive() },
 * } satisfies FieldsDef;
 * ```
 */
interface RawScalarFieldDef extends ScalarFieldBase<JsonValue> {
	type?: never;
	default?: JsonValue;
}

interface RawArrayFieldDef extends ArrayFieldBase<JsonValue[]> {
	type?: never;
	default?: readonly JsonValue[];
}

export type FieldDef =
	| StringFieldDef
	| NumberFieldDef
	| BooleanFieldDef
	| StringArrayFieldDef
	| NumberArrayFieldDef
	| BooleanArrayFieldDef
	| RawScalarFieldDef
	| RawArrayFieldDef
	| SchemaFieldDef;

/** Record mapping field names to their definitions. */
export type FieldsDef = Record<string, FieldDef>;

type JsonCompatibleFields<F extends FieldsDef> = {
	[K in keyof F]: F[K] extends { schema: StandardSchema<unknown, infer Output> }
		? Exclude<Output, undefined> extends JsonCompatible<Exclude<Output, undefined>>
			? F[K]
			: never
		: F[K];
};

/** The store's in-memory JSON document keyed by field name. */
export type StoreDocument = Record<string, JsonValue | undefined>;

// ────────────────────────────────────────────────────────────────────────────
// InferStoreConfig — Type inference from field definitions
// ────────────────────────────────────────────────────────────────────────────

/**
 * Infer the resolved type for a single field definition.
 *
 * - **schema** → the schema's exact output type
 * - **array** → `primitive[]` (or `primitive[] | undefined` if no default)
 * - **has default** → `primitive` (guaranteed present)
 * - **no default** → `primitive | undefined` (optional)
 */
type InferFieldValue<F extends FieldDef> = F extends {
	schema: infer S extends StandardSchema;
}
	? InferOutput<S>
	: F extends { type: ValueType }
		? F extends { array: true }
			? F extends { default: readonly ResolvePrimitive<F["type"]>[] }
				? ResolvePrimitive<F["type"]>[]
				: ResolvePrimitive<F["type"]>[] | undefined
			: F extends { default: ResolvePrimitive<F["type"]> }
				? ResolvePrimitive<F["type"]>
				: ResolvePrimitive<F["type"]> | undefined
		: F extends { default: infer D }
			? D
			: unknown;

/**
 * Maps a full {@link FieldsDef} record to the inferred config object type.
 *
 * @example
 * ```ts
 * type Config = InferStoreConfig<{
 *   theme: { type: "string"; default: "light" };
 *   verbose: { type: "boolean" };
 * }>;
 * // → { theme: string; verbose: boolean | undefined }
 * ```
 */
export type InferStoreConfig<F extends FieldsDef> = {
	[K in keyof F]: InferFieldValue<F[K]>;
};

// ────────────────────────────────────────────────────────────────────────────
// StoreValidatorIssue — Structured validation issue
// ────────────────────────────────────────────────────────────────────────────

/**
 * A single validation issue reported during store operations.
 */
export interface StoreValidatorIssue {
	/** Human-readable description of the validation failure. */
	message: string;
	/** Field name where the issue occurred. */
	path: string;
}

// ────────────────────────────────────────────────────────────────────────────
// StoreAccess — Persistence visibility
// ────────────────────────────────────────────────────────────────────────────

/** Explicit Unix permission bits for store persistence. */
export interface StorePermissionBits {
	/** Permission bits for the persisted store file (e.g. `0o600`). */
	file?: number;

	/** Permission bits for the store's parent directory (e.g. `0o700`). */
	directory?: number;
}

/**
 * Persistence visibility for store writes.
 *
 * - `"default"` or omitted uses platform defaults.
 * - `"private"` keeps the store owner-only on Unix (`0600` file, `0700` directory).
 * - An object lets advanced callers provide explicit Unix permission bits for
 *   group-readable or public non-secret stores without expanding the preset list.
 */
export type StoreAccess = "default" | "private" | StorePermissionBits;

// ────────────────────────────────────────────────────────────────────────────
// CreateStoreOptions — Factory configuration
// ────────────────────────────────────────────────────────────────────────────

/**
 * Options for {@link createStore}.
 *
 * @typeParam F - The field definitions record (inferred via `const` generic).
 *
 * @example
 * ```ts
 * const store = createStore({
 *   dirPath: configDir("my-cli"),
 *   name: "config",
 *   fields: {
 *     theme: { type: "string", default: "light" },
 *     verbose: { type: "boolean", default: false },
 *     token: { type: "string" },
 *   },
 * });
 * ```
 */
export interface CreateStoreOptions<F extends FieldsDef> {
	/**
	 * Absolute directory path where the store JSON file is persisted.
	 *
	 * Use a path helper ({@link configDir}, {@link dataDir}, etc.) to resolve
	 * the platform-standard directory from an app name.
	 */
	dirPath: string;

	/**
	 * Store name used as the JSON filename in the directory.
	 *
	 * For example, `name: "auth"` produces `auth.json`. Must not contain path
	 * separators or the `.json` extension.
	 */
	name: string;

	/**
	 * Field definitions that declare the store's config schema.
	 *
	 * Each key maps to a {@link FieldDef}: either a core definition or a
	 * schema-backed definition. Core fields without `default` are optional;
	 * schema fields use the schema's exact output type.
	 */
	fields: F & JsonCompatibleFields<F>;

	/**
	 * When `true` (the default), persisted keys not present in `fields`
	 * are dropped on read. Set to `false` to preserve unknown keys.
	 *
	 * @default true
	 */
	pruneUnknown?: boolean;

	/**
	 * Persistence visibility for store writes.
	 *
	 * Use `"private"` for config/state stores holding secrets (tokens, API keys)
	 * that should stay owner-only. On Unix this writes the file as `0600` and
	 * creates the parent directory as `0700`; on Windows it is not enforced
	 * because Windows uses ACLs instead of Unix permission bits.
	 *
	 * The only built-in presets are `"default"` and `"private"`. Advanced callers
	 * can pass explicit bits with `{ file, directory }` for group-readable or public
	 * non-secret stores. The file bits are enforced exactly on every write
	 * regardless of `umask`. Directory bits apply only when a write creates the
	 * directory; pre-existing directories are left untouched.
	 *
	 * @default "default"
	 * @example "private"
	 * @example { file: 0o600, directory: 0o700 }
	 */
	access?: StoreAccess;
}

// ────────────────────────────────────────────────────────────────────────────
// StoreUpdater — Mutation callback
// ────────────────────────────────────────────────────────────────────────────

/**
 * Receives the current effective config and returns an updated config.
 *
 * Used by {@link Store.update} to apply mutations atomically.
 *
 * @example
 * ```ts
 * await store.update((current) => ({
 *   ...current,
 *   theme: "dark",
 * }));
 * ```
 */
export type StoreUpdater<TConfig> = (current: TConfig) => NoInfer<TConfig>;

// ────────────────────────────────────────────────────────────────────────────
// Store — Async object-store instance
// ────────────────────────────────────────────────────────────────────────────

/**
 * A typed async config store returned by {@link createStore}.
 *
 * Provides `read`, `write`, `update`, `patch`, and `reset` operations for a
 * single typed config object persisted as JSON on the local filesystem.
 *
 * @typeParam TConfig - The inferred config shape from field definitions.
 *
 * @example
 * ```ts
 * const store = createStore({
 *   dirPath: configDir("my-cli"),
 *   name: "config",
 *   fields: {
 *     theme: { type: "string", default: "light" },
 *     verbose: { type: "boolean", default: false },
 *   },
 * });
 *
 * const config = await store.read();
 * await store.write({ theme: "dark", verbose: true });
 * await store.update((c) => ({ ...c, theme: "dark" }));
 * await store.patch({ theme: "dark" });
 * await store.reset();
 * ```
 */
export interface Store<TConfig> {
	/**
	 * Reads the persisted config, applying field defaults for missing keys.
	 *
	 * Always returns a value — fields with defaults are guaranteed present,
	 * fields without defaults may be `undefined`.
	 *
	 * When fields have `validate` functions, the merged config is validated
	 * after defaults are applied. Invalid persisted config fails loudly.
	 *
	 * @returns The effective config value.
	 * @throws {CrustStoreError} `PARSE` if persisted JSON is malformed.
	 * @throws {CrustStoreError} `VALIDATION` if field validation fails.
	 * @throws {CrustStoreError} `IO` on filesystem read failures.
	 */
	read(): Promise<TConfig>;

	/**
	 * Atomically persists the full config object.
	 *
	 * When fields have `validate` functions, the config is validated before
	 * persistence.
	 *
	 * @param config - The complete config to persist.
	 * @throws {CrustStoreError} `VALIDATION` if field validation fails.
	 * @throws {CrustStoreError} `IO` on filesystem write failures.
	 */
	write(config: NoInfer<TConfig>): Promise<void>;

	/**
	 * Reads current effective config, applies the updater, and persists.
	 *
	 * @param updater - Function receiving current config and returning updated config.
	 * @throws {CrustStoreError} `PARSE` if persisted JSON is malformed.
	 * @throws {CrustStoreError} `VALIDATION` if field validation fails.
	 * @throws {CrustStoreError} `IO` on filesystem failures.
	 */
	update(updater: StoreUpdater<TConfig>): Promise<void>;

	/**
	 * Applies a partial update to the current config and persists.
	 *
	 * Only the provided keys are updated; everything else is preserved.
	 *
	 * @param partial - A partial subset of the config to merge in.
	 * @throws {CrustStoreError} `VALIDATION` if field validation fails.
	 * @throws {CrustStoreError} `PARSE` if persisted JSON is malformed.
	 * @throws {CrustStoreError} `IO` on filesystem failures.
	 */
	patch(partial: Partial<NoInfer<TConfig>>): Promise<void>;

	/**
	 * Removes the persisted config file, returning the store to
	 * defaults-on-read behavior.
	 *
	 * @throws {CrustStoreError} `IO` on filesystem deletion failures.
	 */
	reset(): Promise<void>;
}
