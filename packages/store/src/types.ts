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
interface FieldDefBase {
	/** Human-readable description for documentation and tooling. */
	description?: string;
}

// ── Scalar fields ─────────────────────────────────────────────────────────

/** Base for scalar (non-array) fields — `array` must be omitted. */
interface ScalarFieldBase extends FieldDefBase {
	/** Must be omitted for scalar fields — set to `true` for array fields. */
	array?: never;
}

/** A scalar string field. */
interface StringFieldDef extends ScalarFieldBase {
	type: "string";
	/** Default string value when the field is not persisted. */
	default?: string;
}

/** A scalar number field. */
interface NumberFieldDef extends ScalarFieldBase {
	type: "number";
	/** Default number value when the field is not persisted. */
	default?: number;
}

/** A scalar boolean field. */
interface BooleanFieldDef extends ScalarFieldBase {
	type: "boolean";
	/** Default boolean value when the field is not persisted. */
	default?: boolean;
}

// ── Array fields ──────────────────────────────────────────────────────────

/** Base for array fields — `array` is required as `true`. */
interface ArrayFieldBase extends FieldDefBase {
	/** Collect values into an array. */
	array: true;
}

/** An array of strings field. */
interface StringArrayFieldDef extends ArrayFieldBase {
	type: "string";
	/** Default string array value when the field is not persisted. */
	default?: readonly string[];
}

/** An array of numbers field. */
interface NumberArrayFieldDef extends ArrayFieldBase {
	type: "number";
	/** Default number array value when the field is not persisted. */
	default?: readonly number[];
}

/** An array of booleans field. */
interface BooleanArrayFieldDef extends ArrayFieldBase {
	type: "boolean";
	/** Default boolean array value when the field is not persisted. */
	default?: readonly boolean[];
}

/**
 * Defines a single field in a store's config schema.
 *
 * Discriminated by `type` and `array` for type-safe `default` values.
 *
 * @example
 * ```ts
 * const fields = {
 *   theme: { type: "string", default: "light" },
 *   verbose: { type: "boolean", default: false },
 *   tags: { type: "string", array: true, default: [] },
 *   token: { type: "string" },  // optional — no default
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
 *   },
 * });
 * ```
 */
export interface CreateStoreOptions<F extends FieldsDef> {
	/**
	 * Absolute directory path where the store JSON file is persisted.
	 *
	 * Use the {@link configDir} helper to resolve the platform-standard
	 * config directory from an app name.
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
	 * `default`. Fields without a `default` are optional (`T | undefined`).
	 */
	fields: F;
}

// ────────────────────────────────────────────────────────────────────────────
// StoreUpdater — Mutation callback
// ────────────────────────────────────────────────────────────────────────────

/**
 * Receives the current effective config and returns an updated config.
 *
 * Used by {@link Store.update} to apply partial mutations atomically.
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
 * Provides `read`, `write`, `update`, and `reset` operations for a single
 * typed config object persisted as JSON on the local filesystem.
 *
 * @typeParam TConfig - The inferred config shape from field definitions.
 *
 * @example
 * ```ts
 * const store = createStore({
 *   dirPath: configDir("my-cli"),
 *   fields: {
 *     theme: { type: "string", default: "light" },
 *   },
 * });
 *
 * const config = await store.read();
 * await store.write({ theme: "dark" });
 * await store.update((c) => ({ ...c, theme: "dark" }));
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
	 * @returns The effective config value.
	 * @throws {CrustStoreError} `PARSE` if persisted JSON is malformed.
	 * @throws {CrustStoreError} `IO` on filesystem read failures.
	 */
	read(): Promise<TConfig>;

	/**
	 * Atomically persists the full config object.
	 *
	 * @param config - The complete config to persist.
	 * @throws {CrustStoreError} `IO` on filesystem write failures.
	 */
	write(config: NoInfer<TConfig>): Promise<void>;

	/**
	 * Reads current effective config, applies the updater, and persists.
	 *
	 * @param updater - Function receiving current config and returning updated config.
	 * @throws {CrustStoreError} `PARSE` if persisted JSON is malformed.
	 * @throws {CrustStoreError} `IO` on filesystem failures.
	 */
	update(updater: StoreUpdater<TConfig>): Promise<void>;

	/**
	 * Removes the persisted config file, returning the store to defaults-on-read behavior.
	 *
	 * @throws {CrustStoreError} `IO` on filesystem deletion failures.
	 */
	reset(): Promise<void>;
}
