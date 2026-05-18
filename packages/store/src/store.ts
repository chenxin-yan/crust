// ────────────────────────────────────────────────────────────────────────────
// @crustjs/store — createStore factory and async object-store API
// ────────────────────────────────────────────────────────────────────────────

import { coerceBooleanString, tryCoerceNumber } from "@crustjs/utils";
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

/**
 * Narrow a `FieldDef.validate` return to the transform-result shape
 * `{ value: unknown }`. Rejects the legacy `{ ok, value }` and
 * `{ ok, issues }` shapes so they fall through to the fail-fast
 * `TypeError` migration guard instead of being silently persisted.
 */
function isFieldValueResult(r: unknown): r is { value: unknown } {
	return typeof r === "object" && r !== null && "value" in r && !("ok" in r);
}

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
		if (type === undefined) return value;
		if (type === "number" && typeof value === "string") {
			return tryCoerceNumber(value) ?? value;
		}

		if (type === "boolean" && typeof value === "string") {
			return coerceBooleanString(value);
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

			if (value === undefined && def.validateMissing !== true) continue;

			let result: unknown;
			try {
				result = await def.validate(value as never);
			} catch (cause) {
				const message =
					cause instanceof Error ? cause.message : "Validation failed";
				issues.push({ message, path: key });
				continue;
			}

			// `FieldDef.validate` is contractually `void | { value }`. Anything
			// else (notably the legacy `{ ok, value }` shape) is a caller bug
			// and is surfaced below as a `TypeError` OUTSIDE the try/catch so
			// it cannot be re-wrapped as `CrustStoreError("VALIDATION")`.

			// Validation-only: validator returned no transformed value.
			if (result === undefined) continue;

			// Transform path: validator returned `{ value }`.
			if (isFieldValueResult(result)) {
				const transformed = result.value;

				// On read, preserve persisted values verbatim, but allow schemas to
				// materialize missing values by validating `undefined` (e.g. defaults).
				if (operation === "read") {
					if (value === undefined) record[key] = transformed;
					continue;
				}

				// Persist-time path: if the transform changed the value,
				// re-validate the output once. This catches cross-type
				// transforms like `z.string().transform(Number)` whose output
				// would fail the schema on the next read. Compare structurally
				// because Standard Schema parsers (e.g. Zod arrays/objects)
				// return fresh references even when contents are identical.
				if (!Bun.deepEquals(transformed, value)) {
					let recheck: unknown;
					try {
						recheck = await def.validate(transformed as never);
					} catch (cause) {
						const message =
							cause instanceof Error ? cause.message : "re-validation failed";
						issues.push({
							message: `read-unstable transform: ${message}`,
							path: key,
						});
						continue;
					}

					// Recheck must accept the transformed value: either `void`
					// (validation-only contract) or `{ value }` that is
					// structurally stable under another round of the same
					// transform. Anything else means the next read would see a
					// different value than the one we'd persist now.
					if (
						recheck !== undefined &&
						(!isFieldValueResult(recheck) ||
							!Bun.deepEquals(recheck.value, transformed))
					) {
						issues.push({
							message: `read-unstable transform: output would be transformed again on re-read`,
							path: key,
						});
						continue;
					}

					record[key] = transformed;
				}
				continue;
			}

			// Any other return shape (e.g. legacy `{ ok, value }` or
			// `{ ok, issues }`) is a caller bug — surface as a TypeError so
			// it isn't misclassified as a `VALIDATION` failure.
			throw new TypeError(
				`FieldDef.validate must return void or { value } (see @crustjs/store validation docs).`,
			);
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
