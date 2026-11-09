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
	/**
	 * Aborting it sends `SIGTERM` to the child and, on POSIX, to the descendants it has at that
	 * moment, such as a shell's workers (timed calls: the whole process group, killed). It rejects
	 * with `signal.reason` once the child and those descendants exit. Untimed children stay in this
	 * process's group, so terminal Ctrl-C and `/dev/tty` keep reaching them. Windows terminates
	 * only the direct child. An already-aborted signal rejects before spawning.
	 */
	signal?: AbortSignal;
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

/** `token` as one POSIX shell word: kept bare when it has only safe characters, else single-quoted. */
export function shellQuote(token: string): string {
	return /^[A-Za-z0-9_./:=@%+-]+$/.test(token)
		? token
		: `'${token.replaceAll("'", String.raw`'\''`)}'`;
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

/** POSIX: the descendants of `pid` in one `ps` snapshot, or none when `ps` fails. */
function listDescendants(pid: number): number[] {
	const { spawnSync } = process.getBuiltinModule("node:child_process");
	const result = spawnSync("ps", ["-A", "-o", "pid=", "-o", "ppid="], {
		encoding: "utf8",
		timeout: 10_000,
	});
	if (result.status !== 0) return [];
	const children = new Map<number, number[]>();
	for (const line of result.stdout.split("\n")) {
		const [child, parent] = line.trim().split(/\s+/).map(Number);
		if (child && parent) children.set(parent, [...(children.get(parent) ?? []), child]);
	}
	const descendants = [...(children.get(pid) ?? [])];
	for (let i = 0; i < descendants.length; i++) {
		descendants.push(...(children.get(descendants[i]!) ?? []));
	}
	return descendants;
}

function isRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
	} catch {
		return false;
	}
	// A zombie has exited; under a PID 1 that never reaps (a container without an init) it stays.
	try {
		const { readFileSync } = process.getBuiltinModule("node:fs");
		return !/^\d+ \(.*\) Z/s.test(readFileSync(`/proc/${pid}/stat`, "utf8"));
	} catch {
		// No procfs (macOS): its PID 1 reaps, so a live PID is running.
		return true;
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
	options.signal?.throwIfAborted();
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
	// An untimed child shares this process's group (see `detached`), so its descendants are
	// reached through a snapshot instead of a group kill.
	let abortedDescendants: number[] = [];
	const onAbort = () => {
		try {
			if (detached) killProcessTree(proc);
			else {
				// shortcut: a process forked between the snapshot and the kill escapes; use a
				// foreground process group if Node ever exposes tcsetpgrp.
				const descendants =
					process.platform !== "win32" &&
					proc.pid !== undefined &&
					proc.exitCode === null &&
					proc.signalCode === null
						? listDescendants(proc.pid)
						: [];
				// The parent first, so a shell cannot start its next command once a worker dies.
				proc.kill("SIGTERM");
				abortedDescendants = descendants.filter((pid) => {
					try {
						process.kill(pid, "SIGTERM");
						return true;
					} catch {
						// Gone already, or not ours to signal (such as a root child of `sudo`).
						return false;
					}
				});
			}
		} catch {
			// The child already exited; its close settles the call.
		}
	};
	options.signal?.addEventListener("abort", onAbort, { once: true });

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
		if (options.signal?.aborted) {
			const { setTimeout: sleep } = process.getBuiltinModule("node:timers/promises");
			while ((abortedDescendants = abortedDescendants.filter(isRunning)).length > 0) {
				await sleep(10);
			}
		}
		options.signal?.throwIfAborted();
		return { exitCode, stdout, stderr };
	} finally {
		clearTimeout(timer);
		release();
		options.signal?.removeEventListener("abort", onAbort);
	}
}

/**
 * All of stdin as UTF-8 text. Read asynchronously: a synchronous read would block the
 * event loop, so Ctrl-C could not cancel a read waiting on an open pipe or terminal.
 * Rejects with `signal.reason` on abort. Stdin an earlier consumer already read to EOF
 * reads as `""`, since its `end` event cannot fire again.
 */
export async function readStdin(signal: AbortSignal): Promise<string> {
	signal.throwIfAborted();
	const { stdin } = process;
	if (stdin.readableEnded || stdin.destroyed) return "";
	const chunks: Buffer[] = [];
	const done = Promise.withResolvers<string>();
	// Strings arrive when something already called `stdin.setEncoding()`.
	const onData = (chunk: Buffer | string) =>
		void chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk);
	const onEnd = () => done.resolve(Buffer.concat(chunks).toString("utf8"));
	const onAbort = () => done.reject(signal.reason);
	stdin.on("data", onData).once("end", onEnd).once("error", done.reject);
	signal.addEventListener("abort", onAbort, { once: true });
	// A `data` listener does not restart a stream an earlier consumer paused.
	stdin.resume();
	try {
		return await done.promise;
	} finally {
		signal.removeEventListener("abort", onAbort);
		stdin.off("data", onData).off("end", onEnd).off("error", done.reject);
		// Paused stdin no longer keeps the process alive after a cancelled read.
		stdin.pause();
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
