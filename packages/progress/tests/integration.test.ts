import { afterEach, describe, expect, it } from "bun:test";
import type { ProgressTheme } from "../src/index.ts";
import {
	createTheme,
	defaultTheme,
	getTheme,
	setTheme,
	spinner,
} from "../src/index.ts";

describe("barrel exports", () => {
	it("exports spinner", () => {
		expect(typeof spinner).toBe("function");
	});

	it("exports theme helpers", () => {
		expect(typeof createTheme).toBe("function");
		expect(typeof setTheme).toBe("function");
		expect(typeof getTheme).toBe("function");
		expect(defaultTheme).toBeDefined();
		expect(typeof defaultTheme.spinner).toBe("function");
	});
});

describe("createTheme integration", () => {
	it("returns a valid theme with all slots defined", () => {
		const theme = createTheme();
		const requiredSlots: (keyof ProgressTheme)[] = [
			"spinner",
			"message",
			"success",
			"error",
		];

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

	afterEach(() => {
		setTheme();
	});

	it("setTheme applies global overrides via getTheme", () => {
		const globalFn = (text: string) => `(${text})`;
		setTheme({ spinner: globalFn });
		const theme = getTheme();

		expect(theme.spinner("x")).toBe("(x)");
		expect(theme.message).toBe(defaultTheme.message);
		expect(theme.success).toBe(defaultTheme.success);
	});
});
