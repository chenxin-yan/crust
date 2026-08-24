import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { getWindowsShimCommand, runProcess, which } from "./process.ts";

describe("getWindowsShimCommand", () => {
	it("only selects command shims on Windows when shell mode was not requested", () => {
		expect(getWindowsShimCommand("C:/tools/bun.CMD", ["install"], false, "win32")).toBe("bun");
		expect(getWindowsShimCommand("tools\\gen.bat", [], true, "win32")).toBeNull();
		expect(getWindowsShimCommand("tools/gen.bat", [], false, "linux")).toBeNull();
		expect(getWindowsShimCommand("tools/gen.exe", [], false, "win32")).toBeNull();
	});

	it("rejects shell metacharacters before selecting a command shim", () => {
		expect(() =>
			getWindowsShimCommand(
				"C:/tools/bun.cmd",
				["build", "--outfile", "C:/project & echo owned/out.js"],
				false,
				"win32",
			),
		).toThrow('Windows command shim argument 3 "C:/project & echo owned/out.js"');
		for (const value of ["unsafe value", "left&right", "left^right", "100%"] as const) {
			expect(() => getWindowsShimCommand("C:/tools/bun.cmd", [value], false, "win32")).toThrow(
				`Windows command shim argument 1 ${JSON.stringify(value)}`,
			);
		}
		expect(() => getWindowsShimCommand("C:/bad tools/bun.cmd", [], false, "win32")).not.toThrow();
		expect(() => getWindowsShimCommand("C:/tools/bad name.cmd", [], false, "win32")).toThrow(
			'Windows command shim command "bad name"',
		);
	});
});

describe("runProcess", () => {
	it("collects output and forwards cwd and env", async () => {
		const cwd = tmpdir();
		const result = await runProcess(
			process.execPath,
			[
				"-e",
				'process.stdout.write(process.cwd()); process.stderr.write(process.env.CRUST_PROCESS_TEST ?? ""); process.exit(7)',
			],
			{
				cwd,
				env: { ...process.env, CRUST_PROCESS_TEST: "forwarded" },
				stdio: "collect",
			},
		);

		expect(result).toEqual({ exitCode: 7, stdout: cwd, stderr: "forwarded" });
	});

	it("can ignore stdout while collecting stderr", async () => {
		const result = await runProcess(
			process.execPath,
			["-e", 'process.stdout.write("ignored"); process.stderr.write("collected")'],
			{ stdio: "collect", stdout: "ignore" },
		);

		expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "collected" });
	});

	it.skipIf(process.platform !== "win32")(
		"runs Windows command shims through the shell",
		async () => {
			const dir = mkdtempSync(join(tmpdir(), "run-process-test-"));
			const shim = join(dir, "crust-process-probe.cmd");
			writeFileSync(shim, "@echo off\r\necho shim-output\r\n");

			try {
				const result = await runProcess(shim, [], {
					env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` },
					stdio: "collect",
				});
				expect(result.exitCode).toBe(0);
				expect(result.stdout.trim()).toBe("shim-output");
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		},
	);
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
