// ────────────────────────────────────────────────────────────────────────────
// Wrap — Line wrapping by visible width with style continuity
// ────────────────────────────────────────────────────────────────────────────

/**
 * Regex that matches a single ANSI escape sequence at the current position.
 *
 * Used to parse styled text character-by-character while tracking active
 * style state across wrap boundaries.
 */
const ANSI_SEQUENCE =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape detection requires matching control characters
	/[\x1b\x9b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/;

/**
 * Test whether a code point is a full-width character (occupies 2 columns).
 */
function isFullWidth(codePoint: number): boolean {
	return (
		(codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
		(codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
		(codePoint >= 0x20000 && codePoint <= 0x2a6df) ||
		(codePoint >= 0xf900 && codePoint <= 0xfaff) ||
		(codePoint >= 0xff01 && codePoint <= 0xff60) ||
		(codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
		(codePoint >= 0x2e80 && codePoint <= 0x2eff) ||
		(codePoint >= 0x2f00 && codePoint <= 0x2fdf) ||
		(codePoint >= 0x3000 && codePoint <= 0x303f) ||
		(codePoint >= 0x3040 && codePoint <= 0x309f) ||
		(codePoint >= 0x30a0 && codePoint <= 0x30ff) ||
		(codePoint >= 0x3100 && codePoint <= 0x312f) ||
		(codePoint >= 0x3130 && codePoint <= 0x318f) ||
		(codePoint >= 0x3200 && codePoint <= 0x32ff) ||
		(codePoint >= 0x3300 && codePoint <= 0x33ff) ||
		(codePoint >= 0xac00 && codePoint <= 0xd7af) ||
		(codePoint >= 0xfe30 && codePoint <= 0xfe4f)
	);
}

/**
 * Check whether a character is an SGR reset sequence (\x1b[0m).
 */
function isReset(seq: string): boolean {
	return seq === "\x1b[0m";
}

/**
 * Check whether a sequence is an SGR (Select Graphic Rendition) sequence.
 * SGR sequences end with 'm'.
 */
function isSGR(seq: string): boolean {
	return seq.endsWith("m") && seq.startsWith("\x1b[");
}

// ────────────────────────────────────────────────────────────────────────────
// Wrap Options
// ────────────────────────────────────────────────────────────────────────────

/**
 * Options for {@link wrapText}.
 */
export interface WrapOptions {
	/**
	 * Whether to perform word-aware wrapping. When `true`, the wrapper
	 * breaks at the last space before the width limit rather than mid-word.
	 * If a single word exceeds the width, it is force-broken.
	 *
	 * @default true
	 */
	wordBreak?: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// Core Implementation
// ────────────────────────────────────────────────────────────────────────────

/**
 * Wrap text to a maximum visible width, preserving ANSI style continuity
 * across line breaks.
 *
 * When a line is broken, any active ANSI styles are closed at the end of the
 * current line and reopened at the start of the next line. This ensures each
 * output line is a self-contained, properly-terminated styled string.
 *
 * Existing newlines in the input are preserved — each logical line is wrapped
 * independently.
 *
 * @param text - The input text (may contain ANSI escape codes and newlines).
 * @param width - The maximum visible width per line (in terminal columns).
 * @param options - Optional wrapping behavior configuration.
 * @returns The wrapped text with style continuity preserved.
 *
 * @example
 * ```ts
 * import { wrapText } from "./wrap.ts";
 *
 * wrapText("hello world", 5);
 * // "hello\nworld"
 *
 * wrapText("\x1b[1mhello world\x1b[22m", 5);
 * // "\x1b[1mhello\x1b[22m\n\x1b[1mworld\x1b[22m"
 * ```
 */
export function wrapText(
	text: string,
	width: number,
	options?: WrapOptions,
): string {
	if (width <= 0) {
		return text;
	}

	const wordBreak = options?.wordBreak ?? true;

	// Process each existing line independently to preserve original newlines
	const inputLines = text.split("\n");
	const resultLines: string[] = [];

	// Track active styles across input lines (styles carry over)
	let activeStyles: string[] = [];

	for (const inputLine of inputLines) {
		const wrapped = wrapLine(inputLine, width, wordBreak, activeStyles);
		resultLines.push(...wrapped.lines);
		activeStyles = wrapped.activeStyles;
	}

	return resultLines.join("\n");
}

// ────────────────────────────────────────────────────────────────────────────
// Internal Helpers
// ────────────────────────────────────────────────────────────────────────────

interface WrapLineResult {
	lines: string[];
	activeStyles: string[];
}

/**
 * Wrap a single line (no embedded newlines) to the given width.
 *
 * Tracks ANSI SGR state and ensures style continuity across breaks.
 */
function wrapLine(
	line: string,
	width: number,
	wordBreak: boolean,
	initialStyles: string[],
): WrapLineResult {
	const activeStyles = [...initialStyles];
	const lines: string[] = [];

	let currentLine = activeStyles.length > 0 ? activeStyles.join("") : "";
	let currentWidth = 0;

	// For word-break mode: track the last breakable position
	let lastSpaceIdx = -1;
	let lastSpaceWidth = 0;
	let lastSpaceStyleSnapshot: string[] = [];

	let i = 0;
	while (i < line.length) {
		// Check for ANSI escape sequence at current position
		const ansiMatch = line.slice(i).match(ANSI_SEQUENCE);
		if (ansiMatch && ansiMatch.index === 0) {
			const seq = ansiMatch[0];

			// Track SGR state
			if (isSGR(seq)) {
				if (isReset(seq)) {
					activeStyles.length = 0;
				} else {
					activeStyles.push(seq);
				}
			}

			currentLine += seq;
			i += seq.length;
			continue;
		}

		const char = line[i];
		if (char === undefined) {
			break;
		}
		const codePoint = char.codePointAt(0) ?? 0;
		const charWidth = isFullWidth(codePoint) ? 2 : 1;

		// Check if adding this character would exceed the width
		if (currentWidth + charWidth > width) {
			// Try word-break first if enabled
			if (wordBreak && lastSpaceIdx !== -1) {
				// Break at the last space
				const beforeSpace = currentLine.slice(0, lastSpaceIdx);
				const afterSpace = currentLine.slice(lastSpaceIdx + 1); // skip the space

				// Close active styles at end of line
				const closeSeq = activeStyles.length > 0 ? "\x1b[0m" : "";
				lines.push(beforeSpace + closeSeq);

				// Reopen styles on next line using the snapshot from the space position
				const reopenSeq =
					lastSpaceStyleSnapshot.length > 0
						? lastSpaceStyleSnapshot.join("")
						: "";
				currentLine = reopenSeq + afterSpace;
				currentWidth = currentWidth - lastSpaceWidth;

				// Reset space tracking
				lastSpaceIdx = -1;
				lastSpaceWidth = 0;
				lastSpaceStyleSnapshot = [];

				// Now add the current character
				if (currentWidth + charWidth > width) {
					// Still overflows — force break (degenerate case)
					const closeSeq2 = activeStyles.length > 0 ? "\x1b[0m" : "";
					lines.push(currentLine + closeSeq2);
					const reopenSeq2 =
						activeStyles.length > 0 ? activeStyles.join("") : "";
					currentLine = reopenSeq2 + char;
					currentWidth = charWidth;
				} else {
					currentLine += char;
					currentWidth += charWidth;
				}
			} else {
				// Force break at current position
				const closeSeq = activeStyles.length > 0 ? "\x1b[0m" : "";
				lines.push(currentLine + closeSeq);

				const reopenSeq = activeStyles.length > 0 ? activeStyles.join("") : "";
				currentLine = reopenSeq + char;
				currentWidth = charWidth;
				lastSpaceIdx = -1;
				lastSpaceWidth = 0;
				lastSpaceStyleSnapshot = [];
			}
		} else {
			// Character fits — track spaces for word-break
			if (wordBreak && char === " ") {
				currentLine += char;
				currentWidth += charWidth;
				lastSpaceIdx = currentLine.length - 1;
				lastSpaceWidth = currentWidth;
				lastSpaceStyleSnapshot = [...activeStyles];
			} else {
				currentLine += char;
				currentWidth += charWidth;
			}
		}

		i += char.length;
	}

	// Push the remaining content
	if (currentLine.length > 0) {
		// Only close if we have active styles and there's visible content
		const hasVisibleContent = currentLine.replace(
			// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape detection requires matching control characters
			/[\x1b\x9b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g,
			"",
		);
		if (hasVisibleContent.length > 0 || currentLine.length > 0) {
			lines.push(currentLine);
		}
	} else {
		lines.push("");
	}

	return { lines, activeStyles };
}
