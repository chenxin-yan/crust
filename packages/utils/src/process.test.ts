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
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { isErrnoException } from "./error.ts";
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
		return !isErrnoException(error) || (error.code !== "ESRCH" && error.code !== "ENOENT");
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

	const lifetimeEvents = ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT", "exit"] as const;
	const listenerCounts = () => lifetimeEvents.map((event) => process.listenerCount(event));

	it("removes its parent-lifetime listeners once a timed run settles", async () => {
		const before = listenerCounts();
		await runProcess(process.execPath, ["-e", ""], { timeout: 5_000 });
		await expect(
			runProcess(process.execPath, ["-e", "setTimeout(() => {}, 20000)"], { timeout: 500 }),
		).rejects.toThrow("was killed");
		expect(listenerCounts()).toEqual(before);
	}, 15_000);

	it("shares one parent-lifetime listener per event across concurrent timed runs", async () => {
		const before = listenerCounts();
		const runs = Array.from({ length: 12 }, () =>
			runProcess(process.execPath, ["-e", ""], { timeout: 5_000 }),
		);
		const shared = process.platform === "win32" ? 0 : 1;
		expect(listenerCounts()).toEqual(before.map((count) => count + shared));
		await Promise.all(runs);
		expect(listenerCounts()).toEqual(before);
	}, 15_000);

	describe.skipIf(process.platform === "win32")("parent lifetime", () => {
		/**
		 * Runs a Node host whose timed children (each with a pipe-holding descendant) are alive
		 * when the host interrupts itself as `mode` describes; `concurrent` runs two and sends SIGINT.
		 */
		function runInterruptedHost(mode: "SIGTERM" | "exit" | "listener" | "concurrent") {
			const dir = mkdtempSync(join(tmpdir(), "run-process-lifetime-"));
			const pidFiles = (mode === "concurrent" ? ["first", "second"] : ["only"]).map((name) =>
				join(dir, `${name}.json`),
			);
			const child = (pidFile: string) => `const { spawn } = require("node:child_process");
const fs = require("node:fs");
const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "inherit" });
fs.writeFileSync(${JSON.stringify(`${pidFile}.tmp`)}, JSON.stringify([process.pid, descendant.pid]));
fs.renameSync(${JSON.stringify(`${pidFile}.tmp`)}, ${JSON.stringify(pidFile)});
setInterval(() => {}, 1000);`;
			const host = join(dir, "host.mjs");
			writeFileSync(
				host,
				`import { existsSync } from "node:fs";
import { runProcess } from ${JSON.stringify(pathToFileURL(join(import.meta.dirname, "process.ts")).href)};
const mode = ${JSON.stringify(mode)};
if (mode === "listener") process.on("SIGINT", () => console.log("host listener"));
const runs = ${JSON.stringify(pidFiles.map(child))}.map((script) => runProcess(process.execPath, ["-e", script], { timeout: 60000 }));
const poll = setInterval(() => {
  if (!${JSON.stringify(pidFiles)}.every((pidFile) => existsSync(pidFile))) return;
  clearInterval(poll);
  if (mode === "exit") process.exit(3);
  process.kill(process.pid, mode === "SIGTERM" ? "SIGTERM" : "SIGINT");
}, 20);
for (const run of runs) {
  await run.catch((error) => console.log(error.message, ${JSON.stringify(lifetimeEvents)}.map((event) => process.listenerCount(event)).join()));
}
process.exit(0);
`,
			);
			const pids: number[] = [];
			try {
				const result = spawnSync(process.execPath, [host], { encoding: "utf8", timeout: 10_000 });
				for (const pidFile of pidFiles) {
					if (existsSync(pidFile))
						pids.push(...(JSON.parse(readFileSync(pidFile, "utf8")) as number[]));
				}
				return { result, pids };
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		}

		const leftovers: number[] = [];

		afterEach(() => {
			for (const pid of leftovers.splice(0)) {
				try {
					process.kill(pid, "SIGKILL");
				} catch {
					// Already exited.
				}
			}
		});

		async function expectInterruptedHost(mode: Parameters<typeof runInterruptedHost>[0]) {
			const { result, pids } = runInterruptedHost(mode);
			leftovers.push(...pids);
			expect(pids).toHaveLength(mode === "concurrent" ? 4 : 2);
			await vi.waitFor(() => expect(pids.filter(isRunning)).toEqual([]), { timeout: 5_000 });
			return result;
		}

		it("kills timed children and keeps default termination when the parent gets SIGTERM", async () => {
			expect(await expectInterruptedHost("SIGTERM")).toMatchObject({
				status: null,
				signal: "SIGTERM",
				stdout: "",
			});
		}, 20_000);

		it("kills timed children when the parent exits synchronously", async () => {
			expect(await expectInterruptedHost("exit")).toMatchObject({ status: 3, signal: null });
		}, 20_000);

		it("kills timed children and leaves an existing parent SIGINT listener in charge", async () => {
			expect(await expectInterruptedHost("listener")).toMatchObject({
				status: 0,
				signal: null,
				// The host listener still ran and remains the only lifetime listener.
				stdout: expect.stringMatching(
					/^host listener\n.* was interrupted by SIGINT\. 1,0,0,0,0\n$/s,
				),
			});
		}, 20_000);

		it("kills concurrent timed children and still terminates by SIGINT", async () => {
			expect(await expectInterruptedHost("concurrent")).toMatchObject({
				status: null,
				signal: "SIGINT",
				stdout: "",
			});
		}, 20_000);
	});

	// Bun keeps an inherited SIG_IGN (Node resets it at startup). The real executable, not a
	// version-manager shim that may reset signals before exec.
	const bunPath =
		process.platform === "linux"
			? spawnSync("bun", ["-e", "console.log(process.execPath)"], {
					encoding: "utf8",
				}).stdout?.trim()
			: undefined;

	it.skipIf(!bunPath)(
		"keeps an inherited SIGHUP ignore after a timed call on Bun",
		() => {
			const dir = mkdtempSync(join(tmpdir(), "run-process-ignored-"));
			const probe = join(dir, "probe.ts");
			writeFileSync(
				probe,
				`import { runProcess } from ${JSON.stringify(pathToFileURL(join(import.meta.dirname, "process.ts")).href)};
await runProcess(process.execPath, ["-e", ""], { timeout: 5000 });
process.kill(process.pid, "SIGHUP");
await new Promise((resolve) => setTimeout(resolve, 200));
console.log("alive");`,
			);
			try {
				const result = spawnSync("sh", ["-c", 'trap "" HUP; exec "$0" "$1"', bunPath!, probe], {
					encoding: "utf8",
					timeout: 10_000,
				});
				expect(result).toMatchObject({ status: 0, stdout: "alive\n" });
			} finally {
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
	describe("PATH scan", () => {
		let dir: string;

		beforeEach(() => {
			dir = mkdtempSync(join(tmpdir(), "which-test-"));
			vi.stubEnv("PATH", `${dir}${delimiter}${process.env.PATH ?? ""}`);
		});

		afterEach(() => {
			vi.unstubAllEnvs();
			rmSync(dir, { recursive: true, force: true });
		});

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
					vi.stubEnv("PATH", path);
					expect(which(command), `PATH=${JSON.stringify(path)} ${command}`).toBe(expected);
				}

				// A cwd containing the delimiter must not be re-split into `${dir}/x` + `y`.
				const colonCwd = join(dir, `x${delimiter}y`);
				mkdirSync(join(dir, "x"));
				mkdirSync(colonCwd);
				executable(join(dir, "x", "probe"));
				executable(join(colonCwd, "probe"));
				process.chdir(colonCwd);
				vi.stubEnv("PATH", "");
				expect(which("probe")).toBe(join(colonCwd, "probe"));
			} finally {
				process.chdir(originalCwd);
			}
		});
	});
});
