import { describe, expect, it } from "bun:test";

import { interpolate } from "./scaffold.ts";

describe("interpolate", () => {
	it("replaces multiple different variables", () => {
		const result = interpolate("{{greeting}}, {{name}}!", {
			greeting: "Hi",
			name: "Crust",
		});
		expect(result).toBe("Hi, Crust!");
	});

	it("replaces repeated occurrences of the same variable", () => {
		expect(interpolate("{{a}} and {{a}}", { a: "x" })).toBe("x and x");
	});

	it("leaves missing variables untouched", () => {
		expect(interpolate("{{known}} and {{unknown}}", { known: "yes" })).toBe("yes and {{unknown}}");
	});

	it("returns original content when there are no placeholders", () => {
		expect(interpolate("Hello, world!", { name: "unused" })).toBe("Hello, world!");
	});

	it("handles whitespace inside braces", () => {
		expect(interpolate("{{ name }} and {{  spaced  }}", { name: "a", spaced: "b" })).toBe(
			"a and b",
		);
	});

	it("does not replace partial or malformed placeholders", () => {
		expect(interpolate("{name} and {{}} and {{}}", { name: "x" })).toBe("{name} and {{}} and {{}}");
	});

	it("replaces with empty string values", () => {
		expect(interpolate("before{{name}}after", { name: "" })).toBe("beforeafter");
	});

	it("handles underscores in variable names", () => {
		expect(interpolate("{{my_var}}", { my_var: "value" })).toBe("value");
	});
});
