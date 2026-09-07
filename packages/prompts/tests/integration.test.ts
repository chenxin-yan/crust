import { describe, expect, it } from "bun:test";
// ────────────────────────────────────────────────────────────────────────────
// Integration tests — exercise @crustjs/prompts through its public barrel
// ────────────────────────────────────────────────────────────────────────────

import { fuzzyFilter } from "../src/index.ts";

describe("fuzzy matching integration", () => {
	it("fuzzyFilter returns sorted results", () => {
		// `config` scores higher than `abc` because the match lands at the
		// start of the string (START_BONUS). `xyz` does not match at all.
		const items = [
			{ label: "abc", value: "abc" },
			{ label: "config", value: "config" },
			{ label: "xyz", value: "xyz" },
		];
		const results = fuzzyFilter("c", items);

		expect(results.length).toBe(2);
		expect(results[0]?.item.label).toBe("config");
		expect(results[1]?.item.label).toBe("abc");
	});
});
