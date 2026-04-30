// ────────────────────────────────────────────────────────────────────────────
// Runtime Exports — Top-level color/modifier helpers
// ────────────────────────────────────────────────────────────────────────────
//
// Each helper delegates to the shared `style` facade in createStyle.ts so that
// `NO_COLOR`, `--color` / `--no-color` flags, and in-process color overrides
// (`setGlobalColorMode`) take effect on every call instead of binding once at
// import time.

import { style } from "./createStyle.ts";
import type { HyperlinkOptions } from "./hyperlinks.ts";
import type { ColorInput, StyleFn } from "./types.ts";

export const black: StyleFn = (text) => style.black(text);
export const red: StyleFn = (text) => style.red(text);
export const green: StyleFn = (text) => style.green(text);
export const yellow: StyleFn = (text) => style.yellow(text);
export const blue: StyleFn = (text) => style.blue(text);
export const magenta: StyleFn = (text) => style.magenta(text);
export const cyan: StyleFn = (text) => style.cyan(text);
export const white: StyleFn = (text) => style.white(text);
export const gray: StyleFn = (text) => style.gray(text);
export const brightRed: StyleFn = (text) => style.brightRed(text);
export const brightGreen: StyleFn = (text) => style.brightGreen(text);
export const brightYellow: StyleFn = (text) => style.brightYellow(text);
export const brightBlue: StyleFn = (text) => style.brightBlue(text);
export const brightMagenta: StyleFn = (text) => style.brightMagenta(text);
export const brightCyan: StyleFn = (text) => style.brightCyan(text);
export const brightWhite: StyleFn = (text) => style.brightWhite(text);
export const bgBlack: StyleFn = (text) => style.bgBlack(text);
export const bgRed: StyleFn = (text) => style.bgRed(text);
export const bgGreen: StyleFn = (text) => style.bgGreen(text);
export const bgYellow: StyleFn = (text) => style.bgYellow(text);
export const bgBlue: StyleFn = (text) => style.bgBlue(text);
export const bgMagenta: StyleFn = (text) => style.bgMagenta(text);
export const bgCyan: StyleFn = (text) => style.bgCyan(text);
export const bgWhite: StyleFn = (text) => style.bgWhite(text);
export const bgBrightBlack: StyleFn = (text) => style.bgBrightBlack(text);
export const bgBrightRed: StyleFn = (text) => style.bgBrightRed(text);
export const bgBrightGreen: StyleFn = (text) => style.bgBrightGreen(text);
export const bgBrightYellow: StyleFn = (text) => style.bgBrightYellow(text);
export const bgBrightBlue: StyleFn = (text) => style.bgBrightBlue(text);
export const bgBrightMagenta: StyleFn = (text) => style.bgBrightMagenta(text);
export const bgBrightCyan: StyleFn = (text) => style.bgBrightCyan(text);
export const bgBrightWhite: StyleFn = (text) => style.bgBrightWhite(text);
export const bold: StyleFn = (text) => style.bold(text);
export const dim: StyleFn = (text) => style.dim(text);
export const italic: StyleFn = (text) => style.italic(text);
export const underline: StyleFn = (text) => style.underline(text);
export const inverse: StyleFn = (text) => style.inverse(text);
export const hidden: StyleFn = (text) => style.hidden(text);
export const strikethrough: StyleFn = (text) => style.strikethrough(text);

export function link(
	text: string,
	url: string,
	options?: HyperlinkOptions,
): string {
	return style.link(text, url, options);
}

export function fg(text: string, input: ColorInput): string {
	return style.fg(text, input);
}

export function bg(text: string, input: ColorInput): string {
	return style.bg(text, input);
}
