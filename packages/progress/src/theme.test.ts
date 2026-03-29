import { afterEach, describe, expect, it } from "bun:test";
import { bold, cyan, green, magenta, red, yellow } from "@crustjs/style";
import {
	createTheme,
	defaultTheme,
	getTheme,
	resolveTheme,
	setTheme,
} from "./theme.ts";
import type { ProgressTheme } from "./types.ts";

afterEach(() => {
	setTheme();
});

describe("defaultTheme", () => {
	it("has all required style slots defined", () => {
		const slotNames: (keyof ProgressTheme)[] = [
			"spinner",
			"message",
			"success",
			"error",
		];
		for (const slot of slotNames) {
			expect(typeof defaultTheme[slot]).toBe("function");
		}
	});

	it("uses expected default colors", () => {
		expect(defaultTheme.spinner).toBe(magenta);
		expect(defaultTheme.message).toBe(bold);
		expect(defaultTheme.success).toBe(green);
		expect(defaultTheme.error).toBe(red);
	});
});

describe("createTheme", () => {
	it("returns defaultTheme when called with no arguments", () => {
		expect(createTheme()).toBe(defaultTheme);
	});

	it("merges partial overrides onto default theme", () => {
		const theme = createTheme({ spinner: cyan, error: yellow });
		expect(theme.spinner).toBe(cyan);
		expect(theme.error).toBe(yellow);
		expect(theme.message).toBe(bold);
		expect(theme.success).toBe(green);
	});
});

describe("setTheme / getTheme", () => {
	it("returns defaultTheme when no global theme is set", () => {
		expect(getTheme()).toBe(defaultTheme);
	});

	it("applies global overrides", () => {
		setTheme({ spinner: cyan, success: yellow });
		const theme = getTheme();
		expect(theme.spinner).toBe(cyan);
		expect(theme.success).toBe(yellow);
		expect(theme.message).toBe(bold);
	});
});

describe("resolveTheme", () => {
	it("returns defaultTheme when no overrides are present", () => {
		expect(resolveTheme()).toBe(defaultTheme);
	});

	it("layers global and per-call overrides", () => {
		setTheme({ spinner: cyan });
		const theme = resolveTheme({ error: yellow });
		expect(theme.spinner).toBe(cyan);
		expect(theme.error).toBe(yellow);
		expect(theme.message).toBe(bold);
	});
});
