import { describe, expect, it } from "bun:test";

import type { ContextInstance } from "../api/context.ts";
import type { ValidateContextDeps, ValidateContextNames } from "./contexts.brands.ts";

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;
type Inst<Name extends string, Deps extends Record<string, unknown> = {}> = ContextInstance<
	Name,
	unknown,
	{},
	Deps
>;
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
