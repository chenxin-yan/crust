import { describe, expect, it } from "bun:test";

import { normalizeStandardIssues } from "./schema.ts";

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
