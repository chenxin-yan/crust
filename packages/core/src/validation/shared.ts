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
 * disjoint. Callers pattern-match the result with their own
 * `extends infer C extends string` to embed the colliding literal(s) in a
 * brand message.
 */
export type Overlap<S, Existing extends string> = S & Existing;

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
