// ────────────────────────────────────────────────────────────────────────────
// @crustjs/store — createStore factory and async object-store API
// ────────────────────────────────────────────────────────────────────────────

import type { StoreValidationIssue } from "./errors.ts";
import { CrustStoreError } from "./errors.ts";
import { applyDefaults } from "./merge.ts";
import { resolveStorePath } from "./path.ts";
import { deleteJson, readJson, writeJson } from "./persistence.ts";
import type {
	CreateStoreOptions,
	DeepPartial,
	Store,
	StoreUpdater,
	StoreValidator,
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
	const { dirPath, name, defaults, validator, pruneUnknown } = options;

	// Resolve the store file path once at creation time (synchronous)
	const filePath = resolveStorePath(dirPath, name);

	// Resolve pruneUnknown — defaults to true when not provided
	const shouldPrune = pruneUnknown ?? true;

	// ──────────────────────────────────────────────────────────────────────
	// runValidator — Shared structured validation helper
	// ──────────────────────────────────────────────────────────────────────

	async function runValidator(
		state: T,
		operation: "read" | "write" | "update" | "patch",
	): Promise<T> {
		if (!validator) return state;

		const result = await (validator as StoreValidator<T>)(state);

		if (result.ok) {
			return result.value;
		}

		const issues: StoreValidationIssue[] = result.issues.map((issue) => ({
			message: issue.message,
			path: issue.path,
		}));

		const lines = issues.map((i) =>
			i.path ? `  - ${i.path}: ${i.message}` : `  - ${i.message}`,
		);
		const message =
			lines.length > 0
				? `Store validation failed (${operation})\n${lines.join("\n")}`
				: `Store validation failed (${operation})`;

		throw new CrustStoreError("VALIDATION", message, {
			operation,
			issues,
		});
	}

	// ──────────────────────────────────────────────────────────────────────
	// readRaw — Load persisted state and apply defaults (no validation)
	// ──────────────────────────────────────────────────────────────────────

	async function readRaw(): Promise<T> {
		const persisted = await readJson(filePath);
		return applyDefaults(
			persisted as Record<string, unknown> | undefined,
			defaults,
			shouldPrune,
		) as T;
	}

	// ──────────────────────────────────────────────────────────────────────
	// read — Load persisted state, apply defaults, validate
	// ──────────────────────────────────────────────────────────────────────

	async function read(): Promise<T> {
		const merged = await readRaw();
		return runValidator(merged, "read");
	}

	// ──────────────────────────────────────────────────────────────────────
	// write — Validate then atomically persist full state
	// ──────────────────────────────────────────────────────────────────────

	async function write(state: T): Promise<void> {
		const validated = await runValidator(state, "write");
		await writeJson(filePath, validated);
	}

	// ──────────────────────────────────────────────────────────────────────
	// update — Read current (raw), apply updater, validate, persist
	// ──────────────────────────────────────────────────────────────────────

	async function update(updater: StoreUpdater<T>): Promise<void> {
		const current = await readRaw();
		const updated = updater(current);
		const validated = await runValidator(updated, "update");
		await writeJson(filePath, validated);
	}

	// ──────────────────────────────────────────────────────────────────────
	// patch — Deep partial merge into current state, validate, persist
	// ──────────────────────────────────────────────────────────────────────

	async function patch(partial: DeepPartial<T>): Promise<void> {
		const current = await readRaw();
		// Use applyDefaults with current as defaults and partial as persisted.
		// pruneUnknown=false so keys in current not in partial are preserved.
		const merged = applyDefaults(
			partial as Record<string, unknown>,
			current as Record<string, unknown>,
			false,
		) as T;
		const validated = await runValidator(merged, "patch");
		await writeJson(filePath, validated);
	}

	// ──────────────────────────────────────────────────────────────────────
	// reset — Remove persisted state file
	// ──────────────────────────────────────────────────────────────────────

	async function reset(): Promise<void> {
		await deleteJson(filePath);
	}

	return { read, write, update, patch, reset };
}
