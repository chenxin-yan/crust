// ────────────────────────────────────────────────────────────────────────────
// @crustjs/schema-utils — Standard Schema introspection helpers (INTERNAL)
// ────────────────────────────────────────────────────────────────────────────
//
// Internal Crust workspace package. Published to npm only so that the
// `dependencies` of `@crustjs/validate` (and, later, `@crustjs/store`)
// resolve for external consumers. **Not part of the public Crust API** —
// may change in any release without a deprecation cycle. Do not import
// from `@crustjs/schema-utils` outside this workspace.

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
