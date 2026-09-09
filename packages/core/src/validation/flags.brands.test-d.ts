import type { Equal, Expect } from "../../tests/helpers.ts";
import type { NamedFlagDef } from "../types.ts";
import type {
	DefinitionTreeSpellings,
	ProvideChecks,
	SpellingsOf,
	TreeSpellings,
	ValidateDefinitionFlags,
	ValidateExtensionFlags,
	LocalFlagBrand,
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
	type Ext<Defs extends readonly NamedFlagDef[], Provides extends readonly unknown[] = []> = {
		readonly _flagDefs?: Defs;
		readonly provides?: Provides;
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
	type _widened = Expect<
		Equal<Extract<keyof Widened[0], "FIX_ALIAS_COLLISION">, "FIX_ALIAS_COLLISION">
	>;
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
