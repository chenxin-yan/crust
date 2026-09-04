import { describe, expect, it } from "bun:test";

import type { Equal, Expect } from "../../tests/helpers.ts";
import type { FlagsDef, NamedFlagDef } from "../types.ts";
import type {
	DefinitionTreeSpellings,
	ProvideChecks,
	SpellingsOf,
	TreeSpellings,
	ValidateDefinitionFlags,
	ValidateExtensionFlags,
	ValidateNamedFlagDefs,
} from "./flags.brands.ts";

describe("ValidateNamedFlagDefs", () => {
	it("passes clean definitions through unchanged", () => {
		type Defs = readonly [
			{ name: "verbose"; type: "boolean"; short: "v" },
			{ name: "output"; type: "string"; aliases: ["out"] },
		];
		type Result = ValidateNamedFlagDefs<Defs>;
		type _resultPreservesDefs = Expect<Result extends Defs ? true : false>;
		type _defsRemainAccepted = Expect<Defs extends Result ? true : false>;

		expect(true).toBe(true);
	});

	it("brands an alias that collides with a sibling flag name", () => {
		type Defs = readonly [
			{ name: "output"; type: "string"; aliases: ["out"] },
			{ name: "out"; type: "string" },
		];
		type Result = ValidateNamedFlagDefs<Defs>;
		type _check = Expect<
			Equal<
				Result[0]["FIX_ALIAS_COLLISION"],
				'Alias "out" collides with another flag name or alias'
			>
		>;

		expect(true).toBe(true);
	});

	it("brands aliases that collide across sibling flags", () => {
		type Defs = readonly [
			{ name: "verbose"; type: "boolean"; short: "v" },
			{ name: "version"; type: "boolean"; aliases: ["v"] },
		];
		type Result = ValidateNamedFlagDefs<Defs>;
		type _checkFirst = Expect<
			Equal<Result[0]["FIX_ALIAS_COLLISION"], 'Alias "v" collides with another flag name or alias'>
		>;
		type _checkSecond = Expect<
			Equal<Result[1]["FIX_ALIAS_COLLISION"], 'Alias "v" collides with another flag name or alias'>
		>;

		expect(true).toBe(true);
	});

	it("brands both occurrences of a canonical name repeated within one call", () => {
		type Defs = readonly [{ name: "mode"; type: "string" }, { name: "mode"; type: "number" }];
		type Result = ValidateNamedFlagDefs<Defs>;
		type _checkFirst = Expect<
			Equal<Result[0]["FIX_ALIAS_COLLISION"], 'Flag "mode" is already defined'>
		>;
		type _checkSecond = Expect<
			Equal<Result[1]["FIX_ALIAS_COLLISION"], 'Flag "mode" is already defined'>
		>;

		expect(true).toBe(true);
	});

	it("keeps alias-free and aliased duplicate-name validation in parity", () => {
		type AliasFree = ValidateNamedFlagDefs<
			readonly [{ name: "mode"; type: "string" }, { name: "mode"; type: "number" }]
		>;
		type Aliased = ValidateNamedFlagDefs<
			readonly [
				{ name: "mode"; type: "string"; aliases: ["text-mode"] },
				{ name: "mode"; type: "number"; aliases: ["number-mode"] },
			]
		>;
		type _sameFirstBrand = Expect<
			Equal<AliasFree[0]["FIX_ALIAS_COLLISION"], Aliased[0]["FIX_ALIAS_COLLISION"]>
		>;
		type _sameSecondBrand = Expect<
			Equal<AliasFree[1]["FIX_ALIAS_COLLISION"], Aliased[1]["FIX_ALIAS_COLLISION"]>
		>;
		type _sameBrands = Expect<
			Equal<
				Extract<keyof AliasFree[0], `FIX_${string}`>,
				Extract<keyof Aliased[0], `FIX_${string}`>
			>
		>;
		type CleanAliasFree = ValidateNamedFlagDefs<readonly [{ name: "output"; type: "string" }]>;
		type CleanAliased = ValidateNamedFlagDefs<
			readonly [{ name: "output"; type: "string"; aliases: ["out"] }]
		>;
		type _aliasFreeRemainsUnbranded = Expect<
			Equal<Extract<keyof CleanAliasFree[0], `FIX_${string}`>, never>
		>;
		type _aliasedRemainsUnbranded = Expect<
			Equal<Extract<keyof CleanAliased[0], `FIX_${string}`>, never>
		>;

		expect(true).toBe(true);
	});

	it("brands a short alias equal to its own flag name", () => {
		type Defs = readonly [{ name: "m"; type: "string"; short: "m" }];
		type Result = ValidateNamedFlagDefs<Defs>;
		type _check = Expect<
			Equal<Result[0]["FIX_ALIAS_COLLISION"], 'Alias "m" collides with another flag name or alias'>
		>;

		expect(true).toBe(true);
	});

	it("extracts all literal spellings from an existing flags record", () => {
		type Existing = {
			verbose: { type: "boolean"; short: "v" };
			output: { type: "string"; aliases: ["out", "destination"] };
		};
		type _check = Expect<
			Equal<SpellingsOf<Existing>, "verbose" | "v" | "output" | "out" | "destination">
		>;

		expect(true).toBe(true);
	});

	it("brands spellings that collide with an existing flags record", () => {
		type Defs = readonly [{ name: "version"; type: "boolean"; short: "v" }];
		type Result = ValidateNamedFlagDefs<Defs, "verbose" | "v">;
		type _check = Expect<
			Equal<Result[0]["FIX_ALIAS_COLLISION"], 'Flag spelling "v" collides with an existing flag'>
		>;

		expect(true).toBe(true);
	});

	it("brands an alias-free name that collides with an existing spelling", () => {
		type Result = ValidateNamedFlagDefs<
			readonly [{ name: "verbose"; type: "boolean" }],
			"verbose" | "v"
		>;
		type _check = Expect<
			Equal<
				Result[0]["FIX_ALIAS_COLLISION"],
				'Flag spelling "verbose" collides with an existing flag'
			>
		>;

		expect(true).toBe(true);
	});

	it("brands Promise-returning custom parsers", () => {
		type Defs = readonly [
			{ name: "remote"; type: "string"; parse: (raw: string) => Promise<string> },
		];
		type Result = ValidateNamedFlagDefs<Defs>;
		type _check = Expect<
			Equal<Result[0]["FIX_ASYNC_PARSE"], "parse must be synchronous; do async work in run()">
		>;

		expect(true).toBe(true);
	});

	it("brands sometimes-async custom parsers (union return type)", () => {
		type Defs = readonly [
			{ name: "remote"; type: "string"; parse: (raw: string) => Promise<string> | string },
		];
		type Result = ValidateNamedFlagDefs<Defs>;
		type _check = Expect<
			Equal<Result[0]["FIX_ASYNC_PARSE"], "parse must be synchronous; do async work in run()">
		>;

		expect(true).toBe(true);
	});

	it("does not brand parsers returning any", () => {
		// JSON.parse-style parsers return `any` and must stay unbranded
		type Defs = readonly [{ name: "config"; type: "string"; parse: (raw: string) => any }];
		type Result = ValidateNamedFlagDefs<Defs>;
		type _check = Expect<Equal<"FIX_ASYNC_PARSE" extends keyof Result[0] ? true : false, false>>;

		expect(true).toBe(true);
	});

	// Tripwire: this alias-free def is branded via the `Validated` slot, so it
	// proves the validation pipeline still fires through the always-true deferral
	// conditional in ValidateNamedFlagDefs (flags.brands.ts). Do not remove or reroute.
	it('brands a flag name starting with "no-"', () => {
		type Defs = readonly [{ name: "no-cache"; type: "boolean" }];
		type Result = ValidateNamedFlagDefs<Defs>;
		type _check = Expect<
			Equal<
				Result[0]["FIX_NO_PREFIX"],
				'Flag name "no-cache" must not start with "no-"; define "cache" instead and use "--no-cache" at runtime'
			>
		>;

		expect(true).toBe(true);
	});

	it("opts widened definitions themselves out of compile-time checks", () => {
		// Widened records have no statically knowable spellings. A fluent builder
		// still retains spellings accumulated before a widened .flags() call.
		type _widenedRecord = Expect<Equal<SpellingsOf<FlagsDef>, never>>;

		// Widened names/aliases opt out instead of receiving false-positive
		// branding against existing spellings.
		type Defs = readonly [{ name: string; type: "string"; short: string; aliases: string[] }];
		type Result = ValidateNamedFlagDefs<Defs, "verbose" | "v">;
		type _noBrands = Expect<Equal<Extract<keyof Result[0], `FIX_${string}`>, never>>;

		// Context instances with widened owned flags opt out of provide-site checks.
		type Provided = ProvideChecks<"verbose" | "v", readonly [{ readonly _ownedFlags?: FlagsDef }]>;
		type _noProvideBrand = Expect<Equal<Extract<keyof Provided[0], `FIX_${string}`>, never>>;

		expect(true).toBe(true);
	});

	it('brands an alias starting with "no-"', () => {
		type Defs = readonly [{ name: "cache"; type: "boolean"; aliases: ["no-store"] }];
		type Result = ValidateNamedFlagDefs<Defs>;
		type _check = Expect<
			Equal<
				Result[0]["FIX_NO_PREFIX"],
				'Alias "no-store" must not start with "no-"; the "no-" prefix is reserved for boolean negation'
			>
		>;

		expect(true).toBe(true);
	});

	it("brands literal defaults outside literal choices", () => {
		type InvalidSingle = ValidateNamedFlagDefs<
			readonly [{ name: "mode"; type: "string"; choices: ["a", "b"]; default: "z" }]
		>;
		type InvalidMultiple = ValidateNamedFlagDefs<
			readonly [
				{ name: "mode"; type: "string"; multiple: true; choices: ["a", "b"]; default: ["a", "z"] },
			]
		>;
		type Valid = ValidateNamedFlagDefs<
			readonly [{ name: "mode"; type: "string"; choices: ["a", "b"]; default: "a" }]
		>;
		type Widened = ValidateNamedFlagDefs<
			readonly [{ name: "mode"; type: "string"; choices: readonly string[]; default: string }]
		>;
		type _single = Expect<
			Equal<InvalidSingle[0]["FIX_DEFAULT_CHOICE"], "default must be one of choices">
		>;
		type _multiple = Expect<
			Equal<InvalidMultiple[0]["FIX_DEFAULT_CHOICE"], "default must be one of choices">
		>;
		type _valid = Expect<Equal<Extract<keyof Valid[0], "FIX_DEFAULT_CHOICE">, never>>;
		type _widened = Expect<Equal<Extract<keyof Widened[0], "FIX_DEFAULT_CHOICE">, never>>;

		expect(true).toBe(true);
	});

	it("brands Context-owned flag collisions inside one .provide() batch", () => {
		type First = { readonly _ownedFlags?: { token: { type: "string"; required: true } } };
		type Second = { readonly _ownedFlags?: { auth: { type: "string"; aliases: ["token"] } } };
		type Batch = ProvideChecks<never, readonly [First, Second]>;
		type _first = Expect<Equal<Extract<keyof Batch[0], "FIX_ALIAS_COLLISION">, never>>;
		type _second = Expect<
			Equal<Batch[1]["FIX_ALIAS_COLLISION"], 'Flag spelling "token" collides with an existing flag'>
		>;

		expect(true).toBe(true);
	});

	it("brands Extension flag spellings colliding with existing or earlier-Extension flags", () => {
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
		type Widened = ValidateExtensionFlags<
			readonly [{ readonly _flagDefs?: NamedFlagDef[] }],
			"mode"
		>;
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

		expect(true).toBe(true);
	});

	it("brands empty flag names and aliases", () => {
		type Name = ValidateNamedFlagDefs<readonly [{ name: ""; type: "boolean" }]>;
		type Alias = ValidateNamedFlagDefs<readonly [{ name: "safe"; type: "boolean"; aliases: [""] }]>;
		type Widened = ValidateNamedFlagDefs<readonly [{ name: string; type: "boolean" }]>;
		type _name = Expect<
			Equal<Name[0]["FIX_EMPTY_SPELLING"], "Flag names and aliases must be non-empty strings">
		>;
		type _alias = Expect<
			Equal<Alias[0]["FIX_EMPTY_SPELLING"], "Flag names and aliases must be non-empty strings">
		>;
		type _widened = Expect<Equal<Extract<keyof Widened[0], "FIX_EMPTY_SPELLING">, never>>;

		expect(true).toBe(true);
	});

	it("recurses flag spellings through nested subcommand shapes", () => {
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
		type _any = Expect<Equal<TreeSpellings<any>, never>>;

		expect(true).toBe(true);
	});

	it("brands a definition whose nested child flag collides with an Extension flag", () => {
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

		expect(true).toBe(true);
	});

	it('brands the reserved "__proto__" spelling', () => {
		type Name = ValidateNamedFlagDefs<readonly [{ name: "__proto__"; type: "boolean" }]>;
		type Alias = ValidateNamedFlagDefs<
			readonly [{ name: "safe"; type: "boolean"; aliases: ["__proto__"] }]
		>;
		type _name = Expect<
			Equal<Name[0]["FIX_RESERVED_SPELLING"], 'Flag spelling "__proto__" is reserved'>
		>;
		type _alias = Expect<
			Equal<Alias[0]["FIX_RESERVED_SPELLING"], 'Flag spelling "__proto__" is reserved'>
		>;

		expect(true).toBe(true);
	});
});
