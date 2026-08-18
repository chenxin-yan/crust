import { describe, expect, it } from "bun:test";

import { compareSemver, which } from "./process.ts";

describe("compareSemver", () => {
	it("orders core and prerelease versions", () => {
		expect(compareSemver("1.2.3", "1.2.4")).toBe(-1);
		expect(compareSemver("2.0.0", "1.9.9")).toBe(1);
		expect(compareSemver("1.0.0-alpha.2", "1.0.0-alpha.10")).toBe(-1);
		expect(compareSemver("1.0.0-alpha", "1.0.0")).toBe(-1);
		expect(compareSemver("v1.0.0+build.1", "1.0.0+build.2")).toBe(0);
	});
});

describe("which", () => {
	it("finds executables on PATH and returns null otherwise", () => {
		expect(which("bun")).toBeTruthy();
		expect(which("definitely-not-a-crust-command")).toBeNull();
	});
});
