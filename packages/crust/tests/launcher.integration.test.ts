// The generated npm launcher stands between the user's shell and the platform
// binary, so it must keep the child's signal lifecycle: PID-directed SIGTERM is
// forwarded, terminal Ctrl-C (SIGINT to the whole process group) is left to the
// child, and the launcher exits only after the child, with its exit status.
import { spawn } from "node:child_process";
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
function stageLauncher(dir: string): string {
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
	writeFileSync(binaryPath, `#!${process.execPath}\n${CHILD_SOURCE}`);
	chmodSync(binaryPath, 0o755);
	return launcherPath;
}

function readLog(logPath: string): string[] {
	return existsSync(logPath) ? readFileSync(logPath, "utf8").trim().split("\n") : [];
}

/** Runs the launcher in its own process group, signals it once the child is ready, and returns how it exited. */
async function runSignaled(mode: "trap" | "plain", deliver: (launcherPid: number) => void) {
	tmpDir = mkdtempSync(join(tmpdir(), "crust-launcher-test-"));
	const logPath = join(tmpDir, "child.log");
	const launcher = spawn(process.execPath, [stageLauncher(tmpDir), mode], {
		// A group leader, so a negative PID reaches the launcher and child together like Ctrl-C.
		detached: true,
		env: { ...process.env, LAUNCHER_TEST_LOG: logPath },
		stdio: "ignore",
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
		deliver(launcher.pid!);
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
			const result = await runSignaled("trap", (pid) => process.kill(pid, "SIGTERM"));
			expect(result).toEqual({ exitCode: 3, signal: null, log: ["got SIGTERM", "cleanup done"] });
		},
		TIMEOUT * 2,
	);

	it(
		"leaves terminal-group SIGINT to the child and waits for its cleanup",
		async () => {
			const result = await runSignaled("trap", (pid) => process.kill(-pid, "SIGINT"));
			// Exactly one SIGINT: a forwarded duplicate would force-quit a Crust CLI.
			expect(result).toEqual({ exitCode: 3, signal: null, log: ["got SIGINT", "cleanup done"] });
		},
		TIMEOUT * 2,
	);

	it(
		"re-raises the signal that terminated the child",
		async () => {
			const result = await runSignaled("plain", (pid) => process.kill(pid, "SIGTERM"));
			expect(result).toEqual({ exitCode: null, signal: "SIGTERM", log: [] });
		},
		TIMEOUT * 2,
	);
});
