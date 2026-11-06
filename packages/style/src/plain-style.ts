// ────────────────────────────────────────────────────────────────────────────
// Plain Style — `createStyle()` settings without the chain engine
// ────────────────────────────────────────────────────────────────────────────

import { isModifierName, styleMethodNames, styleMethodPairs } from "./ansi-codes.ts";
import { resolveColorDepth, resolveModifierCapability } from "./capability.ts";
import { plainStyleFn } from "./style-engine.ts";
import type { PlainStyle, StyleOptions } from "./types.ts";

/**
 * Create plain style functions with fixed settings, resolved once like
 * {@link createStyle}: the same output for the same options, without chaining,
 * `open`/`close`, or dynamic `fg`/`bg`. Importing it does not bundle the chain
 * engine, so use it for styled output to a stream other than stdout.
 *
 * @example
 * ```ts
 * import { createPlainStyle } from "@crustjs/style";
 *
 * const err = createPlainStyle({ overrides: { isTTY: process.stderr.isTTY } });
 * process.stderr.write(`${err.bold(err.red("error:"))} config not found\n`);
 * ```
 */
export function createPlainStyle(options?: StyleOptions): PlainStyle {
	const mode = options?.mode ?? "auto";
	const modifiers = resolveModifierCapability(mode, options?.overrides);
	const colors = resolveColorDepth(mode, options?.overrides) !== "none";
	const modifiersEnabled = () => modifiers;
	const colorsEnabled = () => colors;
	// SAFETY: styleMethodNames lists every StyleMethodName key of PlainStyle.
	return Object.freeze(
		Object.fromEntries(
			styleMethodNames.map((name) => [
				name,
				plainStyleFn(
					styleMethodPairs[name],
					isModifierName(name) ? modifiersEnabled : colorsEnabled,
				),
			]),
		),
	) as PlainStyle;
}
