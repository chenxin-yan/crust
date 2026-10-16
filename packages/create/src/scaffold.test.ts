import { describe, expect, it } from "vite-plus/test";

import { interpolate } from "./scaffold.ts";

describe("interpolate", () => {
	it("replaces multiple different variables", () => {
		const result = interpolate("{{greeting}}, {{name}}!", {
			greeting: "Hi",
			name: "Crust",
		});
		expect(result).toBe("Hi, Crust!");
	});

	it("leaves missing variables untouched", () => {
		expect(interpolate("{{known}} and {{unknown}}", { known: "yes" })).toBe("yes and {{unknown}}");
	});

	it("leaves placeholders named after inherited Object properties untouched", () => {
		const content = "{{toString}} {{constructor}} {{__proto__}} {{hasOwnProperty}}";
		expect(interpolate(content, {})).toBe(content);
	});

	it("handles whitespace inside braces", () => {
		expect(interpolate("{{ name }} and {{  spaced  }}", { name: "a", spaced: "b" })).toBe(
			"a and b",
		);
	});

	it("replaces with empty string values", () => {
		expect(interpolate("before{{name}}after", { name: "" })).toBe("beforeafter");
	});
});
