import { afterEach, describe, expect, it } from "bun:test";
import { bold, cyan, dim, green, magenta, red, yellow } from "@crustjs/style";
import {
	createTheme,
	defaultTheme,
	getTheme,
	resolveTheme,
	setTheme,
} from "./theme.ts";
import type { PromptTheme } from "./types.ts";

// Reset global theme after each test to prevent state leakage
afterEach(() => {
	setTheme();
});

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
		expect(defaultTheme.selected).toBe(cyan);
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

describe("setTheme / getTheme", () => {
	it("getTheme returns defaultTheme when no global theme is set", () => {
		const theme = getTheme();
		expect(theme).toBe(defaultTheme);
	});

	it("setTheme applies global overrides", () => {
		setTheme({ prefix: magenta });
		const theme = getTheme();
		expect(theme.prefix).toBe(magenta);
		expect(theme.message).toBe(bold); // default preserved
	});

	it("setTheme with multiple slots", () => {
		setTheme({ prefix: magenta, error: yellow, success: cyan });
		const theme = getTheme();
		expect(theme.prefix).toBe(magenta);
		expect(theme.error).toBe(yellow);
		expect(theme.success).toBe(cyan);
		expect(theme.message).toBe(bold);
	});

	it("setTheme accepts a full PromptTheme from createTheme", () => {
		const custom = createTheme({ prefix: magenta, cursor: red });
		setTheme(custom);
		const theme = getTheme();
		expect(theme.prefix).toBe(magenta);
		expect(theme.cursor).toBe(red);
		expect(theme.message).toBe(bold);
	});

	it("setTheme with no arguments clears the global theme", () => {
		setTheme({ prefix: magenta });
		expect(getTheme().prefix).toBe(magenta);

		setTheme();
		expect(getTheme()).toBe(defaultTheme);
	});

	it("setTheme with undefined clears the global theme", () => {
		setTheme({ prefix: magenta });
		setTheme(undefined);
		expect(getTheme()).toBe(defaultTheme);
	});

	it("later setTheme calls replace previous global theme", () => {
		setTheme({ prefix: magenta });
		setTheme({ prefix: red, error: yellow });
		const theme = getTheme();
		expect(theme.prefix).toBe(red);
		expect(theme.error).toBe(yellow);
		// magenta prefix is gone — replaced, not merged
		expect(theme.spinner).toBe(magenta); // default
	});
});

describe("resolveTheme", () => {
	it("returns defaultTheme when no global or prompt overrides", () => {
		const theme = resolveTheme();
		expect(theme).toBe(defaultTheme);
	});

	it("applies global theme overrides", () => {
		setTheme({ prefix: magenta });
		const theme = resolveTheme();
		expect(theme.prefix).toBe(magenta);
		expect(theme.message).toBe(bold);
	});

	it("applies per-prompt overrides", () => {
		const theme = resolveTheme({ error: yellow });
		expect(theme.error).toBe(yellow);
		expect(theme.message).toBe(bold);
	});

	it("per-prompt overrides take priority over global overrides", () => {
		setTheme({ prefix: magenta, error: yellow });
		const theme = resolveTheme({ prefix: green });
		// Per-prompt wins for prefix
		expect(theme.prefix).toBe(green);
		// Global wins for error (no per-prompt override)
		expect(theme.error).toBe(yellow);
		// Default for everything else
		expect(theme.message).toBe(bold);
	});

	it("layers all three levels correctly", () => {
		setTheme({ prefix: magenta, cursor: red });
		const theme = resolveTheme({ cursor: green, success: yellow });

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
