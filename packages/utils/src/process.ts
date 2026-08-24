import { spawn } from "node:child_process";
import { once } from "node:events";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, extname, join, sep, win32 } from "node:path";
import { text } from "node:stream/consumers";

export type RunProcessOptions = {
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	stdio?: "collect" | "inherit";
	/** Ignore stdout while collecting stderr. */
	stdout?: "collect" | "ignore";
	/** Run the command through the platform shell. */
	shell?: boolean;
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
 * Spawn a process and wait for it to exit without imposing an error policy.
 *
 * On Windows, the automatic `.cmd`/`.bat` workaround escapes arguments for
 * `cmd.exe`; unsafe shell-expansion characters throw before spawning. Explicit
 * `shell: true` calls are passed through unchanged and own their shell escaping.
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
		windowsVerbatimArguments: windowsShimCommand?.windowsVerbatimArguments,
	});

	const [stdout, stderr, [exitCode]] = await Promise.all([
		collectStdout ? text(proc.stdout!) : "",
		collect ? text(proc.stderr!) : "",
		once(proc, "close"),
	]);

	return { exitCode, stdout, stderr };
}

/** Resolve a bare executable name from PATH (and PATHEXT on Windows). */
export function which(command: string): string | null {
	// Path-containing inputs would produce garbage when joined onto PATH
	// entries; resolve them directly instead.
	if (command.includes(sep) || command.includes("/")) {
		try {
			accessSync(command, constants.X_OK);
			if (statSync(command).isFile()) return command;
		} catch {
			// Fall through: not executable or missing.
		}
		return null;
	}
	const extensions =
		process.platform === "win32" && !extname(command)
			? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
			: [""];
	for (const directory of process.env.PATH?.split(delimiter) ?? []) {
		for (const extension of extensions) {
			const candidate = join(directory, command + extension);
			try {
				accessSync(candidate, constants.X_OK);
				if (statSync(candidate).isFile()) return candidate;
			} catch {
				// Missing/non-executable PATH entries are expected while searching.
			}
		}
	}
	return null;
}
