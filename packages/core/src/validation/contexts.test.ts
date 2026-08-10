import { describe, expect, it } from "bun:test";

import type { ContextInstance } from "../api/context.ts";
import type { ValidateContextNames } from "./contexts.ts";

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;
type Inst<Name extends string, RC extends Record<string, unknown> = {}> = ContextInstance<
	Name,
	unknown,
	RC
>;
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
