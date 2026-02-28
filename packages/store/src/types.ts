// ────────────────────────────────────────────────────────────────────────────
// @crustjs/store — Public type contracts
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// DeepPartial — Recursive partial for nested object updates
// ────────────────────────────────────────────────────────────────────────────

/**
 * Recursively makes all properties of `T` optional.
 *
 * - Plain objects are recursed into — each nested key becomes optional.
 * - Arrays are left as-is (replaced wholesale, not partially updated).
 * - Primitives pass through unchanged.
 *
 * Used by {@link Store.patch} for deep partial updates.
 *
 * @example
 * ```ts
 * type Config = { ui: { theme: string; fontSize: number }; verbose: boolean };
 * type Partial = DeepPartial<Config>;
 * // → { ui?: { theme?: string; fontSize?: number }; verbose?: boolean }
 * ```
 */
export type DeepPartial<T> = T extends readonly unknown[]
	? T
	: T extends Record<string, unknown>
		? { [K in keyof T]?: DeepPartial<T[K]> }
		: T;

// ────────────────────────────────────────────────────────────────────────────
// StoreValidator — Provider-agnostic validation contract
// ────────────────────────────────────────────────────────────────────────────

/**
 * Result returned by a {@link StoreValidator} when validation succeeds.
 *
 * Carries the (possibly transformed) config value from the schema.
 */
export interface StoreValidatorSuccess<T> {
	readonly ok: true;
	readonly value: T;
}

/**
 * A single validation issue reported by a {@link StoreValidator}.
 *
 * Compatible with the canonical `ValidationIssue` shape used across the Crust
 * validation platform.
 */
export interface StoreValidatorIssue {
	/** Human-readable description of the validation failure. */
	message: string;
	/** Dot-path to the invalid field, or empty string for root-level issues. */
	path: string;
}

/**
 * Result returned by a {@link StoreValidator} when validation fails.
 *
 * Carries structured issues for programmatic handling and error rendering.
 */
export interface StoreValidatorFailure {
	readonly ok: false;
	readonly issues: readonly StoreValidatorIssue[];
}

/**
 * Discriminated union result from a {@link StoreValidator}.
 */
export type StoreValidatorResult<T> =
	| StoreValidatorSuccess<T>
	| StoreValidatorFailure;

/**
 * A provider-agnostic validator function for full config objects.
 *
 * Accepts a config value and returns a discriminated result indicating
 * success (with a possibly-transformed value) or failure (with structured issues).
 *
 * Store adapters in `@crustjs/validate` produce functions matching this contract
 * from Standard Schema, Zod, or Effect schemas.
 *
 * @typeParam T - The expected config type.
 *
 * @example
 * ```ts
 * const validator: StoreValidator<Config> = (config) => {
 *   if (typeof config.theme !== "string") {
 *     return { ok: false, issues: [{ message: "Expected string", path: "theme" }] };
 *   }
 *   return { ok: true, value: config };
 * };
 * ```
 */
export type StoreValidator<T> = (
	value: unknown,
) => StoreValidatorResult<T> | Promise<StoreValidatorResult<T>>;

// ────────────────────────────────────────────────────────────────────────────
// CreateStoreOptions — Factory configuration
// ────────────────────────────────────────────────────────────────────────────

/**
 * Options for {@link createStore}.
 *
 * @typeParam T - The store data shape, inferred from `defaults`.
 *
 * @example
 * ```ts
 * const store = createStore({
 *   dirPath: configDir("my-cli"),
 *   defaults: {
 *     ui: { theme: "light", fontSize: 14 },
 *     verbose: false,
 *     tags: ["default"],
 *   },
 * });
 * ```
 */
export interface CreateStoreOptions<T extends Record<string, unknown>> {
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
	 * Default values for the store. Defines the data shape and provides
	 * fallback values when no persisted file exists or keys are missing.
	 *
	 * The TypeScript type of `defaults` determines the store's `T` parameter.
	 */
	defaults: T;

	/**
	 * Optional validator function applied to config objects during read, write,
	 * update, and patch operations.
	 *
	 * When provided, validation is **strict by default**: invalid config will
	 * cause a `CrustStoreError` with `VALIDATION` code to be thrown on both
	 * persistence (write/update/patch) and load (read) paths.
	 *
	 * Use store adapters from `@crustjs/validate/standard`, `@crustjs/validate/zod`,
	 * or `@crustjs/validate/effect` to create validators from schema definitions.
	 *
	 * @example
	 * ```ts
	 * import { storeValidator } from "@crustjs/validate/zod";
	 * import { z } from "zod";
	 *
	 * const store = createStore({
	 *   dirPath: configDir("my-cli"),
	 *   defaults: { theme: "light", verbose: false },
	 *   validator: storeValidator(z.object({ theme: z.enum(["light", "dark"]) })),
	 * });
	 * ```
	 */
	validator?: StoreValidator<T>;

	/**
	 * When `true` (the default), persisted keys not present in `defaults`
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
 * Receives the current effective state and returns an updated state.
 *
 * Used by {@link Store.update} to apply mutations atomically.
 *
 * @example
 * ```ts
 * await store.update((current) => ({
 *   ...current,
 *   ui: { ...current.ui, theme: "dark" },
 * }));
 * ```
 */
export type StoreUpdater<T> = (current: T) => NoInfer<T>;

// ────────────────────────────────────────────────────────────────────────────
// Store — Async object-store instance
// ────────────────────────────────────────────────────────────────────────────

/**
 * A typed async store returned by {@link createStore}.
 *
 * Provides `read`, `write`, `update`, `patch`, and `reset` operations for a
 * typed state object persisted as JSON on the local filesystem.
 *
 * @typeParam T - The store data shape, inferred from `defaults`.
 *
 * @example
 * ```ts
 * const store = createStore({
 *   dirPath: configDir("my-cli"),
 *   defaults: {
 *     ui: { theme: "light", fontSize: 14 },
 *     verbose: false,
 *   },
 * });
 *
 * const state = await store.read();
 * await store.write({ ui: { theme: "dark", fontSize: 14 }, verbose: true });
 * await store.update((s) => ({ ...s, verbose: false }));
 * await store.patch({ ui: { theme: "dark" } });
 * await store.reset();
 * ```
 */
export interface Store<T> {
	/**
	 * Reads the persisted state, merging defaults for missing keys.
	 *
	 * Always returns a complete `T` — missing persisted keys are filled
	 * from `defaults`.
	 *
	 * When a validator is configured, the merged config is validated after
	 * defaults are applied. Invalid persisted config fails loudly.
	 *
	 * @returns The effective config value (possibly transformed by the validator).
	 * @throws {CrustStoreError} `PARSE` if persisted JSON is malformed.
	 * @throws {CrustStoreError} `VALIDATION` if the config fails validation.
	 * @throws {CrustStoreError} `IO` on filesystem read failures.
	 */
	read(): Promise<T>;

	/**
	 * Atomically persists the full state object.
	 *
	 * When a validator is configured, the config is validated before persistence.
	 *
	 * @param state - The complete state to persist.
	 * @throws {CrustStoreError} `VALIDATION` if the config fails validation.
	 * @throws {CrustStoreError} `IO` on filesystem write failures.
	 */
	write(state: NoInfer<T>): Promise<void>;

	/**
	 * Reads current effective state, applies the updater, and persists.
	 *
	 * When a validator is configured, the updated config is validated before
	 * persistence. The read step during update does **not** validate separately
	 * to avoid double-validation overhead — the `current` value passed to the
	 * updater may not have been validated (e.g. if the persisted file was
	 * manually edited).
	 *
	 * @param updater - Function receiving current state and returning updated state.
	 * @throws {CrustStoreError} `PARSE` if persisted JSON is malformed.
	 * @throws {CrustStoreError} `VALIDATION` if the updated config fails validation.
	 * @throws {CrustStoreError} `IO` on filesystem failures.
	 */
	update(updater: StoreUpdater<T>): Promise<void>;

	/**
	 * Applies a deep partial update to the current state and persists.
	 *
	 * Only the provided keys are updated; everything else is preserved.
	 * Arrays are replaced wholesale (not merged element-by-element).
	 *
	 * @param partial - A deep-partial subset of the state to merge in.
	 * @throws {CrustStoreError} `VALIDATION` if the merged config fails validation.
	 * @throws {CrustStoreError} `PARSE` if persisted JSON is malformed.
	 * @throws {CrustStoreError} `IO` on filesystem failures.
	 */
	patch(partial: DeepPartial<NoInfer<T>>): Promise<void>;

	/**
	 * Removes the persisted state file, returning the store to
	 * defaults-on-read behavior.
	 *
	 * @throws {CrustStoreError} `IO` on filesystem deletion failures.
	 */
	reset(): Promise<void>;
}
