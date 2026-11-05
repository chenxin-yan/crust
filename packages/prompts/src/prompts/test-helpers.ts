import type { TerminalIO } from "../core/renderer.ts";
import { createPromptIO } from "../testing.ts";

/**
 * Wait until the prompt has handled all input written so far and drawn the resulting frame.
 *
 * Keypresses are processed on nextTicks/microtasks, and the renderer then defers the frame with
 * `setTimeout(0)`. `setImmediate` resolves only after that chain drains, so the `setTimeout(0)`
 * queued from it lands behind the frame timer in the same timer list. A fixed sleep instead
 * races the frame: Node stamps each timer when it is created, so a stall on a loaded machine
 * lets the sleep expire first.
 */
export async function tick(): Promise<void> {
	await new Promise<void>((resolve) => setImmediate(resolve));
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

export function nonTTYIO(): Required<TerminalIO> {
	return createPromptIO({ isTTY: false }).io;
}

export type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
export type Expect<T extends true> = T;
