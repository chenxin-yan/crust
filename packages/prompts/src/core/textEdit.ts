// ────────────────────────────────────────────────────────────────────────────
// Text Edit — Shared text-editing logic for @crustjs/prompts
// ────────────────────────────────────────────────────────────────────────────

import type { KeypressEvent } from "./renderer.ts";
import type { PromptTheme } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

/** Thin vertical bar used as cursor indicator in text inputs */
export const CURSOR_CHAR = "\u2502"; // │

export function renderTextWithCursor(
	text: string,
	cursorPos: number,
	theme: PromptTheme,
	placeholder?: string,
): string {
	if (text === "") {
		return placeholder ? theme.placeholder(placeholder) : theme.cursor(CURSOR_CHAR);
	}
	return `${text.slice(0, cursorPos)}${theme.cursor(CURSOR_CHAR)}${text.slice(cursorPos)}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

/**
 * The text + cursor fields that `handleTextEdit` reads and updates.
 * Prompts embed these fields in their own state type.
 */
export interface TextEditState {
	readonly text: string;
	readonly cursorPos: number;
}

/**
 * Result of a text-edit operation.
 * `null` means the key was not a text-editing key and the caller should
 * handle it (e.g., Enter for submit, arrow-up/down for list navigation).
 */
export type TextEditResult = TextEditState | null;

// ────────────────────────────────────────────────────────────────────────────
// Core handler
// ────────────────────────────────────────────────────────────────────────────

/**
 * Handle common text-editing keypresses: backspace, delete, left, right,
 * home, end, and printable character insertion.
 *
 * Returns the updated `{ text, cursorPos }` if the key was handled,
 * or `null` if the key is not a text-editing key (so the caller can
 * handle it for prompt-specific logic like submit or list navigation).
 *
 * @param key - The keypress event
 * @param text - Current text content
 * @param cursorPos - Current cursor position within the text
 * @returns Updated text/cursor, or `null` if not a text-edit key
 */
export function handleTextEdit(
	key: KeypressEvent,
	text: string,
	cursorPos: number,
): TextEditResult {
	if (key.name === "backspace") {
		if (cursorPos === 0) return { text, cursorPos };
		const before = text.slice(0, cursorPos - 1);
		const after = text.slice(cursorPos);
		return { text: before + after, cursorPos: cursorPos - 1 };
	}

	if (key.name === "delete") {
		if (cursorPos >= text.length) return { text, cursorPos };
		const before = text.slice(0, cursorPos);
		const after = text.slice(cursorPos + 1);
		return { text: before + after, cursorPos };
	}

	if (key.name === "left") {
		if (cursorPos === 0) return { text, cursorPos };
		return { text, cursorPos: cursorPos - 1 };
	}

	if (key.name === "right") {
		if (cursorPos >= text.length) return { text, cursorPos };
		return { text, cursorPos: cursorPos + 1 };
	}

	if (key.name === "home") {
		return { text, cursorPos: 0 };
	}

	if (key.name === "end") {
		return { text, cursorPos: text.length };
	}

	// Printable character — insert at cursor position
	if (key.char.length === 1 && !key.ctrl && !key.meta) {
		const before = text.slice(0, cursorPos);
		const after = text.slice(cursorPos);
		return { text: before + key.char + after, cursorPos: cursorPos + 1 };
	}

	// Not a text-editing key
	return null;
}
