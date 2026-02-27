// ────────────────────────────────────────────────────────────────────────────
// @crustjs/store — createStore factory and async object-store API
// ────────────────────────────────────────────────────────────────────────────

import { applyDefaults } from "./merge.ts";
import { resolveStorePath } from "./path.ts";
import { deleteJson, readJson, writeJson } from "./persistence.ts";
import type {
	CreateStoreOptions,
	DeepPartial,
	Store,
	StoreUpdater,
} from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// createStore — Public factory
// ────────────────────────────────────────────────────────────────────────────

/**
 * Creates a typed async store backed by a local JSON file.
 *
 * The store resolves its file path once at creation time from `dirPath` and
 * optional `name`. The `defaults` object declares the data shape — its
 * TypeScript type determines the store's type parameter `T`.
 *
 * @typeParam T - The store data shape (inferred from `defaults`).
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
 *   defaults: {
 *     ui: { theme: "light", fontSize: 14 },
 *     verbose: false,
 *   },
 * });
 *
 * const state = await store.read();
 * // → { ui: { theme: "light", fontSize: 14 }, verbose: false }
 *
 * await store.write({ ui: { theme: "dark", fontSize: 14 }, verbose: true });
 * await store.update((s) => ({ ...s, verbose: false }));
 * await store.patch({ ui: { theme: "dark" } });
 * await store.reset();
 * ```
 */
export function createStore<const T extends Record<string, unknown>>(
	options: CreateStoreOptions<T>,
): Store<T> {
	const { dirPath, name, defaults } = options;

	// Resolve the store file path once at creation time (synchronous)
	const filePath = resolveStorePath(dirPath, name);

	// ──────────────────────────────────────────────────────────────────────
	// read — Load persisted state, apply defaults for missing keys
	// ──────────────────────────────────────────────────────────────────────

	async function read(): Promise<T> {
		const persisted = await readJson(filePath);
		return applyDefaults(
			persisted as Record<string, unknown> | undefined,
			defaults,
		) as T;
	}

	// ──────────────────────────────────────────────────────────────────────
	// write — Atomically persist full state
	// ──────────────────────────────────────────────────────────────────────

	async function write(state: T): Promise<void> {
		await writeJson(filePath, state);
	}

	// ──────────────────────────────────────────────────────────────────────
	// update — Read current, apply updater, persist
	// ──────────────────────────────────────────────────────────────────────

	async function update(updater: StoreUpdater<T>): Promise<void> {
		const current = await read();
		const updated = updater(current);
		await writeJson(filePath, updated);
	}

	// ──────────────────────────────────────────────────────────────────────
	// patch — Deep partial update (placeholder — full impl in task 3/4)
	// ──────────────────────────────────────────────────────────────────────

	async function patch(partial: DeepPartial<T>): Promise<void> {
		const current = await read();
		const merged = applyDefaults(
			partial as Record<string, unknown>,
			current as Record<string, unknown>,
		) as T;
		await writeJson(filePath, merged);
	}

	// ──────────────────────────────────────────────────────────────────────
	// reset — Remove persisted state file
	// ──────────────────────────────────────────────────────────────────────

	async function reset(): Promise<void> {
		await deleteJson(filePath);
	}

	return { read, write, update, patch, reset };
}
