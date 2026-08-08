import { CrustError } from "../errors.ts";
import type { ArgsDef } from "../types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Compile-time validation
// ────────────────────────────────────────────────────────────────────────────

/**
 * Per-arg validation tuple type. Resolves to `A` when the constraint is
 * satisfied (only the last arg is variadic). For non-last args that have
 * `variadic: true`, adds a branded error property to the specific arg.
 *
 * Generalized to work with any ordered tuple of object-typed definitions.
 * Uses `readonly object[]` to avoid TypeScript's weak type detection
 * (all-optional constraint rejection).
 *
 * ```
 * Property 'FIX_VARIADIC_POSITION' is missing in type '{ name: "files"; ... variadic: true }'
 *   but required in type
 *     '{ readonly FIX_VARIADIC_POSITION: "Only the last positional argument can be variadic" }'.
 * ```
 */
export type ValidateVariadicArgs<A extends readonly object[]> = A extends readonly [
	infer Head,
	...infer Tail extends readonly object[],
]
	? Tail extends readonly [unknown, ...unknown[]]
		? Head extends { variadic: true }
			? readonly [
					Head & {
						readonly FIX_VARIADIC_POSITION: "Only the last positional argument can be variadic";
					},
					...ValidateVariadicArgs<Tail>,
				]
			: readonly [Head, ...ValidateVariadicArgs<Tail>]
		: readonly [Head]
	: A;

export type AppendArgsChecks<A extends ArgsDef, NewA extends ArgsDef> = A extends readonly [
	...unknown[],
	infer Last,
]
	? Last extends { variadic: true }
		? {
				[I in keyof NewA]: NewA[I] & {
					readonly FIX_VARIADIC_POSITION: "Only the last positional argument can be variadic";
				};
			}
		: ValidateVariadicArgs<NewA>
	: ValidateVariadicArgs<NewA>;

// ────────────────────────────────────────────────────────────────────────────
// Runtime validation
// ────────────────────────────────────────────────────────────────────────────

/**
 * Runtime guard shared by `.flags()` and `.args()` for untyped callers:
 * schema mode is exclusive — the schema owns coercion, defaults, requiredness,
 * choices, and validation. The type system already rejects mixing; this catches
 * plain-JS misuse.
 */
export function validateSchemaExclusivity(
	subject: "arg" | "flag",
	name: string,
	def: Record<string, unknown>,
): void {
	if (def.schema === undefined) return;
	for (const key of ["default", "required", "choices", "parse"] as const) {
		if (def[key] !== undefined) {
			throw new CrustError(
				"DEFINITION",
				`${subject} "${name}" mixes core option "${key}" with a schema — the schema exclusively owns coercion, defaults, requiredness, choices, and validation`,
				{ subject, name, reason: "schema-exclusive" },
			);
		}
	}
	if (subject === "arg" && def.type !== undefined) {
		throw new CrustError(
			"DEFINITION",
			`arg "${name}" mixes core option "type" with a schema — schema args receive the raw string token`,
			{ subject, name, reason: "schema-exclusive" },
		);
	}
}

/** Validate that a variadic argument is the final positional argument. */
export function validateVariadicArgPosition(
	def: ArgsDef[number],
	index: number,
	count: number,
): void {
	if (def.variadic === true && index !== count - 1) {
		throw new CrustError(
			"DEFINITION",
			`Argument "${def.name}" is variadic, but only the last positional argument can be variadic`,
			{ subject: "arg", name: def.name, reason: "variadic-position" },
		);
	}
}
