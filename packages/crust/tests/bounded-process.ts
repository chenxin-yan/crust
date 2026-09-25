// Test-only subprocess runner. Vitest's test timeout neither cancels an awaited
// child nor reaps it, so a hung command would keep writing into fixtures during
// teardown. runBoundedProcess kills the child and its descendants at `timeout`;
// reapBoundedProcesses kills any still running (e.g. after the test itself timed
// out) and must run in afterEach/afterAll before fixtures are removed.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";

// Imported as a package, never by source path: `vp pack` for this package emits
// declarations beside any out-of-package source file its test program reaches.
import { getWindowsShimCommand, type RunProcessResult } from "@crustjs/utils/process";

export type BoundedProcessOptions = {
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	/** Milliseconds before the child and its descendants are killed. */
	timeout: number;
};

type RunningProcess = { stop: (reason: string) => void; closed: Promise<unknown> };

const running = new Set<RunningProcess>();

/** POSIX kills the child's process group; Windows kills its live process tree. */
function killTree(child: ChildProcess): void {
	if (child.pid === undefined) return;
	if (process.platform === "win32") {
		// An exited child's PID may be reused, and taskkill only walks live parents.
		// ponytail: descendants that outlive their parent on Windows are not reached.
		if (child.exitCode === null && child.signalCode === null) {
			spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
				stdio: "ignore",
				timeout: 10_000,
			});
		}
		return;
	}
	try {
		process.kill(-child.pid, "SIGKILL");
	} catch (error) {
		// SAFETY: process.kill throws errno exceptions.
		if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
	}
}

/** runProcess (same Windows command-shim handling and result) with a kill deadline. */
export async function runBoundedProcess(
	command: string,
	args: readonly string[],
	options: BoundedProcessOptions,
): Promise<RunProcessResult> {
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
			killTree(child);
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
		const [exitCode] = await closed;
		if (killedBecause !== undefined) {
			throw new Error(
				`${[command, ...args].join(" ")} ${killedBecause}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
			);
		}
		return { exitCode, stdout, stderr };
	} finally {
		clearTimeout(timer);
		running.delete(entry);
		// Leftover members of the child's process group die with it.
		if (process.platform !== "win32") killTree(child);
	}
}

/** Kills every bounded child still running and waits until each has exited. */
export async function reapBoundedProcesses(): Promise<void> {
	const entries = [...running];
	for (const entry of entries) entry.stop("was killed during test teardown");
	await Promise.all(entries.map((entry) => entry.closed));
}
