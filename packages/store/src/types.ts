// ────────────────────────────────────────────────────────────────────────────
// @crustjs/store — Public type contracts
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// Literal-to-primitive mapping
// ────────────────────────────────────────────────────────────────────────────

/** Supported type literals for store fields. */
export type ValueType = "string" | "number" | "boolean";

/**
 * Resolves a type literal to its corresponding TypeScript primitive type.
 *
 * - `"string"` → `string`
 * - `"number"` → `number`
 * - `"boolean"` → `boolean`
 */
type ResolvePrimitive<T extends ValueType> = T extends "string"
	? string
	: T extends "number"
		? number
		: T extends "boolean"
			? boolean
			: never;

// ────────────────────────────────────────────────────────────────────────────
// FieldDef — Store field definition (discriminated by `type` × `array`)
// ────────────────────────────────────────────────────────────────────────────

/** Shared fields present on every store field definition. */
interface FieldDefBase<V> {
	/** Human-readable description for documentation and tooling. */
	description?: string;

	/**
	 * Optional per-field validation function.
	 *
	 * Called during `read`, `write`, `update`, and `patch` operations when
	 * the field has a value (not `undefined`). Throw an error to reject the
	 * value.
	 *
	 * @param value - The field value to validate.
	 * @throws When the value is invalid — the error message is captured as a
	 *   validation issue with the field name as `path`.
	 */
	validate?: (value: V) => void | Promise<void>;
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

/**
 * Defines a single field in a store's config schema.
 *
 * Discriminated by `type` and `array` for type-safe `default` values.
 * Each field can optionally include a `validate` function for per-field
 * validation and a `default` value for fallback behavior.
 *
 * @example
 * ```ts
 * const fields = {
 *   theme: { type: "string", default: "light" },
 *   verbose: { type: "boolean", default: false },
 *   tags: { type: "string", array: true, default: [] },
 *   token: { type: "string" },  // optional — no default
 *   port: {
 *     type: "number",
 *     default: 3000,
 *     validate: (v) => { if (v < 1 || v > 65535) throw new Error("invalid port"); },
 *   },
 * } satisfies FieldsDef;
 * ```
 */
export type FieldDef =
	| StringFieldDef
	| NumberFieldDef
	| BooleanFieldDef
	| StringArrayFieldDef
	| NumberArrayFieldDef
	| BooleanArrayFieldDef;

/** Record mapping field names to their definitions. */
export type FieldsDef = Record<string, FieldDef>;

// ────────────────────────────────────────────────────────────────────────────
// InferStoreConfig — Type inference from field definitions
// ────────────────────────────────────────────────────────────────────────────

/**
 * Infer the resolved type for a single field definition.
 *
 * - **array** → `primitive[]` (or `primitive[] | undefined` if no default)
 * - **has default** → `primitive` (guaranteed present)
 * - **no default** → `primitive | undefined` (optional)
 */
type InferFieldValue<F extends FieldDef> = F extends { array: true }
	? F extends { default: readonly ResolvePrimitive<F["type"]>[] }
		? ResolvePrimitive<F["type"]>[]
		: ResolvePrimitive<F["type"]>[] | undefined
	: F extends { default: ResolvePrimitive<F["type"]> }
		? ResolvePrimitive<F["type"]>
		: ResolvePrimitive<F["type"]> | undefined;

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
	 * Defaults to `"config"`, producing `config.json`. Set to a different value
	 * to create multiple stores under the same directory
	 * (e.g. `name: "auth"` → `auth.json`).
	 *
	 * Must not contain path separators or the `.json` extension.
	 */
	name?: string;

	/**
	 * Field definitions that declare the store's config schema.
	 *
	 * Each key maps to a {@link FieldDef} with a `type` discriminant and optional
	 * `default` and `validate`. Fields without a `default` are optional (`T | undefined`).
	 */
	fields: F;

	/**
	 * When `true` (the default), persisted keys not present in `fields`
	 * are dropped on read. Set to `false` to preserve unknown keys.
	 *
	 * @default true
	 */
	pruneUnknown?: boolean;
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
