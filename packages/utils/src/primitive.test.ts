import { describe, expect, it } from "bun:test";
import {
	coerceBooleanString,
	tryCoerceNumber,
	type ResolvePrimitive,
} from "./primitive.ts";

type Expect<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() =>
	T extends B ? 1 : 2
	? true
	: false;

type _checkDistributive = Expect<
	Equal<ResolvePrimitive<"number" | "boolean">, number | boolean>
>;

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
	});

	describe("coerceBooleanString", () => {
		it("coerces true to true", () => {
			expect(coerceBooleanString("true")).toBe(true);
		});

		it("coerces 1 to true", () => {
			expect(coerceBooleanString("1")).toBe(true);
		});

		it("coerces false to false", () => {
			expect(coerceBooleanString("false")).toBe(false);
		});
	});
});
