// ────────────────────────────────────────────────────────────────────────────
// @crustjs/schema-utils — Standard Schema introspection helpers
// ────────────────────────────────────────────────────────────────────────────
//
// Vendor-aware introspection layer shared across the Crust ecosystem.
// Public consumers: `@crustjs/validate` (root API surface) and
// `@crustjs/store` (TP-018, store-field metadata extraction).
//
// Pre-stability — version `0.0.1`. Surface unstable until `0.1.0`.

// ── Boundary assertions ─────────────────────────────────────────────────────
export { assertStandardSchema, isStandardSchema } from "./assertions.ts";
// ── Introspection ───────────────────────────────────────────────────────────
export type { ExtractedDefault, InferredOptions } from "./introspect.ts";
export { extractDefault, inferOptions } from "./introspect.ts";

// ── Issue normalization ─────────────────────────────────────────────────────
export type { ValidationIssue } from "./issues.ts";
export {
	formatPath,
	normalizeStandardIssues,
	normalizeStandardPath,
} from "./issues.ts";

// ── Standard Schema type aliases ────────────────────────────────────────────
export type { InferInput, InferOutput, StandardSchema } from "./types.ts";
