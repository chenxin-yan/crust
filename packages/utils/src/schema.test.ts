import { describe, expect, it } from "bun:test";

import {
	type InferOutput,
	isStandardSchema,
	normalizeStandardIssues,
	type StandardSchema,
} from "./schema.ts";

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

describe("schema detection", () => {
	it("accepts Standard Schema v1 objects", () => {
		const schema = {
			"~standard": {
				version: 1,
				validate: (value: unknown) => ({ value }),
			},
		};

		expect(isStandardSchema(schema)).toBe(true);
	});

	it("preserves structural compatibility and output inference", () => {
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

		expect(isStandardSchema(compatible)).toBe(true);
	});

	it("accepts callable Standard Schema wrappers", () => {
		function schema() {}
		Object.assign(schema, {
			"~standard": {
				version: 1,
				validate: (value: unknown) => ({ value }),
			},
		});

		expect(isStandardSchema(schema)).toBe(true);
	});

	it("rejects non-Standard Schema values", () => {
		expect(isStandardSchema({ "~standard": { version: 2, validate: () => ({}) } })).toBe(false);
		expect(isStandardSchema(null)).toBe(false);
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
