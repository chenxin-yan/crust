// ────────────────────────────────────────────────────────────────────────────
// @crustjs/store — Public type contracts
// ────────────────────────────────────────────────────────────────────────────

/**
 * Validates an unknown input and returns a typed config value.
 *
 * Thrown errors are caught and normalized into `CrustStoreError` with `VALIDATION` code.
 * Compatible with schema-library wrappers (e.g. Zod `.parse`, Valibot `.parse`).
 *
 * @example
 * ```ts
 * const validate: StoreValidator<MyConfig> = (input) => {
 *   if (typeof input !== "object" || input === null) {
 *     throw new Error("Expected object");
 *   }
 *   return input as MyConfig;
 * };
 * ```
 */
export type StoreConfigShape = object;

/**
 * Validates an unknown input and returns a strongly typed config object.
 */
export type StoreValidator<TConfig extends StoreConfigShape> = (
	input: unknown,
) => TConfig;

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
export type StoreUpdater<TConfig extends StoreConfigShape> = (
	current: TConfig,
) => NoInfer<TConfig>;

// ────────────────────────────────────────────────────────────────────────────
// CreateStoreOptions — Factory configuration
// ────────────────────────────────────────────────────────────────────────────

/** Common options accepted by all createStore modes. */
export interface CreateStoreBaseOptions {
	/**
	 * Application name used to derive the platform-standard config directory.
	 *
	 * Must be a non-empty string. Used as the directory name under the
	 * platform config root (e.g. `~/.config/<appName>/config.json` on Linux).
	 */
	appName: string;

	/**
	 * Explicit file path override for the config file.
	 *
	 * When provided, bypasses default platform path derivation entirely.
	 * Must be an absolute path ending in `.json`.
	 */
	filePath?: string;
}

/**
 * Strict options branch where config shape is inferred from `defaults`.
 */
export interface CreateStoreOptionsWithDefaults<
	TConfig extends StoreConfigShape,
> extends CreateStoreBaseOptions {
	/**
	 * Default config values returned by `read()` when no persisted file exists.
	 *
	 * Defaults are deep-merged with persisted config at read time — missing
	 * persisted fields are filled from defaults without auto-persisting the
	 * merged result.
	 */
	defaults: TConfig;

	/**
	 * Optional validator function run on every `read()`, `write()`, and `update()`.
	 *
	 * Must accept `unknown` and return a valid `TConfig`, or throw an error
	 * that will be normalized into `CrustStoreError` with `VALIDATION` code.
	 */
	validate?: StoreValidator<TConfig>;
}

/**
 * Strict options branch where config shape is inferred from `validate`.
 */
export interface CreateStoreOptionsWithValidator<
	TConfig extends StoreConfigShape,
> extends CreateStoreBaseOptions {
	/**
	 * Optional default config returned by `read()` when no persisted file exists.
	 */
	defaults?: TConfig;

	/**
	 * Validator function run on every `read()`, `write()`, and `update()`.
	 *
	 * Required in this branch and used as the source of config-shape inference.
	 */
	validate: StoreValidator<TConfig>;
}

/**
 * Options for {@link createStore}.
 *
 * Strict by design: callers must provide at least one type source (`defaults`
 * or `validate`) so `TConfig` is explicit/inferable and editor autocomplete
 * remains precise for all store operations.
 *
 * @typeParam TConfig - The shape of the config object managed by the store.
 *
 * @example
 * ```ts
 * const store = createStore<AppConfig>({
 *   appName: "my-cli",
 *   defaults: { theme: "light", verbose: false },
 * });
 * ```
 */
export type CreateStoreOptions<TConfig extends StoreConfigShape> =
	| CreateStoreOptionsWithDefaults<TConfig>
	| CreateStoreOptionsWithValidator<TConfig>;

/**
 * Type contract for the `createStore` factory.
 *
 * Strict by design: there is intentionally no overload that accepts only
 * `appName`/`filePath`, because that would erase config-shape inference and
 * degrade autocomplete to loose object types.
 */
export interface CreateStore {
	<TConfig extends StoreConfigShape>(
		options: CreateStoreOptionsWithDefaults<TConfig>,
	): Store<TConfig>;
	<TConfig extends StoreConfigShape>(
		options: CreateStoreOptionsWithValidator<TConfig>,
	): Store<TConfig>;
}

// ────────────────────────────────────────────────────────────────────────────
// Store — Async object-store instance
// ────────────────────────────────────────────────────────────────────────────

/**
 * A typed async config store returned by {@link createStore}.
 *
 * Provides `read`, `write`, `update`, and `reset` operations for a single
 * typed config object persisted as JSON on the local filesystem.
 *
 * @typeParam TConfig - The shape of the config object managed by the store.
 *
 * @example
 * ```ts
 * const store = createStore<AppConfig>({
 *   appName: "my-cli",
 *   defaults: { theme: "light" },
 * });
 *
 * const config = await store.read();
 * await store.write({ theme: "dark" });
 * await store.update((c) => ({ ...c, theme: "dark" }));
 * await store.reset();
 * ```
 */
export interface Store<TConfig extends StoreConfigShape> {
	/**
	 * Reads the persisted config, deep-merging with defaults if provided.
	 *
	 * Returns defaults (if configured) when no persisted file exists.
	 * Runs optional validation on the final merged result.
	 *
	 * @returns The effective config value.
	 * @throws {CrustStoreError} `PARSE` if persisted JSON is malformed.
	 * @throws {CrustStoreError} `VALIDATION` if validation fails.
	 * @throws {CrustStoreError} `IO` on filesystem read failures.
	 */
	read(): Promise<TConfig | undefined>;

	/**
	 * Validates and atomically persists the full config object.
	 *
	 * @param config - The complete config to persist.
	 * @throws {CrustStoreError} `VALIDATION` if validation fails.
	 * @throws {CrustStoreError} `IO` on filesystem write failures.
	 */
	write(config: NoInfer<TConfig>): Promise<void>;

	/**
	 * Reads current effective config, applies the updater, validates, and persists.
	 *
	 * @param updater - Function receiving current config and returning updated config.
	 * @throws {CrustStoreError} `PARSE` if persisted JSON is malformed.
	 * @throws {CrustStoreError} `VALIDATION` if validation fails.
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
