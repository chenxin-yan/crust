import { describe, expect, it } from "bun:test";

import { bold, green, magenta, yellow } from "@crustjs/style";

import { defaultTheme, resolveTheme } from "./theme.ts";

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
});
