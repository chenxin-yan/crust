// ────────────────────────────────────────────────────────────────────────────
// Shared compile-time validation helpers (used by flag and arg validators)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Extract the narrowed canonical `name` literal from a definition.
 * Resolves to `never` when no `name` field exists or when the type is the
 * broad `string` (not a narrowed literal), so widened defs opt out of checks.
 */
export type DefName<T> = T extends { name: infer N extends string }
	? string extends N
		? never
		: N
	: never;

/**
 * The members of union `S` that overlap with `Existing`, or `never` when
 * disjoint. Encapsulates the precedence subtlety shared by every collision
 * brand: the intersection binds tighter than the conditional, so `S & Existing`
 * reduces to the overlapping literals before the `infer` pattern-matches them.
 */
export type Overlap<S, Existing extends string> = S & Existing extends infer C extends string
	? C
	: never;

/**
 * Brand a definition whose custom parser can return a Promise — parse results
 * are consumed synchronously during argv parsing. `Extract` keeps the check
 * union-aware (a sometimes-async `cond ? Promise.resolve(x) : x` parser is
 * caught) while `any`-returning parsers stay unbranded.
 */
export type AsyncParseBrand<T> = T extends { parse: (...args: never[]) => infer R }
	? Extract<R, Promise<unknown>> extends never
		? {}
		: {
				readonly FIX_ASYNC_PARSE: "parse must be synchronous; do async work in run()";
			}
	: {};
