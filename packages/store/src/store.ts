// ────────────────────────────────────────────────────────────────────────────
// @crustjs/store — createStore factory and async object-store API
// ────────────────────────────────────────────────────────────────────────────

import { CrustStoreError } from "./errors.ts";
import { deepMerge } from "./merge.ts";
import { resolveStorePath } from "./path.ts";
import { deleteJson, readJson, writeJson } from "./persistence.ts";
import type {
	CreateStoreOptions,
	Store,
	StoreConfigShape,
	StoreUpdater,
} from "./types.ts";
import { runValidation } from "./validation.ts";

// ────────────────────────────────────────────────────────────────────────────
// createStore — Public factory
// ────────────────────────────────────────────────────────────────────────────

/**
 * Creates a typed async config store backed by a local JSON file.
 *
 * The store resolves its file path once at creation time using platform-standard
 * conventions (XDG on Linux, Application Support on macOS, AppData on Windows),
 * unless an explicit `filePath` override is provided.
 *
 * @typeParam TConfig - The shape of the config object managed by the store.
 * @param options - Store configuration options.
 * @returns A {@link Store} instance with `read`, `write`, `update`, and `reset` methods.
 * @throws {CrustStoreError} `PATH` if `appName` or `filePath` is invalid.
 *
 * @example
 * ```ts
 * import { createStore } from "@crustjs/store";
 *
 * interface AppConfig {
 *   theme: "light" | "dark";
 *   verbose: boolean;
 * }
 *
 * const store = createStore<AppConfig>({
 *   appName: "my-cli",
 *   defaults: { theme: "light", verbose: false },
 * });
 *
 * const config = await store.read();
 * // → { theme: "light", verbose: false } (defaults when no persisted file)
 *
 * await store.write({ theme: "dark", verbose: true });
 * await store.update((c) => ({ ...c, verbose: false }));
 * await store.reset();
 * ```
 */
export function createStore<TConfig extends StoreConfigShape>(
	options: CreateStoreOptions<TConfig>,
): Store<TConfig> {
	const { appName, filePath: filePathOverride, defaults, validate } = options;

	// Resolve the config file path once at creation time (synchronous)
	const filePath = resolveStorePath(appName, filePathOverride);

	// ──────────────────────────────────────────────────────────────────────
	// read — Load persisted config, merge with defaults, validate
	// ──────────────────────────────────────────────────────────────────────

	async function read(): Promise<TConfig | undefined> {
		const persisted = await readJson(filePath);

		// No persisted file and no defaults → undefined
		if (persisted === undefined && defaults === undefined) {
			return undefined;
		}

		// No persisted file but defaults exist → validate and return defaults
		if (persisted === undefined) {
			return runValidation(defaults, validate, filePath);
		}

		// Persisted file exists but no defaults → validate persisted directly
		if (defaults === undefined) {
			return runValidation(persisted, validate, filePath);
		}

		// Both persisted and defaults exist → deep-merge then validate
		const merged = deepMerge(defaults, persisted);
		return runValidation(merged, validate, filePath);
	}

	// ──────────────────────────────────────────────────────────────────────
	// write — Validate and atomically persist full config
	// ──────────────────────────────────────────────────────────────────────

	async function write(config: TConfig): Promise<void> {
		const validated = runValidation(config, validate, filePath);
		await writeJson(filePath, validated);
	}

	// ──────────────────────────────────────────────────────────────────────
	// update — Read current, apply updater, validate, persist
	// ──────────────────────────────────────────────────────────────────────

	async function update(updater: StoreUpdater<TConfig>): Promise<void> {
		const current = await read();

		if (current === undefined) {
			throw new CrustStoreError(
				"IO",
				"Cannot update store: no persisted config and no defaults configured",
				{ path: filePath, operation: "read" },
			);
		}

		const updated = updater(current);
		const validated = runValidation(updated, validate, filePath);
		await writeJson(filePath, validated);
	}

	// ──────────────────────────────────────────────────────────────────────
	// reset — Remove persisted config file
	// ──────────────────────────────────────────────────────────────────────

	async function reset(): Promise<void> {
		await deleteJson(filePath);
	}

	return { read, write, update, reset };
}
