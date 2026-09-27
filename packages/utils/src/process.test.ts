import { spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, relative } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
	getWindowsShimCommand,
	packageManagerFromUserAgent,
	runProcess,
	which,
} from "./process.ts";

describe("packageManagerFromUserAgent", () => {
	it("recognizes supported package manager user agents", () => {
		expect(packageManagerFromUserAgent("bun/1.3.0")).toBe("bun");
		expect(packageManagerFromUserAgent("pnpm/10.0.0 node/v22")).toBe("pnpm");
		expect(packageManagerFromUserAgent("yarn/4.0.0 npm/?")).toBe("yarn");
		expect(packageManagerFromUserAgent("npm/10.0.0 node/v22")).toBe("npm");
		expect(packageManagerFromUserAgent("unknown/1.0.0")).toBeNull();
		expect(packageManagerFromUserAgent(undefined)).toBeNull();
	});
});

describe("getWindowsShimCommand", () => {
	it("only selects command shims on Windows when shell mode was not requested", () => {
		expect(getWindowsShimCommand("C:/tools/bun.CMD", ["install"], false, "win32")).not.toBeNull();
		expect(getWindowsShimCommand("tools\\gen.bat", [], true, "win32")).toBeNull();
		expect(getWindowsShimCommand("tools/gen.bat", [], false, "linux")).toBeNull();
		expect(getWindowsShimCommand("tools/gen.exe", [], false, "win32")).toBeNull();
	});

	it("preserves the resolved shim path and escapes ordinary Windows paths", () => {
		const invocation = getWindowsShimCommand(
			"C:/tools/bun.cmd",
			["build", "--env=PUBLIC_*", "C:\\work\\my app\\dist\\crust.exe"],
			false,
			"win32",
		);

		expect(invocation).toEqual({
			command: process.env.ComSpec ?? "cmd.exe",
			args: [
				"/d",
				"/s",
				"/c",
				'"C:\\tools\\bun.cmd ^^^"build^^^" ^^^"--env=PUBLIC_^^^*^^^" ^^^"C:\\work\\my^^^ app\\dist\\crust.exe^^^""',
			],
			windowsVerbatimArguments: true,
		});
	});

	it("caret-escapes spaces in the resolved shim path", () => {
		const invocation = getWindowsShimCommand("C:\\bad tools\\bun.cmd", [], false, "win32");
		expect(invocation?.args[3]).toBe('"C:\\bad^ tools\\bun.cmd"');
	});

	it("rejects unsafe shell characters before selecting a command shim", () => {
		expect(() =>
			getWindowsShimCommand(
				"C:/tools/bun.cmd",
				["build", "--outfile", "C:/project & echo owned/out.js"],
				false,
				"win32",
			),
		).toThrow('Windows command shim argument 3 "C:/project & echo owned/out.js"');
		for (const value of ["left&right", "left^right", "100%"] as const) {
			expect(() => getWindowsShimCommand("C:/tools/bun.cmd", [value], false, "win32")).toThrow(
				`Windows command shim argument 1 ${JSON.stringify(value)}`,
			);
		}
		expect(() => getWindowsShimCommand("C:/bad tools/bun.cmd", [], false, "win32")).not.toThrow();
	});
});

function isRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		if (process.platform === "linux") {
			// Container init may retain a terminated descendant as a zombie.
			const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
			return stat[stat.lastIndexOf(")") + 2] !== "Z";
		}
		return true;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		return code !== "ESRCH" && code !== "ENOENT";
	}
}

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

	for (const exitParent of [false, true]) {
		it.skipIf(exitParent && process.platform === "win32")(
			`kills timed-out descendants when their parent ${exitParent ? "has exited" : "is alive"}`,
			async () => {
				const dir = mkdtempSync(join(tmpdir(), "run-process-timeout-"));
				const pidsFile = join(dir, "pids.json");
				const script = `const { spawn } = require("node:child_process");
const descendant = spawn(process.execPath, ["-e", "setTimeout(() => {}, 20000)"], { stdio: "inherit" });
require("node:fs").writeFileSync(${JSON.stringify(pidsFile)}, JSON.stringify([process.pid, descendant.pid]));
${exitParent ? "process.exit(0);" : "setTimeout(() => {}, 20000);"}`;
				try {
					await expect(
						runProcess(process.execPath, ["-e", script], { timeout: 2_000 }),
					).rejects.toThrow(/ did not exit within 2000 ms and was killed\.$/);
					const pids = JSON.parse(readFileSync(pidsFile, "utf8")) as number[];
					expect(pids).toHaveLength(2);
					await vi.waitFor(() => expect(pids.filter(isRunning)).toEqual([]));
				} finally {
					try {
						const pids = JSON.parse(readFileSync(pidsFile, "utf8")) as number[];
						for (const pid of pids) {
							if (isRunning(pid)) {
								try {
									process.kill(pid, "SIGKILL");
								} catch {
									// Exited between the check and cleanup.
								}
							}
						}
					} finally {
						rmSync(dir, { recursive: true, force: true });
					}
				}
			},
			15_000,
		);
	}

	it.skipIf(process.platform === "win32" || !which("deno"))(
		"kills the direct child under Deno with executable-scoped run permission",
		async () => {
			const dir = mkdtempSync(join(tmpdir(), "run-process-deno-"));
			const pidFile = join(dir, "pid");
			const probe = join(dir, "probe.ts");
			const script = `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
setTimeout(() => {}, 20000);`;
			writeFileSync(
				probe,
				`import assert from "node:assert/strict";
import { runProcess } from ${JSON.stringify(new URL("./process.ts", import.meta.url).href)};
await assert.rejects(
  runProcess(${JSON.stringify(process.execPath)}, ["-e", ${JSON.stringify(script)}], { timeout: 2000 }),
  { message: "Process-tree cleanup failed after timeout." },
);`,
			);
			try {
				const result = spawnSync(
					"deno",
					[
						"run",
						"--no-config",
						"--no-prompt",
						`--allow-run=${process.execPath}`,
						"--allow-env",
						"--allow-read",
						probe,
					],
					{ encoding: "utf8", timeout: 8_000 },
				);
				expect(result.error).toBeUndefined();
				expect(result.status, result.stderr).toBe(0);
				const pid = Number(readFileSync(pidFile, "utf8"));
				await vi.waitFor(() => expect(isRunning(pid)).toBe(false));
			} finally {
				if (existsSync(pidFile)) {
					const pid = Number(readFileSync(pidFile, "utf8"));
					if (isRunning(pid)) process.kill(pid, "SIGKILL");
				}
				rmSync(dir, { recursive: true, force: true });
			}
		},
		15_000,
	);

	it.skipIf(process.platform !== "win32")(
		"round-trips arguments through Windows forwarding shims",
		async () => {
			const dir = mkdtempSync(join(tmpdir(), "run-process-test-"));
			const shim = join(dir, "crust-process-probe.cmd");
			const probe = join(dir, "argv.cjs");
			const args = ["plain", "two words", "(parentheses)", "C:\\path with spaces\\", ""];
			writeFileSync(probe, "process.stdout.write(JSON.stringify(process.argv.slice(2)));");
			writeFileSync(shim, `@echo off\r\n"${process.execPath}" "${probe}" %*\r\n`);

			try {
				const result = await runProcess(shim, args, { timeout: 5_000 });
				expect(result.exitCode).toBe(0);
				expect(JSON.parse(result.stdout)).toEqual(args);
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

		it.skipIf(process.platform === "win32")(
			"returns absolute paths for relative PATH entries",
			() => {
				writeFileSync(join(dir, "crust-relative-probe"), "#!/bin/sh\n");
				chmodSync(join(dir, "crust-relative-probe"), 0o755);
				process.env.PATH = relative(process.cwd(), dir);
				expect(which("crust-relative-probe")).toBe(join(dir, "crust-relative-probe"));
			},
		);

		it.skipIf(process.platform === "win32")("resolves path-containing inputs directly", () => {
			const probe = join(dir, "crust-path-probe");
			expect(which(probe)).toBeNull();
			writeFileSync(probe, "#!/bin/sh\n");
			chmodSync(probe, 0o755);
			expect(which(probe)).toBe(probe);
		});

		it.skipIf(process.platform === "win32")("selects the same executable as the PATH scan", () => {
			const executable = (path: string) => {
				writeFileSync(path, "#!/bin/sh\n");
				chmodSync(path, 0o755);
			};
			const [a, b] = [join(dir, "a"), join(dir, "b")];
			mkdirSync(a);
			mkdirSync(b);
			executable(join(a, "probe"));
			executable(join(b, "probe"));
			executable(join(dir, "probe"));
			writeFileSync(join(a, "nonexec"), "#!/bin/sh\n");
			executable(join(b, "nonexec"));
			mkdirSync(join(a, "dircmd"));
			executable(join(b, "dircmd"));
			symlinkSync(join(a, "probe"), join(a, "linkcmd"));
			symlinkSync(join(a, "missing"), join(a, "dangling"));
			executable(join(b, "dangling"));

			const originalCwd = process.cwd();
			process.chdir(dir);
			try {
				const cases: [path: string | undefined, command: string, expected: string | null][] = [
					[`${a}${delimiter}${b}`, "probe", join(a, "probe")],
					[`${b}${delimiter}${a}`, "probe", join(b, "probe")],
					[`${a}${delimiter}${b}`, "nonexec", join(b, "nonexec")],
					[`${a}${delimiter}${b}`, "dircmd", join(b, "dircmd")],
					[`${a}${delimiter}${b}`, "dangling", join(b, "dangling")],
					[a, "linkcmd", join(a, "linkcmd")],
					[a, "missing", null],
					["a", "probe", join(a, "probe")],
					["b/../a", "probe", join(a, "probe")],
					[`${delimiter}${a}`, "probe", join(dir, "probe")],
					["", "probe", join(dir, "probe")],
					[delimiter, "probe", join(dir, "probe")],
					[undefined, "probe", null],
				];
				for (const [path, command, expected] of cases) {
					if (path === undefined) delete process.env.PATH;
					else process.env.PATH = path;
					expect(which(command), `PATH=${JSON.stringify(path)} ${command}`).toBe(expected);
				}

				// A cwd containing the delimiter must not be re-split into `${dir}/x` + `y`.
				const colonCwd = join(dir, `x${delimiter}y`);
				mkdirSync(join(dir, "x"));
				mkdirSync(colonCwd);
				executable(join(dir, "x", "probe"));
				executable(join(colonCwd, "probe"));
				process.chdir(colonCwd);
				process.env.PATH = "";
				expect(which("probe")).toBe(join(colonCwd, "probe"));
			} finally {
				process.chdir(originalCwd);
			}
		});
	});
});
