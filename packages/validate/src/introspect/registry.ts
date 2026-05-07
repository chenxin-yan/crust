// ────────────────────────────────────────────────────────────────────────────
// Vendor-dispatch introspection registry
// ────────────────────────────────────────────────────────────────────────────
//
// Reads `schema["~standard"].vendor` and routes to a per-vendor introspection
// adapter. Other vendors (Valibot, ArkType, etc.) return an empty result;
// users supply CLI metadata explicitly via options.

import type { StandardSchema } from "../types.ts";
import { extractEffectDefault, inferFromEffect } from "./effect.ts";
import { extractZodDefault, inferFromZod } from "./zod.ts";

// ────────────────────────────────────────────────────────────────────────────
// Inferred-options shape
// ────────────────────────────────────────────────────────────────────────────

/**
 * Per-schema inferred CLI metadata.
 *
 * All fields are optional because not every vendor surfaces every field.
 * `optional: true` means the schema accepts `undefined` (treat as not
 * required). `optional: false` is an affirmative inference.
 */
export interface InferredOptions {
	type?: "string" | "number" | "boolean";
	multiple?: boolean;
	description?: string;
	optional?: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// Public entry
// ────────────────────────────────────────────────────────────────────────────

/**
 * Infer CLI metadata from any Standard Schema by dispatching on
 * `schema["~standard"].vendor`.
 *
 * - `"zod"` → reads internal `_zod.def.*` (Zod 4 schemas are Standard Schemas natively).
 * - `"effect"` → walks `.ast` exposed on the `Schema.standardSchemaV1(...)` wrapper
 *   (Effect ≥ 3.14.2; the wrapper extends `Schema.make(schema.ast)` from that
 *   release — see [PR #4648](https://github.com/Effect-TS/effect/pull/4648)).
 * - any other vendor → returns `{}`. Caller must rely on user-supplied options.
 *
 * @param schema - Standard Schema v1 object
 * @param kind - `"arg"` or `"flag"` — used in error messages produced by adapters
 * @param label - Caller label for diagnostic errors (e.g. `arg "port"`)
 */
export function inferOptions(
	schema: StandardSchema,
	kind: "arg" | "flag" | "field",
	label: string,
): InferredOptions {
	const vendor = schema["~standard"]?.vendor;

	if (vendor === "zod") {
		return inferFromZod(schema);
	}

	if (vendor === "effect") {
		return inferFromEffect(schema, label);
	}

	// Unknown vendor (Valibot, ArkType, Sury, etc.) — no inference available.
	// `kind` is currently unused but accepted for future per-kind adapters.
	void kind;
	return {};
}

// ─────────────────────────────────────────────────────────────────────────
// Default extraction — vendor-aware with sync `validate(undefined)` fallback
// ─────────────────────────────────────────────────────────────────────────

/**
 * Result of attempting to recover a default value from a Standard Schema.
 *
 * Falsy defaults (`false`, `0`, `""`, `null`) are valid — callers must
 * discriminate on `ok`, never on `value`.
 */
export type ExtractedDefault =
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false };

/**
 * Best-effort SYNCHRONOUS extraction of a default value from any Standard
 * Schema. Used by `field(schema, opts?)` to auto-derive `default` when the
 * caller did not supply it explicitly.
 *
 * Strategy:
 *   1. Vendor-aware (sync) — Zod walks `def`/runtime fields for a
 *      `ZodDefault` node; Effect inspects `AST.getDefaultAnnotation`.
 *   2. Vendor-neutral fallback — call
 *      `schema['~standard'].validate(undefined)`. If the result is a
 *      `Promise`, return `{ ok: false }` (cannot wait synchronously). If
 *      the result is sync and reports no `issues`, return
 *      `{ ok: true, value: result.value }`.
 *
 * Falsy defaults are preserved — `{ ok: true, value: false }` is a valid
 * outcome. Callers must never use `value === undefined` as a sentinel.
 */
export function extractDefault(schema: StandardSchema): ExtractedDefault {
	const vendor = schema["~standard"]?.vendor;

	if (vendor === "zod") {
		const zodResult = extractZodDefault(schema);
		if (zodResult.ok) {
			return zodResult;
		}
	} else if (vendor === "effect") {
		const effectResult = extractEffectDefault(schema);
		if (effectResult.ok) {
			return effectResult;
		}
	}

	// Vendor-neutral sync fallback — ask the schema what it does with
	// `undefined`. Many spec-compliant schemas (Valibot, ArkType, and Zod
	// schemas with `.default(…)`) return the default value here; for
	// Effect schemas using only `.annotations({ default })` the validate
	// returns issues instead, in which case we report `{ ok: false }`.
	try {
		const result = schema["~standard"].validate(undefined);
		if (result instanceof Promise) {
			return { ok: false };
		}
		if (!result.issues) {
			return { ok: true, value: result.value };
		}
	} catch {
		// Catches any thrown Error from `validate(undefined)`. Standard Schema
		// v1 does not constrain what `validate` may throw, and some
		// implementations (e.g. Zod's `z.never()`, refinements that throw on
		// nullish input, custom adapters) prefer throwing over returning
		// issues. Recovery: treat any throw as "no recoverable default" —
		// equivalent to issues being reported — and let `field()` either
		// fall through to opts or omit the default key.
	}
	return { ok: false };
}
