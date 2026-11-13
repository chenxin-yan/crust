import { confirm } from "@crustjs/prompts";
import { getTerminalIO } from "@crustjs/utils/terminal";

/**
 * Asks on the terminal, defaulting to No; `undefined` when stdin or stderr is not a TTY, or
 * under `ci` unless a `withTerminalIO` scope injected the terminal.
 */
export async function promptConfirmation(
	message: string,
	ci: boolean,
): Promise<boolean | undefined> {
	// The streams prompts resolve: the ambient terminal scope, then the process streams.
	const ambient = getTerminalIO();
	// CI guards against a pseudo-terminal nobody answers; an injected one (such as
	// `runInteractive()`'s fake terminal) is answered by whoever injected it.
	if (ci && ambient?.input?.isTTY !== true) return undefined;
	const input = ambient?.input ?? process.stdin;
	const output = ambient?.output ?? process.stderr;
	if (!(input.isTTY && output.isTTY)) return undefined;
	return confirm({ message, default: false }, { input, output });
}
