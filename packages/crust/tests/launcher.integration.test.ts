// On POSIX the generated npm launcher replaces itself with the platform binary
// (execve), so every signal and the exit status belong to the binary alone: no
// signal is dropped or delivered twice, with or without a controlling terminal.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import type { DistributionTarget } from "../src/distribute.ts";
import { binaryFilename, generateLauncher } from "../src/launcher.ts";
import { BUN_TARGETS, type TargetInfo } from "../src/targets.ts";
import { isRunning } from "./bounded-process.ts";
import { hostTarget } from "./helpers.ts";

const TIMEOUT = 10_000;

// Fake platform binary: logs synchronously so the log is complete once it exits.
// "trap" handles SIGINT/SIGTERM with a slow cleanup and exits 3; "plain" keeps the default actions.
const CHILD_SOURCE = `
const { appendFileSync } = require("node:fs");
const log = (line) => appendFileSync(process.env.LAUNCHER_TEST_LOG, line + "\\n");
if (process.argv[2] === "trap") {
	for (const signal of ["SIGINT", "SIGTERM"]) {
		process.on(signal, () => {
			log("got " + signal);
			setTimeout(() => {
				log("cleanup done");
				process.exit(3);
			}, 300);
		});
	}
}
setTimeout(() => process.exit(0), ${TIMEOUT});
log("ready " + process.pid);
`;

// Runs the launcher as a session leader on a fresh pty, so it has a controlling
// terminal, and writes stdin to the pty master: "\x03" is a real terminal Ctrl-C.
// Exits the way the launcher did.
const PTY_HOST = `
import os, pty, signal, sys
pid, master = pty.fork()
if pid == 0:
    os.execv(sys.argv[1], sys.argv[1:])
os.write(master, sys.stdin.buffer.read(1))
status = os.waitpid(pid, 0)[1]
if os.WIFSIGNALED(status):
    signal.signal(os.WTERMSIG(status), signal.SIG_DFL)
    os.kill(os.getpid(), os.WTERMSIG(status))
sys.exit(os.WEXITSTATUS(status))
`;
const hasPty =
	process.platform !== "win32" &&
	spawnSync("python3", ["-c", "import pty"], { timeout: TIMEOUT }).status === 0;

let tmpDir: string | undefined;

afterEach(() => {
	if (!tmpDir) return;
	const logPath = join(tmpDir, "child.log");
	const pid = existsSync(logPath) ? /^ready (\d+)$/m.exec(readFileSync(logPath, "utf8"))?.[1] : "";
	if (pid && isRunning(Number(pid))) process.kill(Number(pid), "SIGKILL");
	rmSync(tmpDir, { recursive: true, force: true });
	tmpDir = undefined;
});

/** Stages `root/bin/app.js` beside the host platform package, as `crust build` lays out `.crust/`. */
function stageLauncher(
	dir: string,
	binarySource = `#!${process.execPath}\n${CHILD_SOURCE}`,
): string {
	const bunTarget = hostTarget();
	if (!bunTarget) throw new Error("No Bun target matches this machine.");
	const info: TargetInfo = BUN_TARGETS.info[bunTarget];
	const target: DistributionTarget = {
		target: bunTarget,
		platformKey: info.platformKey,
		targetAlias: info.alias,
		packageName: `app-${info.alias}`,
		packagePathSegment: `app-${info.alias}`,
		packageDir: join(dir, info.alias),
		os: info.os,
		cpu: info.cpu,
		...(info.libc ? { libc: info.libc } : {}),
	};
	mkdirSync(join(dir, "root", "bin"), { recursive: true });
	mkdirSync(join(dir, info.alias, "bin"), { recursive: true });
	const launcherPath = join(dir, "root", "bin", "app.js");
	writeFileSync(launcherPath, generateLauncher("app", [target]));
	const binaryPath = join(dir, info.alias, "bin", binaryFilename("app", target));
	writeFileSync(binaryPath, binarySource);
	chmodSync(binaryPath, 0o755);
	return launcherPath;
}

function readLog(logPath: string): string[] {
	return existsSync(logPath) ? readFileSync(logPath, "utf8").trim().split("\n") : [];
}

/**
 * Runs the launcher in its own session (no controlling terminal), or under PTY_HOST
 * with `terminal`, signals it once the child is ready, and returns how it exited.
 */
async function runSignaled(
	mode: "trap" | "plain",
	deliver: (launcher: ChildProcess) => void,
	terminal = false,
) {
	tmpDir = mkdtempSync(join(tmpdir(), "crust-launcher-test-"));
	const logPath = join(tmpDir, "child.log");
	const launcherArgs = [stageLauncher(tmpDir), mode];
	const [command, args] = terminal
		? ["python3", ["-c", PTY_HOST, process.execPath, ...launcherArgs]]
		: [process.execPath, launcherArgs];
	const launcher = spawn(command, args, {
		// Its own session and process group: no controlling terminal, and a negative PID reaches the whole tree.
		detached: true,
		env: { ...process.env, LAUNCHER_TEST_LOG: logPath },
		stdio: [terminal ? "pipe" : "ignore", "ignore", "ignore"],
	});
	const exited = once(launcher, "exit") as Promise<[number | null, NodeJS.Signals | null]>;
	const timer = setTimeout(() => {
		try {
			process.kill(-launcher.pid!, "SIGKILL");
		} catch {}
	}, TIMEOUT);
	try {
		const deadline = Date.now() + TIMEOUT;
		while (!readLog(logPath)[0]?.startsWith("ready ")) {
			if (Date.now() > deadline) throw new Error("The platform binary never started.");
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		deliver(launcher);
		const [exitCode, signal] = await exited;
		// The child wrote its log before exiting, so this is everything it did before the launcher exited.
		return { exitCode, signal, log: readLog(logPath).slice(1) };
	} finally {
		clearTimeout(timer);
	}
}

describe.skipIf(process.platform === "win32")("generated npm launcher signals", () => {
	it(
		"forwards SIGTERM sent to the launcher PID and exits with the child's code",
		async () => {
			const result = await runSignaled("trap", ({ pid }) => process.kill(pid!, "SIGTERM"));
			expect(result).toEqual({ exitCode: 3, signal: null, log: ["got SIGTERM", "cleanup done"] });
		},
		TIMEOUT * 2,
	);

	it(
		"forwards SIGINT sent to the launcher PID when no terminal is attached",
		async () => {
			const result = await runSignaled("trap", ({ pid }) => process.kill(pid!, "SIGINT"));
			expect(result).toEqual({ exitCode: 3, signal: null, log: ["got SIGINT", "cleanup done"] });
		},
		TIMEOUT * 2,
	);

	it.skipIf(!hasPty)(
		"leaves terminal Ctrl-C to the child and waits for its cleanup",
		async () => {
			const result = await runSignaled("trap", ({ stdin }) => stdin!.write("\x03"), true);
			// Exactly one SIGINT: a forwarded duplicate would force-quit a Crust CLI.
			expect(result).toEqual({ exitCode: 3, signal: null, log: ["got SIGINT", "cleanup done"] });
		},
		TIMEOUT * 2,
	);

	it(
		"replaces itself with the platform binary",
		async () => {
			let samePid = false;
			const result = await runSignaled("plain", (launcher) => {
				samePid = readLog(join(tmpDir!, "child.log"))[0] === `ready ${launcher.pid}`;
				process.kill(launcher.pid!, "SIGTERM");
			});
			expect(samePid).toBe(true);
			expect(result.signal).toBe("SIGTERM");
		},
		TIMEOUT * 2,
	);

	it(
		"delivers a SIGINT sent to the whole process group once when no terminal is attached",
		async () => {
			const result = await runSignaled("trap", ({ pid }) => process.kill(-pid!, "SIGINT"));
			expect(result).toEqual({ exitCode: 3, signal: null, log: ["got SIGINT", "cleanup done"] });
		},
		TIMEOUT * 2,
	);

	it.skipIf(!hasPty || spawnSync("pgrep", ["-V"]).error !== undefined)(
		"delivers a SIGINT sent to the launcher PID inside a terminal",
		async () => {
			const result = await runSignaled(
				"trap",
				({ pid: host, stdin }) => {
					// The process PTY_HOST started: the launcher, which execve made the binary.
					const launcher = spawnSync("pgrep", ["-P", String(host)], { encoding: "utf8" });
					process.kill(Number(launcher.stdout.trim()), "SIGINT");
					// PTY_HOST waits for one stdin byte before it reaps the launcher.
					stdin!.end();
				},
				true,
			);
			expect(result).toEqual({ exitCode: 3, signal: null, log: ["got SIGINT", "cleanup done"] });
		},
		TIMEOUT * 2,
	);

	it.skipIf(!hasPty)("hands the binary blocking stdio", () => {
		tmpDir = mkdtempSync(join(tmpdir(), "crust-launcher-test-"));
		const logPath = join(tmpDir, "child.log");
		// Importing node:process in the launcher would leave these O_NONBLOCK after execve.
		const launcher = stageLauncher(
			tmpDir,
			`#!/usr/bin/env python3
import fcntl, os
flags = [fcntl.fcntl(fd, fcntl.F_GETFL) & os.O_NONBLOCK for fd in (0, 1, 2)]
open(os.environ["LAUNCHER_TEST_LOG"], "a").write("nonblocking " + ",".join("1" if f else "0" for f in flags) + "\\n")
`,
		);
		const result = spawnSync(process.execPath, [launcher], {
			env: { ...process.env, LAUNCHER_TEST_LOG: logPath },
			stdio: "pipe",
			timeout: TIMEOUT,
		});
		expect(result.status).toBe(0);
		expect(readLog(logPath)).toEqual(["nonblocking 0,0,0"]);
	});

	it("preserves the environment when execve defaults to an empty environment", () => {
		tmpDir = mkdtempSync(join(tmpdir(), "crust-launcher-test-"));
		const launcher = stageLauncher(
			tmpDir,
			`#!${process.execPath}\nconsole.log(JSON.stringify(process.env));`,
		);
		const env = {
			PATH: process.env.PATH!,
			LAUNCHER_TEST_VALUE: "value with spaces=kept",
			LAUNCHER_TEST_EMPTY: "",
		};
		// Reproduce early execve defaults (e.g. Node 24.0.0) on newer test hosts too.
		const result = spawnSync(
			process.execPath,
			[
				"--import",
				"data:text/javascript,const execve = process.execve; process.execve = (file, args, env = {}) => execve(file, args, env);",
				launcher,
			],
			{ env, encoding: "utf8", timeout: TIMEOUT },
		);
		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout)).toEqual(env);
	});

	it("tells users of a Node.js without execve which version it needs", () => {
		tmpDir = mkdtempSync(join(tmpdir(), "crust-launcher-test-"));
		const result = spawnSync(
			process.execPath,
			["--import", "data:text/javascript,delete process.execve", stageLauncher(tmpDir)],
			{ encoding: "utf8", timeout: TIMEOUT },
		);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("[app] Requires Node.js 22.15 or later");
	});

	it(
		"re-raises the signal that terminated the child",
		async () => {
			const result = await runSignaled("plain", ({ pid }) => process.kill(pid!, "SIGTERM"));
			expect(result).toEqual({ exitCode: null, signal: "SIGTERM", log: [] });
		},
		TIMEOUT * 2,
	);
});
