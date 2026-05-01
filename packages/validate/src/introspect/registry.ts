// ────────────────────────────────────────────────────────────────────────────
// Vendor-dispatch introspection registry
// ────────────────────────────────────────────────────────────────────────────
//
// Reads `schema["~standard"].vendor` and routes to a per-vendor introspection
// adapter. Other vendors (Valibot, ArkType, etc.) return an empty result;
// users supply CLI metadata explicitly via options.

import type { StandardSchema } from "../types.ts";
import { inferFromEffect } from "./effect.ts";
import { inferFromZod } from "./zod.ts";

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
	kind: "arg" | "flag",
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
