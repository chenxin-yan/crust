import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { which } from "./process.ts";

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
