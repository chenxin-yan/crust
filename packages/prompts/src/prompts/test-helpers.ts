import type { PromptIO } from "../core/renderer.ts";
import { createPromptIO, type RenderedPrompt } from "../testing.ts";

export function tick(ms = 10): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForScreen(
	prompt: Pick<RenderedPrompt<unknown>, "screen">,
	needle: string,
	timeout = 500,
): Promise<void> {
	const start = Date.now();
	while (!prompt.screen().includes(needle)) {
		if (Date.now() - start > timeout) {
			throw new Error(
				`screen never contained ${JSON.stringify(needle)} within ${timeout}ms. ` +
					`Got: ${JSON.stringify(prompt.screen())}`,
			);
		}
		await tick(5);
	}
}

export function nonTTYIO(): Required<PromptIO> {
	return createPromptIO({ isTTY: false }).io;
}
