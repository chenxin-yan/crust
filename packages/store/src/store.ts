// ────────────────────────────────────────────────────────────────────────────
// @crustjs/store — createStore factory and async object-store API
// ────────────────────────────────────────────────────────────────────────────

import { CrustStoreError } from "./errors.ts";
import { applyFieldDefaults } from "./merge.ts";
import { resolveStorePath } from "./path.ts";
import { deleteJson, readJson, writeJson } from "./persistence.ts";
import type {
	CreateStoreOptions,
	FieldDef,
	FieldsDef,
	InferStoreConfig,
	Store,
	StoreUpdater,
	StoreValidatorIssue,
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
 * @returns A {@link Store} instance with `read`, `write`, `update`, `patch`, and `reset` methods.
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
 * // → { theme: "light", verbose: false, token: undefined }
 *
 * await store.write({ theme: "dark", verbose: true, token: "abc" });
 * await store.update((c) => ({ ...c, theme: "light" }));
 * await store.patch({ theme: "solarized" });
 * await store.reset();
 * ```
 */
export function createStore<const F extends FieldsDef>(
	options: CreateStoreOptions<F>,
): Store<InferStoreConfig<F>> {
	const { dirPath, name, fields, pruneUnknown } = options;

	// Resolve the config file path once at creation time (synchronous)
	const filePath = resolveStorePath(dirPath, name);

	// Resolve pruneUnknown — defaults to true when not provided
	const shouldPrune = pruneUnknown ?? true;

	// ──────────────────────────────────────────────────────────────────────
	// normalizeStateTypes — Coerce values by field `type`
	// ──────────────────────────────────────────────────────────────────────

	function coerceByType(value: unknown, type: FieldDef["type"]): unknown {
		if (type === "number" && typeof value === "string") {
			const num = Number(value);
			return Number.isNaN(num) ? value : num;
		}

		if (type === "boolean" && typeof value === "string") {
			return value === "true" || value === "1";
		}

		return value;
	}

	function normalizeStateTypes(
		state: InferStoreConfig<F>,
	): InferStoreConfig<F> {
		const record = state as Record<string, unknown>;
		const normalized: Record<string, unknown> = { ...record };

		for (const [key, def] of Object.entries(fields)) {
			if (!(key in normalized)) continue;

			const value = normalized[key];

			if (def.array === true && Array.isArray(value)) {
				normalized[key] = value.map((item) => coerceByType(item, def.type));
				continue;
			}

			normalized[key] = coerceByType(value, def.type);
		}

		return normalized as InferStoreConfig<F>;
	}

	// ──────────────────────────────────────────────────────────────────────
	// runFieldValidators — Execute per-field validate functions
	// ──────────────────────────────────────────────────────────────────────

	async function runFieldValidators(
		state: InferStoreConfig<F>,
		operation: "read" | "write" | "update" | "patch",
	): Promise<void> {
		const issues: StoreValidatorIssue[] = [];
		const record = state as Record<string, unknown>;

		for (const [key, def] of Object.entries(fields)) {
			if (!def.validate) continue;

			const value = record[key];

			// Skip validation for undefined values (field has no default, not persisted)
			if (value === undefined) continue;

			try {
				await def.validate(value as never);
			} catch (cause) {
				const message =
					cause instanceof Error ? cause.message : "Validation failed";
				issues.push({ message, path: key });
			}
		}

		if (issues.length > 0) {
			const lines = issues.map((i) => `  - ${i.path}: ${i.message}`);
			const message = `Store validation failed (${operation})\n${lines.join("\n")}`;

			throw new CrustStoreError("VALIDATION", message, {
				operation,
				issues,
			});
		}
	}

	// ──────────────────────────────────────────────────────────────────────
	// readRaw — Load persisted config, apply field defaults (no validation)
	// ──────────────────────────────────────────────────────────────────────

	async function readRaw(): Promise<InferStoreConfig<F>> {
		const persisted = await readJson(filePath);
		const merged = applyFieldDefaults(
			persisted as Record<string, unknown> | undefined,
			fields,
			shouldPrune,
		);
		return normalizeStateTypes(merged);
	}

	// ──────────────────────────────────────────────────────────────────────
	// read — Load persisted config, apply field defaults, validate
	// ──────────────────────────────────────────────────────────────────────

	async function read(): Promise<InferStoreConfig<F>> {
		const merged = await readRaw();
		await runFieldValidators(merged, "read");
		return merged;
	}

	// ──────────────────────────────────────────────────────────────────────
	// write — Validate then atomically persist full config
	// ──────────────────────────────────────────────────────────────────────

	async function write(config: InferStoreConfig<F>): Promise<void> {
		const normalized = normalizeStateTypes(config);
		await runFieldValidators(normalized, "write");
		await writeJson(filePath, normalized);
	}

	// ──────────────────────────────────────────────────────────────────────
	// update — Read current (raw), apply updater, validate, persist
	// ──────────────────────────────────────────────────────────────────────

	async function update(
		updater: StoreUpdater<InferStoreConfig<F>>,
	): Promise<void> {
		const current = await readRaw();
		const updated = updater(current);
		const normalized = normalizeStateTypes(updated);
		await runFieldValidators(normalized, "update");
		await writeJson(filePath, normalized);
	}

	// ──────────────────────────────────────────────────────────────────────
	// patch — Shallow merge into current config, validate, persist
	// ──────────────────────────────────────────────────────────────────────

	async function patch(partial: Partial<InferStoreConfig<F>>): Promise<void> {
		const current = await readRaw();
		const merged = { ...current, ...partial } as InferStoreConfig<F>;
		const normalized = normalizeStateTypes(merged);
		await runFieldValidators(normalized, "patch");
		await writeJson(filePath, normalized);
	}

	// ──────────────────────────────────────────────────────────────────────
	// reset — Remove persisted config file
	// ──────────────────────────────────────────────────────────────────────

	async function reset(): Promise<void> {
		await deleteJson(filePath);
	}

	return { read, write, update, patch, reset };
}
