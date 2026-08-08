import { describe, expect, it } from "bun:test";

import { bold, cyan, dim, green, magenta, red, yellow } from "@crustjs/style";

import { defaultTheme, resolveTheme } from "./theme.ts";

describe("defaultTheme", () => {
	it("uses expected default colors", () => {
		expect(defaultTheme.prefix).toBe(cyan);
		expect(defaultTheme.message).toBe(bold);
		expect(defaultTheme.placeholder).toBe(dim);
		expect(defaultTheme.cursor).toBe(cyan);
		expect(defaultTheme.selected).toBe(cyan);
		expect(defaultTheme.unselected).toBe(dim);
		expect(defaultTheme.error).toBe(red);
		expect(defaultTheme.success).toBe(green);
		expect(defaultTheme.hint).toBe(dim);
		expect(defaultTheme.filterMatch).toBe(cyan);
	});

	it("style functions accept and return strings", () => {
		const text = "hello";
		for (const slot of Object.values(defaultTheme)) {
			const result = slot(text);
			expect(typeof result).toBe("string");
			// Result should contain the original text (ANSI wrapping preserves content)
			expect(result).toContain(text);
		}
	});
});

describe("resolveTheme", () => {
	it("returns defaultTheme when no overrides", () => {
		expect(resolveTheme()).toBe(defaultTheme);
	});

	it("merges partial overrides onto default theme", () => {
		const theme = resolveTheme({ prefix: magenta, error: yellow });
		expect(theme.prefix).toBe(magenta);
		expect(theme.error).toBe(yellow);
		// Untouched slots remain default
		expect(theme.message).toBe(bold);
		expect(theme.success).toBe(green);
	});

	it("accepts custom style functions", () => {
		const customStyle = (text: string) => `[${text}]`;
		const theme = resolveTheme({ prefix: customStyle });
		expect(theme.prefix("test")).toBe("[test]");
	});
});
