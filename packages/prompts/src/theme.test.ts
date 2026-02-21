import { describe, expect, it } from "bun:test";
import { bold, cyan, dim, green, magenta, red, yellow } from "@crustjs/style";
import { createTheme, defaultTheme, resolveTheme } from "./theme.ts";
import type { PromptTheme } from "./types.ts";

describe("defaultTheme", () => {
	it("has all required style slots defined", () => {
		const slotNames: (keyof PromptTheme)[] = [
			"prefix",
			"message",
			"placeholder",
			"cursor",
			"selected",
			"unselected",
			"error",
			"success",
			"hint",
			"spinner",
			"filterMatch",
		];
		for (const slot of slotNames) {
			expect(typeof defaultTheme[slot]).toBe("function");
		}
	});

	it("uses expected default colors", () => {
		expect(defaultTheme.prefix).toBe(cyan);
		expect(defaultTheme.message).toBe(bold);
		expect(defaultTheme.placeholder).toBe(dim);
		expect(defaultTheme.cursor).toBe(cyan);
		expect(defaultTheme.selected).toBe(yellow);
		expect(defaultTheme.unselected).toBe(dim);
		expect(defaultTheme.error).toBe(red);
		expect(defaultTheme.success).toBe(green);
		expect(defaultTheme.hint).toBe(dim);
		expect(defaultTheme.spinner).toBe(magenta);
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

describe("createTheme", () => {
	it("returns defaultTheme when called with no arguments", () => {
		const theme = createTheme();
		expect(theme).toBe(defaultTheme);
	});

	it("returns defaultTheme when called with undefined", () => {
		const theme = createTheme(undefined);
		expect(theme).toBe(defaultTheme);
	});

	it("merges partial overrides onto default theme", () => {
		const theme = createTheme({ prefix: magenta });
		expect(theme.prefix).toBe(magenta);
		// Other slots retain defaults
		expect(theme.message).toBe(bold);
		expect(theme.error).toBe(red);
		expect(theme.success).toBe(green);
	});

	it("overrides multiple slots at once", () => {
		const theme = createTheme({
			prefix: magenta,
			success: cyan,
			error: yellow,
		});
		expect(theme.prefix).toBe(magenta);
		expect(theme.success).toBe(cyan);
		expect(theme.error).toBe(yellow);
		// Untouched slots remain default
		expect(theme.message).toBe(bold);
		expect(theme.cursor).toBe(cyan);
	});

	it("accepts custom style functions", () => {
		const customStyle = (text: string) => `[${text}]`;
		const theme = createTheme({ prefix: customStyle });
		expect(theme.prefix("test")).toBe("[test]");
	});
});

describe("resolveTheme", () => {
	it("returns defaultTheme when no overrides provided", () => {
		const theme = resolveTheme();
		expect(theme).toBe(defaultTheme);
	});

	it("returns defaultTheme when both arguments are undefined", () => {
		const theme = resolveTheme(undefined, undefined);
		expect(theme).toBe(defaultTheme);
	});

	it("applies global theme overrides", () => {
		const theme = resolveTheme({ prefix: magenta });
		expect(theme.prefix).toBe(magenta);
		expect(theme.message).toBe(bold);
	});

	it("applies per-prompt theme overrides", () => {
		const theme = resolveTheme(undefined, { error: yellow });
		expect(theme.error).toBe(yellow);
		expect(theme.message).toBe(bold);
	});

	it("per-prompt overrides take priority over global overrides", () => {
		const theme = resolveTheme(
			{ prefix: magenta, error: yellow },
			{ prefix: green },
		);
		// Per-prompt wins for prefix
		expect(theme.prefix).toBe(green);
		// Global wins for error (no per-prompt override)
		expect(theme.error).toBe(yellow);
		// Default for everything else
		expect(theme.message).toBe(bold);
	});

	it("layers all three levels correctly", () => {
		const globalOverrides = { prefix: magenta, cursor: red };
		const promptOverrides = { cursor: green, success: yellow };
		const theme = resolveTheme(globalOverrides, promptOverrides);

		// Global override (no prompt override for this slot)
		expect(theme.prefix).toBe(magenta);
		// Per-prompt override wins over global
		expect(theme.cursor).toBe(green);
		// Per-prompt override (no global for this slot)
		expect(theme.success).toBe(yellow);
		// Default (no overrides)
		expect(theme.message).toBe(bold);
		expect(theme.error).toBe(red);
	});
});
