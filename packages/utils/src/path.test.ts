import { describe, expect, it } from "bun:test";
import { join } from "node:path";

import { isWithin } from "./path.ts";

describe("isWithin", () => {
	it("distinguishes descendants from sibling paths with the same prefix", () => {
		const parent = join("tmp", "skills");
		expect(isWithin(parent, join(parent, "authored"))).toBe(true);
		expect(isWithin(parent, join("tmp", "skills-backup"))).toBe(false);
	});
});
