import { CrustError } from "../errors.ts";
import type { ArgsDef } from "../types.ts";
import type { AsyncParseBrand, DefName, Overlap } from "./shared.ts";

// ────────────────────────────────────────────────────────────────────────────
// Compile-time validation
// ────────────────────────────────────────────────────────────────────────────

type ArgNames<A extends readonly object[]> = DefName<A[number]>;

type DuplicateArgBrand<A, Existing extends string> =
	Overlap<DefName<A>, Existing> extends infer Duplicate extends string
		? [Duplicate] extends [never]
			? {}
			: {
					readonly FIX_DUPLICATE_ARG: `Argument name "${Duplicate}" is already defined`;
				}
		: never;

type ArgChecks<A, Existing extends string> = A &
	DuplicateArgBrand<A, Existing> &
	AsyncParseBrand<A>;

/**
 * Per-arg validation tuple type. Resolves to `A` when the constraints are
 * satisfied: only the last arg is variadic, names are unique, and custom
 * parsers are synchronous. Invalid definitions receive a branded property.
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
export type ValidateVariadicArgs<
	A extends readonly object[],
	Existing extends string = never,
> = A extends readonly [infer Head, ...infer Tail extends readonly object[]]
	? Tail extends readonly [unknown, ...unknown[]]
		? Head extends { variadic: true }
			? readonly [
					ArgChecks<Head, Existing> & {
						readonly FIX_VARIADIC_POSITION: "Only the last positional argument can be variadic";
					},
					...ValidateVariadicArgs<Tail, Existing | DefName<Head>>,
				]
			: readonly [
					ArgChecks<Head, Existing>,
					...ValidateVariadicArgs<Tail, Existing | DefName<Head>>,
				]
		: readonly [ArgChecks<Head, Existing>]
	: A;

type BrandVariadicPosition<A extends readonly object[]> = {
	[I in keyof A]: A[I] & {
		readonly FIX_VARIADIC_POSITION: "Only the last positional argument can be variadic";
	};
};

export type AppendArgsChecks<A extends ArgsDef, NewA extends ArgsDef> = A extends readonly [
	...unknown[],
	infer Last,
]
	? Last extends { variadic: true }
		? BrandVariadicPosition<ValidateVariadicArgs<NewA, ArgNames<A>>>
		: ValidateVariadicArgs<NewA, ArgNames<A>>
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
