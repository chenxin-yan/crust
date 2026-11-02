/** SigIgn bits from the first read, taken before Crust installs any listener. */
let ignoredMask: number | undefined;

/**
 * Whether `signal` is inherited as ignored, such as SIGHUP under `nohup` or SIGINT for a
 * background job in a script. Adding a listener replaces that disposition and removing the
 * last one restores the default action, so code that listens temporarily skips ignored
 * signals to keep the process immune to them. Only Bun keeps an inherited ignore; Node
 * resets it at startup, so this is false there.
 *
 * shortcut: Linux-only (`/proc/self/status`); macOS Bun still loses the ignore. Remove once
 * Bun restores the previous disposition on listener removal (oven-sh/bun#47574).
 */
export function isSignalIgnored(signal: NodeJS.Signals): boolean {
	if (process.platform !== "linux") return false;
	ignoredMask ??= readIgnoredMask();
	const number = process.getBuiltinModule("node:os").constants.signals[signal];
	return number !== undefined && number <= 32 && ((ignoredMask >>> (number - 1)) & 1) === 1;
}

function readIgnoredMask(): number {
	try {
		const status = process.getBuiltinModule("node:fs").readFileSync("/proc/self/status", "utf8");
		const hex = /^SigIgn:\s*([0-9a-f]+)$/m.exec(status)?.[1];
		// Standard signals are the low 32 bits.
		return hex ? Number.parseInt(hex.slice(-8), 16) : 0;
	} catch {
		return 0;
	}
}
