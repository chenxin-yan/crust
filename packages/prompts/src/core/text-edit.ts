// ────────────────────────────────────────────────────────────────────────────
// Text Edit — Shared text-editing logic for @crustjs/prompts
// ────────────────────────────────────────────────────────────────────────────

import type { StandardSchema } from "@crustjs/utils/schema";

import type { KeypressEvent, SubmitResult } from "./renderer.ts";
import { submit } from "./renderer.ts";
import type { PromptTheme, ValidateFn } from "./types.ts";
import { validateSubmitValue } from "./validate.ts";

// ────────────────────────────────────────────────────────────────────────────
// Rendering
// ────────────────────────────────────────────────────────────────────────────

/** Thin vertical bar used as cursor indicator in text inputs */
export const CURSOR_CHAR = "\u2502"; // │

/** Render `text` with a cursor at `cursorPos`, or the placeholder when `text` is empty. */
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

/** The updated text and cursor position returned by `handleTextEdit`. */
export interface TextEditState {
	readonly text: string;
	readonly cursorPos: number;
}

export interface TextSubmitState {
	readonly value: string;
	readonly cursorPos: number;
	readonly error: string | null;
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

/** UTF-16 length of the code point starting at `pos` (2 for a surrogate pair). */
function codePointLengthAt(text: string, pos: number): number {
	return (text.codePointAt(pos) ?? 0) > 0xffff ? 2 : 1;
}

/** UTF-16 length of the code point ending at `pos` (2 for a surrogate pair). */
function codePointLengthBefore(text: string, pos: number): number {
	return pos >= 2 && (text.codePointAt(pos - 2) ?? 0) > 0xffff ? 2 : 1;
}

/** True when `char` is exactly one complete code point (no lone surrogate). */
function isSingleCodePoint(char: string): boolean {
	const cp = char.codePointAt(0);
	return cp !== undefined && char.length === (cp > 0xffff ? 2 : 1) && (cp < 0xd800 || cp > 0xdfff);
}

/**
 * Handle common text-editing keypresses: backspace, delete, left, right,
 * home, end, and printable character insertion.
 *
 * Edits step over whole Unicode code points, so surrogate pairs are never
 * split; `cursorPos` remains a UTF-16 offset into `text`.
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
		const start = cursorPos - codePointLengthBefore(text, cursorPos);
		return { text: text.slice(0, start) + text.slice(cursorPos), cursorPos: start };
	}

	if (key.name === "delete") {
		if (cursorPos >= text.length) return { text, cursorPos };
		const end = cursorPos + codePointLengthAt(text, cursorPos);
		return { text: text.slice(0, cursorPos) + text.slice(end), cursorPos };
	}

	if (key.name === "left") {
		if (cursorPos === 0) return { text, cursorPos };
		return { text, cursorPos: cursorPos - codePointLengthBefore(text, cursorPos) };
	}

	if (key.name === "right") {
		if (cursorPos >= text.length) return { text, cursorPos };
		return { text, cursorPos: cursorPos + codePointLengthAt(text, cursorPos) };
	}

	if (key.name === "home") {
		return { text, cursorPos: 0 };
	}

	if (key.name === "end") {
		return { text, cursorPos: text.length };
	}

	// Printable character — insert at cursor position
	if (isSingleCodePoint(key.char) && !key.ctrl && !key.meta) {
		const before = text.slice(0, cursorPos);
		const after = text.slice(cursorPos);
		return { text: before + key.char + after, cursorPos: cursorPos + key.char.length };
	}

	// Not a text-editing key
	return null;
}

export function createTextSubmitHandler<Output>(
	schema: StandardSchema<unknown, Output> | undefined,
	validate: ValidateFn<string> | undefined,
	defaultValue?: string,
): (
	key: KeypressEvent,
	state: TextSubmitState,
) => Promise<TextSubmitState | SubmitResult<Output | string>> {
	return async (key, state) => {
		if (key.name === "return") {
			const submitValue =
				state.value === "" && defaultValue !== undefined ? defaultValue : state.value;
			const result = await validateSubmitValue(submitValue, schema, validate);
			return result.ok ? submit(result.value) : { ...state, error: result.error };
		}

		const edit = handleTextEdit(key, state.value, state.cursorPos);
		return edit ? { value: edit.text, cursorPos: edit.cursorPos, error: null } : state;
	};
}
