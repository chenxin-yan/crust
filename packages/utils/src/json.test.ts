import { describe, expect, it } from "vite-plus/test";

import { parseJsonValue } from "./json.ts";

describe("parseJsonValue", () => {
	it("leaves out object properties holding undefined, as JSON.stringify does", () => {
		const value = { prompt: "enabled", editor: undefined, nested: [{ a: undefined, b: 1 }] };

		const copy = parseJsonValue(value);

		expect(copy).toEqual({ prompt: "enabled", nested: [{ b: 1 }] });
		expect(Object.keys(copy as object)).toEqual(["prompt", "nested"]);
		expect(JSON.stringify(copy)).toBe(JSON.stringify(value));
	});

	it.each([
		["an undefined array element", { items: [1, undefined] }, "items[1]: Not JSON data"],
		[
			"a class instance",
			{ items: [{}, {}, {}, { createdAt: new Date(0) }] },
			"items[3].createdAt: Not a plain object",
		],
		["a function", { "a b": { run() {} } }, '["a b"].run: Not JSON data'],
		["a value at the root", new Map(), "Not a plain object"],
	])("names where %s sits", (_label, value, message) => {
		expect(() => parseJsonValue(value)).toThrow(new TypeError(message));
	});

	it("names a cycle where it closes", () => {
		const value: Record<string, unknown> = { list: [] };
		(value.list as unknown[]).push(value);

		expect(() => parseJsonValue(value)).toThrow(new TypeError("list[0]: Cycle"));
	});
});
