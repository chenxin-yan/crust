import { describe, expect, it } from "bun:test";

import type { ContextInstance } from "../api/context.ts";
import type { ValidateContextCycles, ValidateContextNames } from "./contexts.ts";

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;
type Inst<Name extends string, RC extends Record<string, unknown> = {}> = ContextInstance<
	Name,
	unknown,
	RC
>;
type BrandOf<T> = Extract<keyof T, "FIX_CONTEXT_CYCLE">;
type NameBrandOf<T> = Extract<keyof T, "FIX_DUPLICATE_CONTEXT">;

describe("compile-time duplicate context name validation", () => {
	it("brands a name already provided in an earlier call", () => {
		type Result = ValidateContextNames<{ db: number }, readonly [Inst<"db">]>;
		type _check = Expect<
			Equal<
				Result[0]["FIX_DUPLICATE_CONTEXT"],
				'Context "db" is already provided on this command path'
			>
		>;

		expect(true).toBe(true);
	});

	it("brands both occurrences of a same-call duplicate", () => {
		type Result = ValidateContextNames<{}, readonly [Inst<"db">, Inst<"db">]>;
		type _first = Expect<
			Equal<
				Result[0]["FIX_DUPLICATE_CONTEXT"],
				'Context "db" is already provided on this command path'
			>
		>;
		type _second = Expect<
			Equal<
				Result[1]["FIX_DUPLICATE_CONTEXT"],
				'Context "db" is already provided on this command path'
			>
		>;

		expect(true).toBe(true);
	});

	it("accepts distinct names", () => {
		type Result = ValidateContextNames<{ db: number }, readonly [Inst<"cache">, Inst<"auth">]>;
		type _first = Expect<Equal<NameBrandOf<Result[0]>, never>>;
		type _second = Expect<Equal<NameBrandOf<Result[1]>, never>>;

		expect(true).toBe(true);
	});

	it("opts widened names and registries out", () => {
		type WidenedName = ValidateContextNames<{ db: number }, readonly [Inst<string>]>;
		type _name = Expect<Equal<NameBrandOf<WidenedName[0]>, never>>;

		type WidenedRegistry = ValidateContextNames<Record<string, unknown>, readonly [Inst<"db">]>;
		type _registry = Expect<Equal<NameBrandOf<WidenedRegistry[0]>, never>>;

		expect(true).toBe(true);
	});
});

describe("compile-time context cycle validation", () => {
	it("brands a direct cross-call cycle", () => {
		type Result = ValidateContextCycles<{ a: "b" }, readonly [Inst<"b", { a: unknown }>]>;
		type _check = Expect<
			Equal<Result[0]["FIX_CONTEXT_CYCLE"], 'Context "b" forms a dependency cycle'>
		>;

		expect(true).toBe(true);
	});

	it("brands a self-cycle", () => {
		type Result = ValidateContextCycles<{}, readonly [Inst<"a", { a: unknown }>]>;
		type _check = Expect<
			Equal<Result[0]["FIX_CONTEXT_CYCLE"], 'Context "a" forms a dependency cycle'>
		>;

		expect(true).toBe(true);
	});

	it("brands a transitive three-node cycle", () => {
		type Result = ValidateContextCycles<{ a: "b"; b: "c" }, readonly [Inst<"c", { a: unknown }>]>;
		type _check = Expect<
			Equal<Result[0]["FIX_CONTEXT_CYCLE"], 'Context "c" forms a dependency cycle'>
		>;

		expect(true).toBe(true);
	});

	it("brands both halves of a same-call batch cycle", () => {
		type Result = ValidateContextCycles<
			{},
			readonly [Inst<"a", { b: unknown }>, Inst<"b", { a: unknown }>]
		>;
		type _first = Expect<
			Equal<Result[0]["FIX_CONTEXT_CYCLE"], 'Context "a" forms a dependency cycle'>
		>;
		type _second = Expect<
			Equal<Result[1]["FIX_CONTEXT_CYCLE"], 'Context "b" forms a dependency cycle'>
		>;

		expect(true).toBe(true);
	});

	it("accepts diamond dependencies", () => {
		type Result = ValidateContextCycles<
			{ db: "base"; cache: "base"; base: never },
			readonly [Inst<"app", { db: unknown; cache: unknown }>]
		>;
		type _check = Expect<Equal<BrandOf<Result[0]>, never>>;

		expect(true).toBe(true);
	});

	it("accepts a not-yet-provided dependency (order-free provide)", () => {
		type Result = ValidateContextCycles<{}, readonly [Inst<"b", { missing: unknown }>]>;
		type _check = Expect<Equal<BrandOf<Result[0]>, never>>;

		expect(true).toBe(true);
	});

	it("opts widened instances and graphs out of cycle detection", () => {
		type WidenedName = ValidateContextCycles<{ a: "b" }, readonly [Inst<string, { a: unknown }>]>;
		type _name = Expect<Equal<BrandOf<WidenedName[0]>, never>>;

		type WidenedReqs = ValidateContextCycles<
			{ a: "b" },
			readonly [Inst<"b", Record<string, unknown>>]
		>;
		type _reqs = Expect<Equal<BrandOf<WidenedReqs[0]>, never>>;

		type WidenedGraph = ValidateContextCycles<
			Record<string, string>,
			readonly [Inst<"b", { a: unknown }>]
		>;
		type _graph = Expect<Equal<BrandOf<WidenedGraph[0]>, never>>;

		expect(true).toBe(true);
	});
});
