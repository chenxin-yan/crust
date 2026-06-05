// ────────────────────────────────────────────────────────────────────────────
// @crustjs/utils/schema — Standard Schema helpers (INTERNAL)
// ────────────────────────────────────────────────────────────────────────────
//
// Internal subpath. Published as part of `@crustjs/utils` only so that the
// `dependencies` of `@crustjs/validate` (and `@crustjs/store`) resolve for
// external consumers. **Not part of the public Crust API** — may change in
// any release without a deprecation cycle. Do not import from
// `@crustjs/utils/schema` outside this workspace.

// ── Boundary assertions ─────────────────────────────────────────────────────
export { assertStandardSchema, isStandardSchema } from "./assertions.ts";

// ── Issue normalization ─────────────────────────────────────────────────────
export type { ValidationIssue } from "./issues.ts";
export { formatPath, normalizeStandardIssues, normalizeStandardPath } from "./issues.ts";

// ── Standard Schema type aliases ────────────────────────────────────────────
export type { InferInput, InferOutput, StandardSchema } from "./types.ts";
