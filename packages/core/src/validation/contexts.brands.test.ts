import { describe, expect, it } from "bun:test";

import type { ContextInstance } from "../api/context.ts";
import type {
	ValidateContextDeps,
	ValidateContextNames,
	ValidateDeclaredDeps,
} from "./contexts.brands.ts";

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;
type Inst<Name extends string, Deps extends Record<string, unknown> = {}> = ContextInstance<
	Name,
	unknown,
	{},
	Deps
>;
type ValueInst<Name extends string, Value> = ContextInstance<Name, Value>;
type NameBrandOf<T> = Extract<keyof T, "FIX_DUPLICATE_CONTEXT">;

describe("compile-time Context validation", () => {
	it("brands an unsatisfied dependency and accepts same-batch providers", () => {
		type Missing = ValidateContextDeps<{}, readonly [Inst<"db", { config: string }>]>;
		type _missing = Expect<
			Equal<
				Missing[0]["FIX_MISSING_DEPENDENCY"],
				'Context "db" uses Context "config" which is not provided on this command path'
			>
		>;
		type Satisfied = ValidateContextDeps<
			{},
			readonly [Inst<"db", { config: string }>, Inst<"config">]
		>;
		type _satisfied = Expect<Equal<Extract<keyof Satisfied[0], "FIX_MISSING_DEPENDENCY">, never>>;

		expect(true).toBe(true);
	});
	it("brands a same-name provider whose value type mismatches the declared dependency", () => {
		type Consumer = ContextInstance<"db", unknown, {}, { config: { url: string } }>;

		type Mismatch = ValidateContextDeps<{}, readonly [Consumer, ValueInst<"config", number>]>;
		type _mismatch = Expect<
			Equal<
				Mismatch[0]["FIX_DEPENDENCY_TYPE"],
				'Context "db" uses Context "config" whose provided value does not satisfy the declared dependency type'
			>
		>;

		type Satisfied = ValidateContextDeps<
			{},
			readonly [Consumer, ValueInst<"config", { url: string; extra: boolean }>]
		>;
		type _satisfied = Expect<Equal<Extract<keyof Satisfied[0], "FIX_DEPENDENCY_TYPE">, never>>;

		// Earlier-call providers are checked through the accumulated Ctx values.
		type CtxMismatch = ValidateContextDeps<{ config: number }, readonly [Consumer]>;
		type _ctx = Expect<
			Equal<Extract<keyof CtxMismatch[0], "FIX_DEPENDENCY_TYPE">, "FIX_DEPENDENCY_TYPE">
		>;

		// any-valued providers and widened registries opt out.
		type AnyValue = ValidateContextDeps<{}, readonly [Consumer, ValueInst<"config", any>]>;
		type _any = Expect<Equal<Extract<keyof AnyValue[0], "FIX_DEPENDENCY_TYPE">, never>>;
		type Widened = ValidateContextDeps<Record<string, unknown>, readonly [Consumer]>;
		type _widened = Expect<Equal<Extract<keyof Widened[0], "FIX_DEPENDENCY_TYPE">, never>>;

		expect(true).toBe(true);
	});

	it("opts widened instance dependency maps out of the missing-dependency brand", () => {
		type WidenedDeps = ValidateContextDeps<{}, readonly [Inst<"db", any>]>;
		type _widened = Expect<Equal<Extract<keyof WidenedDeps[0], "FIX_MISSING_DEPENDENCY">, never>>;

		type IndexedDeps = ValidateContextDeps<{}, readonly [Inst<"db", Record<string, unknown>>]>;
		type _indexed = Expect<Equal<Extract<keyof IndexedDeps[0], "FIX_MISSING_DEPENDENCY">, never>>;

		expect(true).toBe(true);
	});

	it("brands sealed-unit dependencies and opts widened contracts out", () => {
		type Missing = ValidateDeclaredDeps<{}, readonly [{ readonly _deps?: { db: string } }]>;
		type _missing = Expect<
			Equal<Missing[0]["FIX_MISSING_DEPENDENCY"], 'Uses Context "db" which is not provided'>
		>;
		type Broad = ValidateDeclaredDeps<{}, readonly [{ readonly _deps?: Record<string, unknown> }]>;
		type _broad = Expect<Equal<Extract<keyof Broad[0], "FIX_MISSING_DEPENDENCY">, never>>;

		expect(true).toBe(true);
	});

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
