import type { ChildProcess } from "node:child_process";

import { isErrnoException } from "./error.ts";
import { isSignalIgnored } from "./signals.ts";

export type RunProcessOptions = {
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	stdio?: "collect" | "inherit";
	/** Ignore stdout while collecting stderr. */
	stdout?: "collect" | "ignore";
	/** Run the command through the platform shell. */
	shell?: boolean;
	/**
	 * Milliseconds before process-tree cleanup and rejection. POSIX descendants
	 * must remain in the child's group; Windows requires a live parent.
	 * On POSIX, SIGINT, SIGTERM, SIGHUP, SIGQUIT or a synchronous exit of this process
	 * also kills the group; a signal rejects the call and is re-raised when no other
	 * listener handles it. A signal this process inherited as ignored (Bun on Linux, such as
	 * SIGHUP under `nohup`) is left ignored: it neither kills the group nor rejects the call.
	 */
	timeout?: number;
};

export type RunProcessResult = {
	exitCode: number | null;
	stdout: string;
	stderr: string;
};

const LIFETIME_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"] as const;

type LifetimeBinding = { onSignal: (signal: NodeJS.Signals) => void; onExit: () => void };
// One shared listener per event for all bindings, so concurrency never trips MaxListeners.
const bindings = new Set<LifetimeBinding>();

// Re-raise only when no other listener owns the signal, like Core's SIGINT handling.
function onLifetimeSignal(signal: NodeJS.Signals): void {
	const pending = [...bindings];
	bindings.clear();
	removeLifetimeListeners();
	for (const binding of pending) binding.onSignal(signal);
	if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
}

function onLifetimeExit(): void {
	for (const binding of bindings) binding.onExit();
}

function removeLifetimeListeners(): void {
	for (const signal of LIFETIME_SIGNALS) process.removeListener(signal, onLifetimeSignal);
	process.removeListener("exit", onLifetimeExit);
}

/**
 * Ties a detached POSIX child group to this process, which the group no longer shares
 * terminal signals with. Until the returned release runs, SIGINT, SIGTERM, SIGHUP or SIGQUIT
 * calls `onSignal` once and is then re-raised when no other listener handles it, and a
 * synchronous exit (`process.exit`, an uncaught error) calls `onExit`. SIGKILL and native
 * crashes cannot be observed and still orphan the group. A signal this process inherited as
 * ignored (Bun on Linux, such as SIGHUP under `nohup`) stays ignored and is never listened for.
 */
export function bindToProcessLifetime(binding: LifetimeBinding): () => void {
	if (bindings.size === 0) {
		for (const signal of LIFETIME_SIGNALS) {
			if (!isSignalIgnored(signal)) process.prependListener(signal, onLifetimeSignal);
		}
		process.on("exit", onLifetimeExit);
	}
	bindings.add(binding);
	return () => {
		if (bindings.delete(binding) && bindings.size === 0) removeLifetimeListeners();
	};
}

const WINDOWS_SHELL_UNSAFE = /[\0\r\n"%!^`<>&|]/;
const WINDOWS_SHELL_META = /([()\][%!^"`<>&|;, *?])/g;

function escapeWindowsShellArgument(value: string): string {
	let escaped = value.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"');
	escaped = escaped.replace(/(?=(\\+?)?)\1$/g, "$1$1");
	escaped = `"${escaped}"`.replace(WINDOWS_SHELL_META, "^$1");
	// Command shims (npm/bun/cmd-shim style) re-expand `%*`, so cmd.exe parses
	// the arguments once more than for a plain executable — hence the second
	// caret layer. ponytail: a generic .bat consuming %1 directly would receive
	// that extra layer; gate this per-shim if such a caller ever appears.
	return escaped.replace(WINDOWS_SHELL_META, "^$1");
}

/** @internal Build Node's escaped Windows command-shim workaround. */
export function getWindowsShimCommand(
	command: string,
	args: readonly string[],
	shell: boolean | undefined,
	platform: NodeJS.Platform = process.platform,
): { command: string; args: string[]; windowsVerbatimArguments: true } | null {
	if (shell || platform !== "win32" || !/\.(cmd|bat)$/i.test(command)) return null;

	// Preserve the exact executable the caller resolved (e.g. via which());
	// passing a bare name would let cmd.exe re-resolve it from cwd/PATH and
	// potentially run a different same-named command.
	const shimCommand = process.getBuiltinModule("node:path").win32.normalize(command);
	for (const [index, value] of [shimCommand, ...args].entries()) {
		if (WINDOWS_SHELL_UNSAFE.test(value)) {
			const label = index === 0 ? "command" : `argument ${index}`;
			throw new Error(
				`Windows command shim ${label} ${JSON.stringify(value)} contains unsafe shell characters`,
			);
		}
	}

	const commandLine = [
		shimCommand.replace(WINDOWS_SHELL_META, "^$1"),
		...args.map(escapeWindowsShellArgument),
	].join(" ");
	return {
		command: process.env.ComSpec ?? "cmd.exe",
		args: ["/d", "/s", "/c", `"${commandLine}"`],
		windowsVerbatimArguments: true,
	};
}

/**
 * @internal Kill a POSIX process group (spawned with `detached: true`) or a
 * live Windows process tree. Descendants that leave the group are not reached.
 * If POSIX group signaling fails, try the direct child before rethrowing.
 */
export function killProcessTree(child: ChildProcess): void {
	if (child.pid === undefined) return;
	if (process.platform === "win32") {
		// An exited child's PID may be reused, and taskkill only walks live parents.
		// ponytail: Windows orphans escape cleanup; use Job Objects if supported tools leave workers behind.
		if (child.exitCode === null && child.signalCode === null) {
			const { spawnSync } = process.getBuiltinModule("node:child_process");
			const result = spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
				stdio: "ignore",
				timeout: 10_000,
			});
			// Preserve direct-child cleanup if taskkill is unavailable or fails.
			if (result.error || result.status !== 0) child.kill("SIGKILL");
		}
		return;
	}
	try {
		process.kill(-child.pid, "SIGKILL");
	} catch (error) {
		if (isErrnoException(error) && error.code === "ESRCH") return;
		child.kill("SIGKILL");
		throw error;
	}
}

/**
 * Spawn a process and wait for it to exit without imposing an error policy.
 *
 * On Windows, the automatic `.cmd`/`.bat` workaround supports command shims
 * forwarding arguments through `%*`, not arbitrary batch files consuming `%1`.
 * Unsafe shell-expansion characters throw before spawning. Explicit `shell: true`
 * calls are passed through unchanged and own their shell escaping.
 */
export async function runProcess(
	command: string,
	args: readonly string[] = [],
	options: RunProcessOptions = {},
): Promise<RunProcessResult> {
	// Node's CVE-2024-27980 hardening rejects direct .cmd/.bat spawning.
	const windowsShimCommand = getWindowsShimCommand(command, args, options.shell);
	const collect = (options.stdio ?? "collect") === "collect";
	const collectStdout = collect && options.stdout !== "ignore";
	// Only timed calls need a group; untimed interactive children keep terminal semantics.
	const detached = options.timeout !== undefined && process.platform !== "win32";
	const { spawn } = process.getBuiltinModule("node:child_process");
	const proc = spawn(windowsShimCommand?.command ?? command, windowsShimCommand?.args ?? args, {
		cwd: options.cwd,
		env: options.env,
		shell: options.shell,
		stdio: collect ? ["ignore", collectStdout ? "pipe" : "ignore", "pipe"] : "inherit",
		detached,
		windowsVerbatimArguments: windowsShimCommand?.windowsVerbatimArguments,
	});

	const commandLine = [command, ...args].join(" ");
	let stop!: (message: string, reason: string) => void;
	const stopped = new Promise<never>((_, reject) => {
		stop = (message, reason) => {
			let failure = new Error(message);
			try {
				killProcessTree(proc);
			} catch (cause) {
				failure = new Error(`Process-tree cleanup failed after ${reason}.`, { cause });
			}
			// Escaped descendants must not hold the timeout open through inherited pipes.
			proc.stdout?.destroy();
			proc.stderr?.destroy();
			reject(failure);
		};
	});
	const timeout = options.timeout;
	const timer =
		timeout === undefined
			? undefined
			: setTimeout(
					() => stop(`${commandLine} did not exit within ${timeout} ms and was killed.`, "timeout"),
					timeout,
				);
	const release = detached
		? bindToProcessLifetime({
				onSignal: (signal) => stop(`${commandLine} was interrupted by ${signal}.`, signal),
				onExit: () => {
					try {
						killProcessTree(proc);
					} catch {
						// Best effort: the exiting process takes precedence.
					}
				},
			})
		: () => {};

	const { text } = process.getBuiltinModule("node:stream/consumers");
	const { once } = process.getBuiltinModule("node:events");
	try {
		const [stdout, stderr, [exitCode]] = await Promise.race([
			Promise.all([
				collectStdout ? text(proc.stdout!) : "",
				collect ? text(proc.stderr!) : "",
				once(proc, "close"),
			]),
			stopped,
		]);
		return { exitCode, stdout, stderr };
	} finally {
		clearTimeout(timer);
		release();
	}
}

function isExecutableFile(path: string): boolean {
	const { accessSync, constants, statSync } = process.getBuiltinModule("node:fs");
	try {
		accessSync(path, constants.X_OK);
		return statSync(path).isFile();
	} catch {
		// Missing or non-executable paths are expected while probing.
		return false;
	}
}

/** Resolve a bare executable name from PATH (and PATHEXT on Windows). */
export function which(command: string): string | null {
	const { delimiter, extname, join, resolve, sep } = process.getBuiltinModule("node:path");
	// Path-containing inputs would produce garbage when joined onto PATH
	// entries; resolve them directly instead.
	if (command.includes(sep) || command.includes("/")) {
		return isExecutableFile(command) ? command : null;
	}
	const extensions =
		process.platform === "win32" && !extname(command)
			? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
			: [""];
	for (const directory of process.env.PATH?.split(delimiter) ?? []) {
		for (const extension of extensions) {
			// Resolve relative PATH entries against the current cwd; a relative
			// result would be re-resolved against the child's cwd when spawned.
			const candidate = resolve(join(directory, command + extension));
			if (isExecutableFile(candidate)) return candidate;
		}
	}
	return null;
}
