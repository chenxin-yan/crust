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
	});

	describe("coerceBooleanString", () => {
		it("coerces strict truthy strings", () => {
			expect(coerceBooleanString("true")).toBe(true);
			expect(coerceBooleanString("1")).toBe(true);
			expect(coerceBooleanString("false")).toBe(false);
		});
	});
});
