import { describe, expect, it } from "bun:test";

import type { StandardSchemaV1 } from "@standard-schema/spec";

import { isStandardSchema, normalizeStandardIssues } from "./schema.ts";

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
			{ message: "Required" },
		] satisfies StandardSchemaV1.Issue[];

		expect(normalizeStandardIssues(issues, ["flags"])).toEqual([
			{ message: "Expected string", path: "flags.name" },
			{ message: "Required", path: "flags" },
		]);
	});
});
