import { describe, expect, it } from "vite-plus/test";

import { coerceBooleanString, tryCoerceNumber } from "./primitive.ts";

describe("primitive helpers", () => {
	describe("tryCoerceNumber", () => {
		it("coerces numeric strings", () => {
			expect(tryCoerceNumber("42")).toBe(42);
		});

		it("returns undefined for non-numeric strings", () => {
			expect(tryCoerceNumber("abc")).toBeUndefined();
		});

		it("coerces an empty string to 0", () => {
			// Number("") is 0, not NaN, so existing coercion accepts it.
			expect(tryCoerceNumber("")).toBe(0);
		});

		it("accepts Infinity", () => {
			expect(tryCoerceNumber("Infinity")).toBe(Infinity);
		});
	});

	describe("coerceBooleanString", () => {
		it("coerces strict truthy strings", () => {
			expect(coerceBooleanString("true")).toBe(true);
			expect(coerceBooleanString("1")).toBe(true);
			expect(coerceBooleanString("false")).toBe(false);
		});
	});
});
