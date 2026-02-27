// ────────────────────────────────────────────────────────────────────────────
// @crustjs/store — createStore factory and async object-store API
// ────────────────────────────────────────────────────────────────────────────

import { CrustStoreError } from "./errors.ts";
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
	const { dirPath, name, defaults, validate, pruneUnknown } = options;

	// Resolve the store file path once at creation time (synchronous)
	const filePath = resolveStorePath(dirPath, name);

	// Resolve pruneUnknown — defaults to true when not provided
	const shouldPrune = pruneUnknown ?? true;

	// ──────────────────────────────────────────────────────────────────────
	// runValidate — Call user-supplied validate before persisting
	// ──────────────────────────────────────────────────────────────────────

	async function runValidate(
		state: T,
		operation: "write" | "update" | "patch",
	): Promise<void> {
		if (!validate) return;
		try {
			await validate(state);
		} catch (cause) {
			const message =
				cause instanceof Error ? cause.message : "Validation failed";
			throw new CrustStoreError("VALIDATION", message, {
				operation,
			}).withCause(cause);
		}
	}

	// ──────────────────────────────────────────────────────────────────────
	// read — Load persisted state, apply defaults for missing keys
	// ──────────────────────────────────────────────────────────────────────

	async function read(): Promise<T> {
		const persisted = await readJson(filePath);
		return applyDefaults(
			persisted as Record<string, unknown> | undefined,
			defaults,
			shouldPrune,
		) as T;
	}

	// ──────────────────────────────────────────────────────────────────────
	// write — Validate then atomically persist full state
	// ──────────────────────────────────────────────────────────────────────

	async function write(state: T): Promise<void> {
		await runValidate(state, "write");
		await writeJson(filePath, state);
	}

	// ──────────────────────────────────────────────────────────────────────
	// update — Read current, apply updater, validate, persist
	// ──────────────────────────────────────────────────────────────────────

	async function update(updater: StoreUpdater<T>): Promise<void> {
		const current = await read();
		const updated = updater(current);
		await runValidate(updated, "update");
		await writeJson(filePath, updated);
	}

	// ──────────────────────────────────────────────────────────────────────
	// patch — Deep partial merge into current state, validate, persist
	// ──────────────────────────────────────────────────────────────────────

	async function patch(partial: DeepPartial<T>): Promise<void> {
		const current = await read();
		// Use applyDefaults with current as defaults and partial as persisted.
		// pruneUnknown=false so keys in current not in partial are preserved.
		const merged = applyDefaults(
			partial as Record<string, unknown>,
			current as Record<string, unknown>,
			false,
		) as T;
		await runValidate(merged, "patch");
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
