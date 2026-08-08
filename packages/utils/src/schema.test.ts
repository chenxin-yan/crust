import { describe, expect, it } from "bun:test";

import { type InferOutput, normalizeStandardIssues, type StandardSchema } from "./schema.ts";

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

describe("schema types", () => {
	it("preserves structural compatibility and output inference", async () => {
		const schema = {
			"~standard": {
				version: 1 as const,
				vendor: "crust-test",
				types: undefined as { input: string; output: number } | undefined,
				validate: (value: unknown) => ({ value: Number(value) }),
			},
		};
		const compatible: StandardSchema<string, number> = schema;
		type _Output = Expect<Equal<InferOutput<typeof schema>, number>>;

		expect(await compatible["~standard"].validate("42")).toEqual({ value: 42 });
	});
});

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
