import { describe, expect, it } from "vite-plus/test";

import { tryCoerceBoolean, tryCoerceNumber } from "./primitive.ts";

describe("primitive helpers", () => {
	describe("tryCoerceNumber", () => {
		it("returns undefined for non-numeric strings", () => {
			expect(tryCoerceNumber("abc")).toBeUndefined();
		});

		it("returns undefined for blank strings instead of 0", () => {
			expect(tryCoerceNumber("")).toBeUndefined();
			expect(tryCoerceNumber(" \t\n")).toBeUndefined();
			expect(tryCoerceNumber(" 42 ")).toBe(42);
		});
	});

	describe("tryCoerceBoolean", () => {
		it("reads the boolean words in any letter case", () => {
			for (const word of ["true", "1", "yes", "on", "TRUE", "Yes", "ON"]) {
				expect(tryCoerceBoolean(word)).toBe(true);
			}
			for (const word of ["false", "0", "no", "off", "FALSE", "No", "Off"]) {
				expect(tryCoerceBoolean(word)).toBe(false);
			}
		});

		it("returns undefined for any other text", () => {
			for (const text of ["", " true", "2", "y", "maybe", "constructor", "__proto__"]) {
				expect(tryCoerceBoolean(text)).toBeUndefined();
			}
		});
	});
});
