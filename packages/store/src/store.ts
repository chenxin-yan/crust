// ────────────────────────────────────────────────────────────────────────────
// @crustjs/store — createStore factory and async object-store API
// ────────────────────────────────────────────────────────────────────────────

import { applyFieldDefaults } from "./merge.ts";
import { resolveStorePath } from "./path.ts";
import { deleteJson, readJson, writeJson } from "./persistence.ts";
import type {
	CreateStoreOptions,
	FieldsDef,
	InferStoreConfig,
	Store,
	StoreUpdater,
} from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// createStore — Public factory
// ────────────────────────────────────────────────────────────────────────────

/**
 * Creates a typed async config store backed by a local JSON file.
 *
 * The store resolves its file path once at creation time from `dirPath` and
 * optional `name`. Field definitions declare the config schema — each field's
 * `type` determines its TypeScript type, and the presence of `default`
 * determines whether the field is guaranteed or optional (`T | undefined`).
 *
 * @typeParam F - Field definitions record (inferred via `const` generic).
 * @param options - Store configuration options.
 * @returns A {@link Store} instance with `read`, `write`, `update`, and `reset` methods.
 * @throws {CrustStoreError} `PATH` if `dirPath` or `name` is invalid.
 *
 * @example
 * ```ts
 * import { createStore, configDir } from "@crustjs/store";
 *
 * const store = createStore({
 *   dirPath: configDir("my-cli"),
 *   fields: {
 *     theme: { type: "string", default: "light" },
 *     verbose: { type: "boolean", default: false },
 *     token: { type: "string" },
 *   },
 * });
 *
 * const config = await store.read();
 * // → { theme: "light", verbose: false } (defaults when no persisted file)
 *
 * await store.write({ theme: "dark", verbose: true, token: "abc" });
 * await store.update((c) => ({ ...c, theme: "light" }));
 * await store.reset();
 * ```
 */
export function createStore<const F extends FieldsDef>(
	options: CreateStoreOptions<F>,
): Store<InferStoreConfig<F>> {
	const { dirPath, name, fields } = options;

	// Resolve the config file path once at creation time (synchronous)
	const filePath = resolveStorePath(dirPath, name);

	// ──────────────────────────────────────────────────────────────────────
	// read — Load persisted config, apply field defaults
	// ──────────────────────────────────────────────────────────────────────

	async function read(): Promise<InferStoreConfig<F>> {
		const persisted = await readJson(filePath);

		return applyFieldDefaults(
			persisted as Record<string, unknown> | undefined,
			fields,
		);
	}

	// ──────────────────────────────────────────────────────────────────────
	// write — Atomically persist full config
	// ──────────────────────────────────────────────────────────────────────

	async function write(config: InferStoreConfig<F>): Promise<void> {
		await writeJson(filePath, config);
	}

	// ──────────────────────────────────────────────────────────────────────
	// update — Read current, apply updater, persist
	// ──────────────────────────────────────────────────────────────────────

	async function update(
		updater: StoreUpdater<InferStoreConfig<F>>,
	): Promise<void> {
		const current = await read();
		const updated = updater(current);
		await writeJson(filePath, updated);
	}

	// ──────────────────────────────────────────────────────────────────────
	// reset — Remove persisted config file
	// ──────────────────────────────────────────────────────────────────────

	async function reset(): Promise<void> {
		await deleteJson(filePath);
	}

	return { read, write, update, reset };
}
