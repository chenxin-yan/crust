import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, extname, join, resolve, sep, win32 } from "node:path";
import { text } from "node:stream/consumers";

import { isErrnoException } from "./error.ts";

export type PackageManager = "npm" | "pnpm" | "bun" | "yarn";

/** Parse the package manager from npm's user-agent environment value. */
export function packageManagerFromUserAgent(userAgent: string | undefined): PackageManager | null {
	if (userAgent?.startsWith("bun")) return "bun";
	if (userAgent?.startsWith("pnpm")) return "pnpm";
	if (userAgent?.startsWith("yarn")) return "yarn";
	if (userAgent?.startsWith("npm")) return "npm";
	return null;
}

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
	 * Deno requires unrestricted `--allow-run` for POSIX group cleanup; a scoped
	 * grant still permits direct-child termination, but group cleanup is reported as failed.
	 */
	timeout?: number;
};

export type RunProcessResult = {
	exitCode: number | null;
	stdout: string;
	stderr: string;
};

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
	const shimCommand = win32.normalize(command);
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
		// Deno's child handle can still be killed with executable-scoped run permission.
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
	const proc = spawn(windowsShimCommand?.command ?? command, windowsShimCommand?.args ?? args, {
		cwd: options.cwd,
		env: options.env,
		shell: options.shell,
		stdio: collect ? ["ignore", collectStdout ? "pipe" : "ignore", "pipe"] : "inherit",
		// Only timed calls need a group; untimed interactive children keep terminal semantics.
		detached: options.timeout !== undefined && process.platform !== "win32",
		windowsVerbatimArguments: windowsShimCommand?.windowsVerbatimArguments,
	});

	let timer: NodeJS.Timeout | undefined;
	const deadline = new Promise<never>((_, reject) => {
		if (options.timeout === undefined) return;
		const timeout = options.timeout;
		timer = setTimeout(() => {
			let failure = new Error(
				`${[command, ...args].join(" ")} did not exit within ${timeout} ms and was killed.`,
			);
			try {
				killProcessTree(proc);
			} catch (cause) {
				failure = new Error("Process-tree cleanup failed after timeout.", { cause });
			}
			// Escaped descendants must not hold the timeout open through inherited pipes.
			proc.stdout?.destroy();
			proc.stderr?.destroy();
			reject(failure);
		}, timeout);
	});

	try {
		const [stdout, stderr, [exitCode]] = await Promise.race([
			Promise.all([
				collectStdout ? text(proc.stdout!) : "",
				collect ? text(proc.stderr!) : "",
				once(proc, "close"),
			]),
			deadline,
		]);
		return { exitCode, stdout, stderr };
	} finally {
		clearTimeout(timer);
	}
}

function isExecutableFile(path: string): boolean {
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
