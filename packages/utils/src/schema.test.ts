import { describe, expect, it } from "bun:test";

import { type InferOutput, normalizeStandardIssues, type StandardSchema } from "./schema.ts";

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

// Compile-time compatibility and inference; checked by check:types.
const schema = {
	"~standard": {
		version: 1 as const,
		vendor: "crust-test",
		types: undefined as { input: string; output: number } | undefined,
		validate: (value: NonNullable<StandardSchema["~standard"]["types"]>["input"]) => ({
			value: Number(value),
		}),
	},
};
schema satisfies StandardSchema<string, number>;
type _Output = Expect<Equal<InferOutput<typeof schema>, number>>;

describe("schema issue normalization", () => {
	it("normalizes Standard Schema issues with an optional prefix", () => {
		const issues = [
			{ message: "Expected string", path: [{ key: "name" }] },
			{ message: "Expected item", path: [0] },
			{ message: "Required" },
		] satisfies Parameters<typeof normalizeStandardIssues>[0];

		expect(normalizeStandardIssues(issues, ["flags"])).toEqual([
			{ message: "Expected string", path: "flags.name" },
			{ message: "Expected item", path: "flags[0]" },
			{ message: "Required", path: "flags" },
		]);
	});
});
