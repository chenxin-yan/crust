import { describe, expect, it } from "bun:test";
import { interpolate } from "./interpolate.ts";

// ────────────────────────────────────────────────────────────────────────────
// interpolate()
// ────────────────────────────────────────────────────────────────────────────

describe("interpolate", () => {
	it("replaces a single variable", () => {
		const result = interpolate("Hello, {{name}}!", { name: "world" });
		expect(result).toBe("Hello, world!");
	});

	it("replaces multiple different variables", () => {
		const result = interpolate("{{greeting}}, {{name}}!", {
			greeting: "Hi",
			name: "Crust",
		});
		expect(result).toBe("Hi, Crust!");
	});

	it("replaces repeated occurrences of the same variable", () => {
		const result = interpolate("{{a}} and {{a}}", { a: "x" });
		expect(result).toBe("x and x");
	});

	it("leaves missing variables untouched", () => {
		const result = interpolate("{{known}} and {{unknown}}", {
			known: "yes",
		});
		expect(result).toBe("yes and {{unknown}}");
	});

	it("returns original content when context is empty", () => {
		const result = interpolate("Hello, {{name}}!", {});
		expect(result).toBe("Hello, {{name}}!");
	});

	it("returns original content when there are no placeholders", () => {
		const result = interpolate("Hello, world!", { name: "unused" });
		expect(result).toBe("Hello, world!");
	});

	it("handles whitespace inside braces", () => {
		const result = interpolate("{{ name }} and {{  spaced  }}", {
			name: "a",
			spaced: "b",
		});
		expect(result).toBe("a and b");
	});

	it("does not replace partial or malformed placeholders", () => {
		const result = interpolate("{name} and {{}} and {{}}", { name: "x" });
		expect(result).toBe("{name} and {{}} and {{}}");
	});

	it("handles empty string content", () => {
		const result = interpolate("", { name: "x" });
		expect(result).toBe("");
	});

	it("replaces with empty string values", () => {
		const result = interpolate("before{{name}}after", { name: "" });
		expect(result).toBe("beforeafter");
	});

	it("handles underscores in variable names", () => {
		const result = interpolate("{{my_var}}", { my_var: "value" });
		expect(result).toBe("value");
	});
});
