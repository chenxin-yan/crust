import { describe, expect, it } from "bun:test";

import type { ValidateVariadicArgs } from "./args.ts";

type Expect<T extends true> = T;
type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

describe("ValidateVariadicArgs type inference", () => {
	it("resolves to identity when variadic is the last arg", () => {
		type Args = readonly [
			{ name: "name"; type: "string"; required: true },
			{ name: "files"; type: "string"; variadic: true },
		];
		type Result = ValidateVariadicArgs<Args>;
		type _check = Expect<Equal<Result, Args>>;

		expect(true).toBe(true);
	});

	it("resolves to identity when no args are variadic", () => {
		type Args = readonly [
			{ name: "name"; type: "string"; required: true },
			{ name: "port"; type: "number"; default: 3000 },
		];
		type Result = ValidateVariadicArgs<Args>;
		type _check = Expect<Equal<Result, Args>>;

		expect(true).toBe(true);
	});

	it("brands the specific non-last arg that is variadic", () => {
		type Args = readonly [
			{ name: "files"; type: "string"; variadic: true },
			{ name: "name"; type: "string"; required: true },
		];
		type Result = ValidateVariadicArgs<Args>;
		// First arg (variadic, non-last) gets branded error
		type _checkFirst = Expect<
			Equal<
				Result[0],
				Args[0] & {
					readonly FIX_VARIADIC_POSITION: "Only the last positional argument can be variadic";
				}
			>
		>;
		// Second arg (last) is unchanged
		type _checkSecond = Expect<Equal<Result[1], Args[1]>>;

		expect(true).toBe(true);
	});

	it("resolves to identity for a single arg", () => {
		type Args = readonly [{ name: "file"; type: "string"; variadic: true }];
		type Result = ValidateVariadicArgs<Args>;
		type _check = Expect<Equal<Result, Args>>;

		expect(true).toBe(true);
	});

	it("resolves to identity for empty args", () => {
		type Args = readonly [];
		type Result = ValidateVariadicArgs<Args>;
		type _check = Expect<Equal<Result, Args>>;

		expect(true).toBe(true);
	});
});
