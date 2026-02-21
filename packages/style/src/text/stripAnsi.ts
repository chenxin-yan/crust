// ────────────────────────────────────────────────────────────────────────────
// Strip ANSI — Remove escape sequences from strings
// ────────────────────────────────────────────────────────────────────────────

/**
 * Regex matching ANSI escape sequences.
 *
 * Covers:
 * - CSI sequences: `\x1b[...m` (SGR), `\x1b[...H` (cursor), etc.
 * - OSC sequences: `\x1b]...(\x07|\x1b\\)` (hyperlinks, titles, etc.)
 * - Single/two-char escapes: `\x1b[A-Z]`, `\x1b(B`, etc.
 *
 * @see https://en.wikipedia.org/wiki/ANSI_escape_code
 */
const ANSI_REGEX =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape detection requires matching control characters
	/[\x1b\x9b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g;

/**
 * Remove all ANSI escape sequences from a string.
 *
 * Returns the plain-text content with all styling, cursor, and control
 * escape sequences stripped. Useful for computing visible text width,
 * logging plain output, or comparing styled strings by content.
 *
 * @param text - The string potentially containing ANSI escape codes.
 * @returns The string with all ANSI escapes removed.
 *
 * @example
 * ```ts
 * import { stripAnsi } from "./stripAnsi.ts";
 *
 * stripAnsi("\x1b[1mhello\x1b[22m"); // "hello"
 * stripAnsi("no escapes"); // "no escapes"
 * ```
 */
export function stripAnsi(text: string): string {
	return text.replace(ANSI_REGEX, "");
}
