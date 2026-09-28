// Test-only subprocess runner. Vitest's test timeout neither cancels an awaited
// child nor reaps it, so a hung command would keep writing into fixtures during
// teardown. At `timeout`, runBoundedProcess kills the POSIX process group or
// live Windows tree; Windows descendants whose parent exited can escape cleanup.
// reapBoundedProcesses applies the same cleanup to tracked children and must run
// in afterEach/afterAll before fixtures are removed.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";

// Imported as a package, never by source path: `vp pack` for this package emits
// declarations beside any out-of-package source file its test program reaches.
import {
	getWindowsShimCommand,
	killProcessTree,
	type RunProcessResult,
} from "@crustjs/utils/process";

export type BoundedProcessOptions = {
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	/** Milliseconds before process-tree cleanup; Windows requires a live parent. */
	timeout: number;
};

type RunningProcess = { stop: (reason: string) => void; closed: Promise<unknown> };

const running = new Set<RunningProcess>();

/** runProcess (same Windows command-shim handling and result, plus the exit signal) with a kill deadline. */
export async function runBoundedProcess(
	command: string,
	args: readonly string[],
	options: BoundedProcessOptions,
): Promise<RunProcessResult & { signal: NodeJS.Signals | null }> {
	const windowsShimCommand = getWindowsShimCommand(command, args, undefined);
	const child = spawn(windowsShimCommand?.command ?? command, windowsShimCommand?.args ?? args, {
		cwd: options.cwd,
		env: options.env,
		// Its own process group lets one POSIX signal reach every descendant.
		detached: process.platform !== "win32",
		stdio: ["ignore", "pipe", "pipe"],
		windowsHide: true,
		windowsVerbatimArguments: windowsShimCommand?.windowsVerbatimArguments,
	});
	let stdout = "";
	let stderr = "";
	child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
		stdout += chunk;
	});
	child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
		stderr += chunk;
	});
	const closed = once(child, "close");
	let killedBecause: string | undefined;
	const entry: RunningProcess = {
		stop(reason) {
			killedBecause ??= reason;
			killProcessTree(child);
			// Descendants that escaped the kill must not hold "close" open.
			child.stdout.destroy();
			child.stderr.destroy();
		},
		closed: closed.catch(() => {}),
	};
	running.add(entry);
	const timer = setTimeout(
		() => entry.stop(`timed out after ${options.timeout}ms`),
		options.timeout,
	);
	try {
		const [exitCode, signal] = await closed;
		if (killedBecause !== undefined) {
			throw new Error(
				`${[command, ...args].join(" ")} ${killedBecause}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
			);
		}
		return { exitCode, signal, stdout, stderr };
	} finally {
		clearTimeout(timer);
		running.delete(entry);
		// Leftover members of the child's process group die with it.
		if (process.platform !== "win32") killProcessTree(child);
	}
}

/** Kills every bounded child still running and waits until each has exited. */
export async function reapBoundedProcesses(): Promise<void> {
	const entries = [...running];
	for (const entry of entries) entry.stop("was killed during test teardown");
	await Promise.all(entries.map((entry) => entry.closed));
}

/** Whether `pid` is alive, treating zombies as exited. */
export function isRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		if (process.platform === "linux") {
			// A non-reaping container init can retain terminated children as zombies.
			const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
			return stat[stat.lastIndexOf(")") + 2] !== "Z";
		}
		return true;
	} catch (error) {
		// SAFETY: process.kill and readFileSync throw errno exceptions.
		const code = (error as NodeJS.ErrnoException).code;
		return code !== "ESRCH" && code !== "ENOENT";
	}
}
