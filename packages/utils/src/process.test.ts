import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { compareSemver, which } from "./process.ts";

describe("compareSemver", () => {
	it("orders core and prerelease versions", () => {
		expect(compareSemver("1.2.3", "1.2.4")).toBe(-1);
		expect(compareSemver("2.0.0", "1.9.9")).toBe(1);
		expect(compareSemver("1.0.0-alpha.2", "1.0.0-alpha.10")).toBe(-1);
		expect(compareSemver("1.0.0-alpha", "1.0.0")).toBe(-1);
		expect(compareSemver("v1.0.0+build.1", "1.0.0+build.2")).toBe(0);
	});

	it("orders prerelease identifiers per SemVer §11", () => {
		// Numeric identifiers always sort below alphanumeric ones.
		expect(compareSemver("1.0.0-1", "1.0.0-alpha")).toBe(-1);
		// Fewer prerelease fields sort lower.
		expect(compareSemver("1.0.0-alpha", "1.0.0-alpha.1")).toBe(-1);
		expect(compareSemver("1.0.0-alpha.beta", "1.0.0-beta")).toBe(-1);
	});

	it("throws TypeError on invalid input", () => {
		expect(() => compareSemver("not-a-version", "1.0.0")).toThrow(TypeError);
		expect(() => compareSemver("1.0", "1.0.0")).toThrow(TypeError);
	});
});

describe("which", () => {
	it("finds executables on PATH and returns null otherwise", () => {
		expect(which("bun")).toBeTruthy();
		expect(which("definitely-not-a-crust-command")).toBeNull();
	});

	describe("PATH scan", () => {
		let dir: string;
		let originalPath: string | undefined;

		beforeEach(() => {
			dir = mkdtempSync(join(tmpdir(), "which-test-"));
			originalPath = process.env.PATH;
			process.env.PATH = `${dir}${delimiter}${originalPath ?? ""}`;
		});

		afterEach(() => {
			process.env.PATH = originalPath;
			rmSync(dir, { recursive: true, force: true });
		});

		it.skipIf(process.platform === "win32")("skips non-executable files while searching", () => {
			writeFileSync(join(dir, "crust-which-probe"), "#!/bin/sh\n");
			expect(which("crust-which-probe")).toBeNull();
			chmodSync(join(dir, "crust-which-probe"), 0o755);
			expect(which("crust-which-probe")).toBe(join(dir, "crust-which-probe"));
		});

		it.skipIf(process.platform === "win32")("resolves path-containing inputs directly", () => {
			const probe = join(dir, "crust-path-probe");
			expect(which(probe)).toBeNull();
			writeFileSync(probe, "#!/bin/sh\n");
			chmodSync(probe, 0o755);
			expect(which(probe)).toBe(probe);
		});
	});
});
