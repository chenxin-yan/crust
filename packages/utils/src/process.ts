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

const WINDOWS_SHELL_LITERAL = /^[A-Za-z0-9._/:=@+-]+$/;

/** @internal Select and validate Node's Windows command-shim workaround. */
export function getWindowsShimCommand(
	command: string,
	args: readonly string[],
	shell: boolean | undefined,
	platform: NodeJS.Platform = process.platform,
): string | null {
	if (shell || platform !== "win32" || !/\.(cmd|bat)$/i.test(command)) return null;

	const shimCommand = win32.basename(command, win32.extname(command));
	for (const [index, value] of [shimCommand, ...args].entries()) {
		if (!WINDOWS_SHELL_LITERAL.test(value)) {
			const label = index === 0 ? "command" : `argument ${index}`;
			throw new Error(
				`Windows command shim ${label} ${JSON.stringify(value)} contains unsafe shell characters`,
			);
		}
	}
	return shimCommand;
}

/**
 * Spawn a process and wait for it to exit without imposing an error policy.
 *
 * On Windows, the automatic `.cmd`/`.bat` shell workaround accepts only literal
 * command and argument characters; unsafe values throw before spawning. Explicit
 * `shell: true` calls are passed through unchanged and own their shell escaping.
 */
export async function runProcess(
	command: string,
	args: readonly string[] = [],
	options: RunProcessOptions = {},
): Promise<RunProcessResult> {
	// Node's CVE-2024-27980 hardening rejects direct .cmd/.bat spawning. The
	// basename remains safe here because these shims are resolved through PATH.
	const windowsShimCommand = getWindowsShimCommand(command, args, options.shell);
	const collect = (options.stdio ?? "collect") === "collect";
	const collectStdout = collect && options.stdout !== "ignore";
	const proc = spawn(windowsShimCommand ?? command, args, {
		cwd: options.cwd,
		env: options.env,
		shell: windowsShimCommand !== null || options.shell,
		stdio: collect ? ["ignore", collectStdout ? "pipe" : "ignore", "pipe"] : "inherit",
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
