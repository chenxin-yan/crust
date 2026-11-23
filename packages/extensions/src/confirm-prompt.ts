import { canPrompt, confirm } from "@crustjs/prompts";

/** Asks on the terminal, defaulting to No; `undefined` where no prompt can ask ({@link canPrompt}). */
export async function promptConfirmation(message: string): Promise<boolean | undefined> {
	if (!canPrompt()) return undefined;
	return confirm({ message, default: false });
}
