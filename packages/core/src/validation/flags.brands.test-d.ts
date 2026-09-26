import type { Equal, Expect } from "../../tests/helpers.ts";
import type { NamedFlagDef } from "../types.ts";
import type {
	ContextOwnedFlags,
	DefinitionTreeSpellings,
	ProvideChecks,
	SpellingsOf,
	TreeSpellings,
	ValidateDefinitionFlags,
	ValidateExtensionFlags,
	LocalFlagBrand,
	LocalFlagNameBrand,
	ValidateLocalFlagDefs,
} from "./flags.brands.ts";

{
	// extracts all literal spellings from an existing flags record
	type Existing = {
		verbose: { type: "boolean"; short: "v" };
		output: { type: "string"; aliases: ["out", "destination"] };
	};
	type _check = Expect<
		Equal<SpellingsOf<Existing>, "verbose" | "v" | "output" | "out" | "destination">
	>;
}

{
	// brands Context-owned flag collisions inside one .provide() batch
	type First = { readonly _ownedFlags?: { token: { type: "string"; required: true } } };
	type Second = { readonly _ownedFlags?: { auth: { type: "string"; aliases: ["token"] } } };
	type Batch = ProvideChecks<never, readonly [First, Second]>;
	type _first = Expect<Equal<Extract<keyof Batch[0], "FIX_ALIAS_COLLISION">, never>>;
	type _second = Expect<
		Equal<Batch[1]["FIX_ALIAS_COLLISION"], 'Flag spelling "token" collides with an existing flag'>
	>;
}

{
	// brands Extension flag spellings colliding with existing or earlier-Extension flags
	type Ext<Defs extends readonly NamedFlagDef[], Provide extends readonly unknown[] = []> = {
		readonly _flagDefs?: Defs;
		readonly provide?: Provide;
	};
	type AppCollision = ValidateExtensionFlags<
		readonly [Ext<readonly [{ name: "mode"; type: "boolean" }]>],
		"mode"
	>;
	type CrossExtension = ValidateExtensionFlags<
		readonly [
			Ext<readonly [{ name: "verbose"; type: "boolean" }]>,
			Ext<readonly [{ name: "verbose"; type: "string" }]>,
		],
		never
	>;
	type Provided = ValidateExtensionFlags<
		readonly [Ext<readonly [], readonly [{ _ownedFlags?: { mode: { type: "string" } } }]>],
		"mode"
	>;
	type Clean = ValidateExtensionFlags<
		readonly [Ext<readonly [{ name: "verbose"; type: "boolean" }]>],
		"mode"
	>;
	type Widened = ValidateExtensionFlags<readonly [{ readonly _flagDefs?: NamedFlagDef[] }], "mode">;
	type _app = Expect<
		Equal<
			AppCollision[0]["FIX_ALIAS_COLLISION"],
			'Extension flag spelling "mode" collides with an existing flag'
		>
	>;
	type _cross = Expect<
		Equal<
			CrossExtension[1]["FIX_ALIAS_COLLISION"],
			'Extension flag spelling "verbose" collides with an existing flag'
		>
	>;
	type _provided = Expect<
		Equal<
			Provided[0]["FIX_ALIAS_COLLISION"],
			'Extension flag spelling "mode" collides with an existing flag'
		>
	>;
	type _clean = Expect<Equal<Extract<keyof Clean[0], "FIX_ALIAS_COLLISION">, never>>;
	type _widened = Expect<Equal<Extract<keyof Widened[0], "FIX_ALIAS_COLLISION">, never>>;
}

{
	// recurses flag spellings through nested subcommand shapes
	type Tree = {
		deploy: {
			readonly flags: {};
			readonly children: {
				prod: {
					readonly flags: { force: { type: "boolean"; short: "f" } };
					readonly children: {};
				};
			};
		};
	};
	type _nested = Expect<Equal<TreeSpellings<Tree>, "force" | "f">>;
	type _any = Expect<Equal<TreeSpellings<any>, string>>;
}

{
	// brands a definition whose nested child flag collides with an Extension flag
	type Def = {
		readonly _shape?: {
			readonly flags: {};
			readonly children: {
				prod: {
					readonly flags: { force: { type: "boolean" } };
					readonly children: {};
				};
			};
		};
	};
	type _spellings = Expect<Equal<DefinitionTreeSpellings<readonly [Def]>, "force">>;

	type Branded = ValidateDefinitionFlags<readonly [Def], "force">;
	type _collision = Expect<
		Equal<
			Branded[0]["FIX_ALIAS_COLLISION"],
			'Flag spelling "force" collides with a registered Extension flag'
		>
	>;

	type Clean = ValidateDefinitionFlags<readonly [Def], "verbose">;
	type _clean = Expect<Equal<Extract<keyof Clean[0], "FIX_ALIAS_COLLISION">, never>>;

	// Widened shapes opt out via the `0 extends 1 & S` any-guard.
	type Widened = ValidateDefinitionFlags<readonly [{ readonly _shape?: any }], "force">;
	type _widened = Expect<Equal<Extract<keyof Widened[0], "FIX_ALIAS_COLLISION">, never>>;
}

// Tripwire for the live local validator's reserved negation-prefix contract.
type _noPrefix = Expect<
	Equal<
		LocalFlagBrand<{ name: "no-cache"; type: "boolean" }>["FIX_NO_PREFIX"],
		"Names must not start with no-"
	>
>;

{
	// brands invalid literal spellings beside an open template member (#357)
	type Mixed = `y-${string}`;
	type Reserved = LocalFlagBrand<{ name: "__proto__" | Mixed; type: "boolean" }>;
	type Empty = LocalFlagBrand<{ name: "" | Mixed; type: "boolean" }>;
	type NoPrefix = LocalFlagBrand<{ name: "no-x" | Mixed; type: "boolean" }>;
	type EmptyAlias = LocalFlagBrand<{ name: "x"; type: "boolean"; aliases: ["" | Mixed] }>;
	type NoPrefixAlias = LocalFlagBrand<{ name: "x"; type: "boolean"; aliases: ["no-x" | Mixed] }>;
	type ShortNoPrefix = LocalFlagBrand<{ name: "x"; type: "boolean"; short: "n" | Mixed }>;
	type EmptyShort = LocalFlagBrand<{ name: "x"; type: "boolean"; short: "" | Mixed }>;
	type Valid = LocalFlagBrand<{ name: "fixed" | Mixed; type: "boolean"; aliases: ["f" | Mixed] }>;
	type _reserved = Expect<
		Equal<Reserved["FIX_RESERVED_SPELLING"], 'Flag spelling "__proto__" is reserved'>
	>;
	type _empty = Expect<
		Equal<Empty["FIX_EMPTY_SPELLING"], "Flag names and aliases must be non-empty strings">
	>;
	type _noPrefix = Expect<Equal<NoPrefix["FIX_NO_PREFIX"], "Names must not start with no-">>;
	type _emptyAlias = Expect<
		Equal<EmptyAlias["FIX_EMPTY_SPELLING"], "Flag names and aliases must be non-empty strings">
	>;
	type _noPrefixAlias = Expect<
		Equal<NoPrefixAlias["FIX_NO_PREFIX"], "Names must not start with no-">
	>;
	type _shortNoPrefix = Expect<Equal<Extract<keyof ShortNoPrefix, "FIX_NO_PREFIX">, never>>;
	type _emptyShort = Expect<
		Equal<EmptyShort["FIX_EMPTY_SPELLING"], "Flag names and aliases must be non-empty strings">
	>;
	type _valid = Expect<Equal<Extract<keyof Valid, `FIX_${string}`>, never>>;

	type DirectReserved = LocalFlagNameBrand<"__proto__" | Mixed>;
	type DirectValid = LocalFlagNameBrand<"fixed" | Mixed>;
	type _directReserved = Expect<
		Equal<DirectReserved["FIX_RESERVED_SPELLING"], 'Flag spelling "__proto__" is reserved'>
	>;
	type _directValid = Expect<Equal<keyof DirectValid, never>>;

	// the same brands reach .flags() tuples; open members still opt out of collision evidence
	type Tuple = ValidateLocalFlagDefs<readonly [{ name: "" | Mixed; type: "boolean" }], "y-a">;
	type _tuple = Expect<
		Equal<Tuple["FIX_EMPTY_SPELLING"], "Flag names and aliases must be non-empty strings">
	>;
	type _tupleCollision = Expect<Equal<Extract<keyof Tuple, "FIX_ALIAS_COLLISION">, never>>;

	// a `string`-typed field must not absorb a sibling field's invalid literal
	type BroadName = LocalFlagBrand<{ name: string; type: "boolean"; aliases: [""] }>;
	type BroadNameNoPrefix = LocalFlagBrand<{ name: string; type: "boolean"; aliases: ["no-x"] }>;
	type BroadAliases = LocalFlagBrand<{ name: ""; type: "boolean"; aliases: string[] }>;
	type BroadShort = LocalFlagBrand<{ name: "__proto__"; type: "boolean"; short: string }>;
	type _broadName = Expect<
		Equal<BroadName["FIX_EMPTY_SPELLING"], "Flag names and aliases must be non-empty strings">
	>;
	type _broadNameNoPrefix = Expect<
		Equal<BroadNameNoPrefix["FIX_NO_PREFIX"], "Names must not start with no-">
	>;
	type _broadAliases = Expect<
		Equal<BroadAliases["FIX_EMPTY_SPELLING"], "Flag names and aliases must be non-empty strings">
	>;
	type _broadShort = Expect<
		Equal<BroadShort["FIX_RESERVED_SPELLING"], 'Flag spelling "__proto__" is reserved'>
	>;
}

{
	// distributes over a Context union: one flagless member must not erase the others' owned flags
	type Owner = { readonly _ownedFlags?: { alpha: { type: "string" } } };
	type Plain = { readonly _ownedFlags?: {} };
	type _union = Expect<Equal<ContextOwnedFlags<Owner | Plain>, { alpha: { type: "string" } } | {}>>;
	type _never = Expect<Equal<ContextOwnedFlags<never>, never>>;
}
