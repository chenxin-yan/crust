import { describe, expect, it } from "bun:test";

import type { ProgressTheme } from "../src/index.ts";
import { createTheme } from "../src/index.ts";

describe("createTheme integration", () => {
	it("returns a valid theme with all slots defined", () => {
		const theme = createTheme();
		const requiredSlots: (keyof ProgressTheme)[] = ["spinner", "message", "success", "error"];

		for (const slot of requiredSlots) {
			expect(theme[slot]).toBeDefined();
			expect(typeof theme[slot]).toBe("function");
		}
	});

	it("returns a theme where every slot produces a string", () => {
		const theme = createTheme();

		for (const key of Object.keys(theme)) {
			const fn = theme[key as keyof ProgressTheme];
			const result = fn("test");
			expect(typeof result).toBe("string");
		}
	});
});
