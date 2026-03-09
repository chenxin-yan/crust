// ────────────────────────────────────────────────────────────────────────────
// Options — Resolution helpers for @crustjs/render
// ────────────────────────────────────────────────────────────────────────────

import { createMarkdownTheme, type MarkdownTheme } from "@crustjs/style";
import type { RenderDocumentOptions, RenderMarkdownOptions } from "./types.ts";

const DEFAULT_WIDTH = 80;

/**
 * Fully resolved rendering options used internally by the renderer.
 */
export interface ResolvedRenderOptions {
	readonly theme: MarkdownTheme;
	readonly width: number;
	readonly indent: number;
}

/**
 * Resolve optional user-facing options into a complete render config.
 */
export function resolveRenderOptions(
	options?: RenderDocumentOptions,
): ResolvedRenderOptions {
	const width =
		options?.width ??
		(typeof process.stdout.columns === "number" && process.stdout.columns > 0
			? process.stdout.columns
			: DEFAULT_WIDTH);

	return {
		theme: options?.theme ?? createMarkdownTheme({ style: options?.style }),
		width: Math.max(1, width),
		indent: Math.max(0, options?.indent ?? 0),
	};
}

/**
 * Resolve markdown-specific options, including newline preservation.
 */
export function resolveRenderMarkdownOptions(
	options?: RenderMarkdownOptions,
): ResolvedRenderOptions & { readonly preserveTrailingNewline: boolean } {
	return {
		...resolveRenderOptions(options),
		preserveTrailingNewline: options?.preserveTrailingNewline ?? false,
	};
}
