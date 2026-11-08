import { confirm } from "@crustjs/prompts";
import { getTerminalIO } from "@crustjs/utils/terminal";

/** Asks on the terminal, defaulting to No; `undefined` when stdin or stderr is not a TTY. */
export async function promptConfirmation(message: string): Promise<boolean | undefined> {
	// The streams prompts resolve: the ambient terminal scope, then the process streams.
	const ambient = getTerminalIO();
	const input = ambient?.input ?? process.stdin;
	const output = ambient?.output ?? process.stderr;
	if (!(input.isTTY && output.isTTY)) return undefined;
	return confirm({ message, default: false }, { input, output });
}
