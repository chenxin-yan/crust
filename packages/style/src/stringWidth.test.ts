import { describe, expect, it } from "bun:test";

import { stringWidth } from "./stringWidth.ts";

describe("stringWidth", () => {
	it("measures ANSI, combining marks, CJK, and emoji", () => {
		expect(stringWidth("\u001b[31mred\u001b[0m")).toBe(3);
		expect(stringWidth("e\u0301")).toBe(1);
		expect(stringWidth("你好")).toBe(4);
		expect(stringWidth("👨‍👩‍👧‍👦")).toBe(2);
	});

	it("matches Bun for representative terminal strings", () => {
		for (const value of ["plain", "\u001b[1mbold\u001b[22m", "界", "🙂", "e\u0301"]) {
			expect(stringWidth(value)).toBe(Bun.stringWidth(value));
		}
	});
});
