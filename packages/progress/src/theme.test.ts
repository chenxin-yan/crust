import { describe, expect, it } from "bun:test";

import { bold, cyan, green, yellow } from "@crustjs/style";

import { resolveTheme } from "./theme.ts";

describe("resolveTheme", () => {
	it("merges partial overrides onto default theme", () => {
		const theme = resolveTheme({ spinner: cyan, error: yellow });
		expect(theme.spinner).toBe(cyan);
		expect(theme.error).toBe(yellow);
		expect(theme.message).toBe(bold);
		expect(theme.success).toBe(green);
	});
});
