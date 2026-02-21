// ────────────────────────────────────────────────────────────────────────────
// Colors — Foreground and background color style functions
// ────────────────────────────────────────────────────────────────────────────

import * as codes from "./ansiCodes.ts";
import { applyStyle } from "./styleEngine.ts";

// ────────────────────────────────────────────────────────────────────────────
// Foreground Colors
// ────────────────────────────────────────────────────────────────────────────

/** Apply black foreground color. */
export function black(text: string): string {
	return applyStyle(text, codes.black);
}

/** Apply red foreground color. */
export function red(text: string): string {
	return applyStyle(text, codes.red);
}

/** Apply green foreground color. */
export function green(text: string): string {
	return applyStyle(text, codes.green);
}

/** Apply yellow foreground color. */
export function yellow(text: string): string {
	return applyStyle(text, codes.yellow);
}

/** Apply blue foreground color. */
export function blue(text: string): string {
	return applyStyle(text, codes.blue);
}

/** Apply magenta foreground color. */
export function magenta(text: string): string {
	return applyStyle(text, codes.magenta);
}

/** Apply cyan foreground color. */
export function cyan(text: string): string {
	return applyStyle(text, codes.cyan);
}

/** Apply white foreground color. */
export function white(text: string): string {
	return applyStyle(text, codes.white);
}

/** Apply gray (bright black) foreground color. */
export function gray(text: string): string {
	return applyStyle(text, codes.gray);
}

// ────────────────────────────────────────────────────────────────────────────
// Bright Foreground Colors
// ────────────────────────────────────────────────────────────────────────────

/** Apply bright red foreground color. */
export function brightRed(text: string): string {
	return applyStyle(text, codes.brightRed);
}

/** Apply bright green foreground color. */
export function brightGreen(text: string): string {
	return applyStyle(text, codes.brightGreen);
}

/** Apply bright yellow foreground color. */
export function brightYellow(text: string): string {
	return applyStyle(text, codes.brightYellow);
}

/** Apply bright blue foreground color. */
export function brightBlue(text: string): string {
	return applyStyle(text, codes.brightBlue);
}

/** Apply bright magenta foreground color. */
export function brightMagenta(text: string): string {
	return applyStyle(text, codes.brightMagenta);
}

/** Apply bright cyan foreground color. */
export function brightCyan(text: string): string {
	return applyStyle(text, codes.brightCyan);
}

/** Apply bright white foreground color. */
export function brightWhite(text: string): string {
	return applyStyle(text, codes.brightWhite);
}

// ────────────────────────────────────────────────────────────────────────────
// Background Colors
// ────────────────────────────────────────────────────────────────────────────

/** Apply black background color. */
export function bgBlack(text: string): string {
	return applyStyle(text, codes.bgBlack);
}

/** Apply red background color. */
export function bgRed(text: string): string {
	return applyStyle(text, codes.bgRed);
}

/** Apply green background color. */
export function bgGreen(text: string): string {
	return applyStyle(text, codes.bgGreen);
}

/** Apply yellow background color. */
export function bgYellow(text: string): string {
	return applyStyle(text, codes.bgYellow);
}

/** Apply blue background color. */
export function bgBlue(text: string): string {
	return applyStyle(text, codes.bgBlue);
}

/** Apply magenta background color. */
export function bgMagenta(text: string): string {
	return applyStyle(text, codes.bgMagenta);
}

/** Apply cyan background color. */
export function bgCyan(text: string): string {
	return applyStyle(text, codes.bgCyan);
}

/** Apply white background color. */
export function bgWhite(text: string): string {
	return applyStyle(text, codes.bgWhite);
}

// ────────────────────────────────────────────────────────────────────────────
// Bright Background Colors
// ────────────────────────────────────────────────────────────────────────────

/** Apply bright black background color. */
export function bgBrightBlack(text: string): string {
	return applyStyle(text, codes.bgBrightBlack);
}

/** Apply bright red background color. */
export function bgBrightRed(text: string): string {
	return applyStyle(text, codes.bgBrightRed);
}

/** Apply bright green background color. */
export function bgBrightGreen(text: string): string {
	return applyStyle(text, codes.bgBrightGreen);
}

/** Apply bright yellow background color. */
export function bgBrightYellow(text: string): string {
	return applyStyle(text, codes.bgBrightYellow);
}

/** Apply bright blue background color. */
export function bgBrightBlue(text: string): string {
	return applyStyle(text, codes.bgBrightBlue);
}

/** Apply bright magenta background color. */
export function bgBrightMagenta(text: string): string {
	return applyStyle(text, codes.bgBrightMagenta);
}

/** Apply bright cyan background color. */
export function bgBrightCyan(text: string): string {
	return applyStyle(text, codes.bgBrightCyan);
}

/** Apply bright white background color. */
export function bgBrightWhite(text: string): string {
	return applyStyle(text, codes.bgBrightWhite);
}
