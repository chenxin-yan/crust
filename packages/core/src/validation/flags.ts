import { CrustError } from "../errors.ts";
import { flagDefinitionSpellings } from "../parsing/spellings.ts";
import type { FlagDef, FlagsDef, NamedFlagDef, NamedFlagsRecord } from "../types.ts";
import type { AsyncParseBrand, DefName, Overlap } from "./shared.ts";

// ────────────────────────────────────────────────────────────────────────────
// Compile-time validation
// ────────────────────────────────────────────────────────────────────────────

/** Extract only the branded error properties from a validated record value. */
type FlagDefBrand<Name, V> = Name extends keyof V
	? Pick<V[Name], Extract<keyof V[Name], `FIX_${string}`>>
	: {};

/** Brand an incoming definition when one of its spellings is already claimed. */
type ExistingFlagCollisionBrand<F, Existing extends string> =
	Overlap<DefName<F> | ExtractAllAliases<F>, Existing> extends infer Collision extends string
		? [Collision] extends [never]
			? {}
			: {
					readonly FIX_ALIAS_COLLISION: `Flag spelling "${Collision}" collides with an existing flag`;
				}
		: never;

/** Canonical names claimed by more than one definition in the same call. */
type DuplicateNames<
	Defs extends readonly NamedFlagDef[],
	Seen extends string = never,
> = Defs extends readonly [infer Head, ...infer Tail extends readonly NamedFlagDef[]]
	? (DefName<Head> & Seen) | DuplicateNames<Tail, Seen | DefName<Head>>
	: never;

/** Brand every occurrence of a name repeated within one `.flags()` call. */
type DuplicateNameBrand<F, Dups extends string> =
	Overlap<DefName<F>, Dups> extends infer Duplicate extends string
		? [Duplicate] extends [never]
			? {}
			: {
					readonly FIX_ALIAS_COLLISION: `Flag "${Duplicate}" is already defined`;
				}
		: never;

/**
 * Per-definition validation for the variadic `.flags(...defs)` call.
 *
 * Runs the record-based validators ({@link ValidateFlagAliases},
 * {@link ValidateNoPrefixedFlags}) against the derived record, then maps
 * each branded record value back onto the tuple element that declared it —
 * so collisions, `no-` prefixes, and async parsers error on the offending argument.
 *
 * Bounded-generic wrappers (e.g. `<E extends FlagsDef>(app: Crust<L, O, A, E, C>)`)
 * keep the default `Sp = SpellingsOf<E>` deferred and will not typecheck against
 * `Existing`; type wrapper parameters as `Crust<any, ...>` instead, whose default
 * `SpellingsOf<any>` is `never` (see tests/helpers.ts).
 */
export type ValidateNamedFlagDefs<
	Defs extends readonly NamedFlagDef[],
	Existing extends string = never,
	// Hoisted out of the per-element map below: both are invariant w.r.t. `I`,
	// so computing them once as defaulted params avoids re-instantiating them
	// for every definition in the call. The always-true distributive conditional
	// on the naked `Defs` param exists purely for perf: it defers instantiating
	// the validation pipeline until `Defs` is concrete instead of speculatively
	// re-instantiating it during inference (measured −52k instantiations on core;
	// the non-distributive `[Defs] extends [Defs]` form recovers only −18k).
	// Do not simplify or box this conditional — it looks like dead code but is
	// load-bearing. It distributes over union `Defs`, which is unreachable via
	// `.flags(...defs)` tuple inference.
	Validated = Defs extends Defs
		? ValidateNoPrefixedFlags<ValidateFlagAliases<NamedFlagsRecord<Defs>>>
		: never,
	Dups extends string = DuplicateNames<Defs>,
> = {
	[I in keyof Defs]: Defs[I] &
		FlagDefBrand<Defs[I]["name"], Validated> &
		ExistingFlagCollisionBrand<Defs[I], Existing> &
		DuplicateNameBrand<Defs[I], Dups> &
		AsyncParseBrand<Defs[I]>;
};

// ────────────────────────────────────────────────────────────────────────────
// Flag alias collision detection (compile-time, per-flag granularity)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Extract the `short` alias literal from a flag definition.
 * Resolves to `never` when no `short` field exists or when the type
 * is the broad `string` (not a narrowed literal).
 */
type ExtractShort<F> = F extends { short: infer S }
	? S extends string
		? string extends S
			? never
			: S
		: never
	: never;

/**
 * Extract alias string literals from the `aliases` array of a flag definition.
 * Resolves to `never` when no `aliases` field exists or when the element type
 * is the broad `string` (not narrowed literals).
 */
type ExtractLongAliases<F> = F extends { aliases: infer A }
	? A extends readonly string[]
		? string extends A[number]
			? never
			: A[number]
		: never
	: never;

/**
 * Extract all alias identifiers (short + long) from a flag definition.
 *
 * Generalized to work with any shape; values without `short`/`aliases`
 * fields resolve to `never`.
 *
 * Includes `string extends ...` guards so non-narrowed types (e.g. the
 * broad `string` type from a default generic) resolve to `never` instead
 * of causing false-positive collisions.
 */
type ExtractAllAliases<F> = ExtractShort<F> | ExtractLongAliases<F>;

/** All narrowed canonical, short, and long-alias spellings in a flags record. */
export type SpellingsOf<F extends FlagsDef> = string extends keyof F
	? never
	:
			| (keyof F & string)
			| {
					[K in keyof F & string]: ExtractAllAliases<F[K]>;
			  }[keyof F & string];

/**
 * Collects aliases from every flag *except* flag K.
 * Used to detect alias→alias duplicates across different flags.
 */
type AliasesExcluding<F extends FlagsDef, K extends keyof F & string> = {
	[J in Exclude<keyof F & string, K>]: ExtractAllAliases<F[J]>;
}[Exclude<keyof F & string, K>];

/**
 * Per-flag collision detection: resolves to the alias literal(s) of flag K
 * that collide with a flag name (including K's own) or another flag's alias,
 * or `never` when K's aliases are all unique.
 */
type CollidingAliases<F extends FlagsDef, K extends keyof F & string> =
	| (ExtractAllAliases<F[K]> & (keyof F & string)) // alias→name (self included)
	| (ExtractAllAliases<F[K]> & AliasesExcluding<F, K>); // alias→alias

/**
 * Per-flag validation mapped type. Resolves to `F` when no collisions exist.
 * For flags with colliding aliases, adds a branded error property to the
 * specific flag definition, causing a type error on that flag's value.
 *
 * ```
 * Property 'FIX_ALIAS_COLLISION' is missing in type '{ type: "string"; short: "m" }'
 *   but required in type
 *     '{ readonly FIX_ALIAS_COLLISION: "Alias \"m\" collides with another flag name or alias" }'.
 * ```
 */
type ValidateFlagAliases<F extends FlagsDef> = {
	[K in keyof F & string]: CollidingAliases<F, K> extends never
		? F[K]
		: F[K] & {
				readonly FIX_ALIAS_COLLISION: `Alias "${CollidingAliases<F, K>}" collides with another flag name or alias`;
			};
};

// ────────────────────────────────────────────────────────────────────────────
// "no-" prefix validation (compile-time, per-flag granularity)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Detects whether a single alias literal starts with `"no-"`.
 * Resolves to the offending alias, or `never` when it is clean.
 */
type NoPrefixedAlias<A> = A extends `no-${string}` ? A : never;

/**
 * Collects all `"no-"`-prefixed alias literals from a flag definition.
 * Checks both `short` and `aliases` fields.
 * Non-narrowed `string` types resolve to `never` to avoid false positives.
 */
type NoPrefixedAliases<F> =
	| NoPrefixedAlias<ExtractShort<F>>
	| NoPrefixedAlias<ExtractLongAliases<F>>;

/**
 * Per-flag validation mapped type. Resolves to `F` when no `"no-"` prefixes
 * exist on flag names, short aliases, or long aliases. For flags with offending values,
 * adds a branded error property causing a compile-time type error.
 *
 * The `"no-"` prefix is reserved for boolean flag negation (`--no-flag`).
 * Define only the positive form (e.g. `cache`) and use `--no-cache` at runtime.
 *
 * ```
 * Property 'FIX_NO_PREFIX' is missing in type '{ type: "boolean" }'
 *   but required in type
 *     '{ readonly FIX_NO_PREFIX: "Flag name \"no-cache\" must not start with \"no-\"; define \"cache\" instead and use \"--no-cache\" at runtime" }'.
 * ```
 */
type ValidateNoPrefixedFlags<F extends FlagsDef> = {
	[K in keyof F & string]: K extends `no-${infer Base}`
		? F[K] & {
				readonly FIX_NO_PREFIX: `Flag name "${K}" must not start with "no-"; define "${Base}" instead and use "--no-${Base}" at runtime`;
			}
		: NoPrefixedAliases<F[K]> extends never
			? F[K]
			: F[K] & {
					readonly FIX_NO_PREFIX: `Alias "${NoPrefixedAliases<F[K]>}" must not start with "no-"; the "no-" prefix is reserved for boolean negation`;
				};
};

// ────────────────────────────────────────────────────────────────────────────
// Context-owned flag validation (compile-time, per-instance granularity)
// ────────────────────────────────────────────────────────────────────────────

type ContextOwnedFlags<C> = C extends {
	readonly _requires?: { ownedFlags: infer OF extends FlagsDef };
}
	? OF
	: {};

type ContextFlagCollisionBrand<C, Existing extends string> =
	Overlap<SpellingsOf<ContextOwnedFlags<C>>, Existing> extends infer Collision extends string
		? [Collision] extends [never]
			? {}
			: {
					readonly FIX_ALIAS_COLLISION: `Flag spelling "${Collision}" collides with an existing flag`;
				}
		: never;

/**
 * Validate Context-owned flags against accumulated existing spellings.
 *
 * Only compares each instance against `Sp`: collisions between two instances
 * in the same `.provide(a(), b())` call stay runtime-only — a type-level
 * pairwise check cost ~9k extra instantiations for a rare misuse.
 */
export type ProvideChecks<Sp extends string, Cs extends readonly unknown[]> = {
	[I in keyof Cs]: Cs[I] & ContextFlagCollisionBrand<Cs[I], Sp>;
};

// ────────────────────────────────────────────────────────────────────────────
// Runtime validation
// ────────────────────────────────────────────────────────────────────────────

/** Validate one flag against the complete canonical/short/alias namespace. */
export function validateIncomingFlag(
	incoming: { name: string; def: FlagDef },
	existing: FlagsDef,
	ownerLabel: string,
): void {
	const incomingSpellings = flagDefinitionSpellings(incoming.name, incoming.def);
	const duplicate = incomingSpellings.find(
		(spelling, index) => incomingSpellings.indexOf(spelling) !== index,
	);
	if (duplicate !== undefined) {
		throw new CrustError(
			"DEFINITION",
			`${ownerLabel} flag "--${incoming.name}" repeats spelling "${duplicate}"`,
			{ subject: "flag", name: incoming.name, reason: "flag-collision" },
		);
	}

	for (const [existingName, existingDef] of Object.entries(existing)) {
		const existingSpellings = new Set(flagDefinitionSpellings(existingName, existingDef));
		const collision = incomingSpellings.find((spelling) => existingSpellings.has(spelling));
		if (collision !== undefined) {
			throw new CrustError(
				"DEFINITION",
				`${ownerLabel} flag "--${incoming.name}" spelling "${collision}" collides with flag "--${existingName}"`,
				{ subject: "flag", name: incoming.name, reason: "flag-collision" },
			);
		}
	}
}
