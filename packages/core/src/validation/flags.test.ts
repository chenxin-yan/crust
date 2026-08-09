import { describe, expect, it } from "bun:test";

import type { FlagsDef } from "../types.ts";
import {
	type ProvideChecks,
	type SpellingsOf,
	validateIncomingFlag,
	type ValidateNamedFlagDefs,
} from "./flags.ts";

type Expect<T extends true> = T;
type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

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

	it("opts widened definitions out of compile-time checks", () => {
		// Widened records have no statically knowable spellings.
		type _widenedRecord = Expect<Equal<SpellingsOf<FlagsDef>, never>>;

		// Widened names/aliases fall back to runtime validation instead of
		// false-positive branding against existing spellings.
		type Defs = readonly [{ name: string; type: "string"; short: string; aliases: string[] }];
		type Result = ValidateNamedFlagDefs<Defs, "verbose" | "v">;
		type _noBrands = Expect<Equal<Extract<keyof Result[0], `FIX_${string}`>, never>>;

		// Context instances with widened owned flags opt out of provide-site checks.
		type Provided = ProvideChecks<
			{ verbose: { type: "boolean"; short: "v" } },
			readonly [{ readonly _requires?: { ownedFlags: FlagsDef } }]
		>;
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
});

describe("validateIncomingFlag", () => {
	it("rejects canonical names that collide with an existing short or alias", () => {
		expect(() =>
			validateIncomingFlag(
				{ name: "v", def: { type: "boolean" } },
				{ verbose: { type: "boolean", short: "v" } },
				'Context "logger"',
			),
		).toThrow(/collides with flag "--verbose"/);
		expect(() =>
			validateIncomingFlag(
				{ name: "out", def: { type: "string" } },
				{ output: { type: "string", aliases: ["out"] } },
				'Context "writer"',
			),
		).toThrow(/collides with flag "--output"/);
	});

	it("rejects incoming short and aliases that collide with existing spellings", () => {
		const existing = {
			verbose: { type: "boolean", short: "v", aliases: ["loud"] },
		} satisfies FlagsDef;
		expect(() =>
			validateIncomingFlag(
				{ name: "version", def: { type: "boolean", short: "v" } },
				existing,
				'Context "release"',
			),
		).toThrow(/spelling "v"/);
		expect(() =>
			validateIncomingFlag(
				{ name: "log", def: { type: "string", aliases: ["loud"] } },
				existing,
				'Context "logger"',
			),
		).toThrow(/spelling "loud"/);
	});

	it("rejects duplicate spellings within the incoming definition", () => {
		expect(() =>
			validateIncomingFlag(
				{ name: "output", def: { type: "string", short: "o", aliases: ["o"] } },
				{},
				'Context "writer"',
			),
		).toThrow(/repeats spelling "o"/);
	});
});
