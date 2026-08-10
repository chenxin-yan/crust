import { describe, expect, it } from "bun:test";

import { bold, cyan, green, magenta, red, yellow } from "@crustjs/style";

import { defaultTheme, resolveTheme } from "./theme.ts";

describe("defaultTheme", () => {
	it("uses expected default colors", () => {
		expect(defaultTheme.spinner).toBe(magenta);
		expect(defaultTheme.message).toBe(bold);
		expect(defaultTheme.success).toBe(green);
		expect(defaultTheme.error).toBe(red);
	});
});

describe("resolveTheme", () => {
	it("returns defaultTheme when no overrides are present", () => {
		expect(resolveTheme()).toBe(defaultTheme);
	});

	it("merges partial overrides onto default theme", () => {
		const theme = resolveTheme({ spinner: cyan, error: yellow });
		expect(theme.spinner).toBe(cyan);
		expect(theme.error).toBe(yellow);
		expect(theme.message).toBe(bold);
		expect(theme.success).toBe(green);
	});
});
