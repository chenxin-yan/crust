import { describe, expect, it } from "bun:test";

import type { StandardSchemaV1 } from "@standard-schema/spec";

import {
	assertStandardSchema,
	formatPath,
	isStandardSchema,
	normalizeStandardIssues,
	normalizeStandardPath,
} from "./index.ts";

describe("schema assertions", () => {
	it("accepts Standard Schema v1 objects", () => {
		const schema = {
			"~standard": {
				version: 1,
				validate: (value: unknown) => ({ value }),
			},
		};

		expect(isStandardSchema(schema)).toBe(true);
		expect(() => assertStandardSchema(schema, "schema")).not.toThrow();
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

	it("rejects non-Standard Schema values with a descriptive assertion error", () => {
		expect(isStandardSchema({ "~standard": { version: 2, validate: () => ({}) } })).toBe(false);
		expect(() => assertStandardSchema(null, "flags.schema")).toThrow(
			/flags\.schema: argument must be a Standard Schema v1 object/,
		);
	});
});

describe("schema issue normalization", () => {
	it("formats property paths with dot and bracket notation", () => {
		expect(formatPath([])).toBe("");
		expect(formatPath(["flags", "verbose"])).toBe("flags.verbose");
		expect(formatPath(["args", 0, "name"])).toBe("args[0].name");
	});

	it("normalizes absent, bare-key, and object segment paths", () => {
		expect(normalizeStandardPath(undefined)).toEqual([]);
		expect(normalizeStandardPath(["flags", 0])).toEqual(["flags", 0]);
		expect(normalizeStandardPath([{ key: "args" }, { key: 1 }])).toEqual(["args", 1]);
	});

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
