// ────────────────────────────────────────────────────────────────────────────
// Types — Shared type definitions for @crustjs/prompts
// ────────────────────────────────────────────────────────────────────────────

import type { StyleFn } from "@crustjs/style";

// ────────────────────────────────────────────────────────────────────────────
// Theme
// ────────────────────────────────────────────────────────────────────────────

/**
 * Style slots for all prompt elements.
 *
 * Each slot is a `StyleFn` — a `(text: string) => string` function that
 * applies ANSI styling. The theme controls the visual appearance of every
 * prompt component.
 *
 * @example
 * ```ts
 * const theme: PromptTheme = {
 *   prefix: cyan,
 *   message: bold,
 *   placeholder: dim,
 *   // ...
 * };
 * ```
 */
export interface PromptTheme {
	/** Prefix glyph before the prompt message (e.g., "?" or "◆") */
	readonly prefix: StyleFn;
	/** The prompt message text */
	readonly message: StyleFn;
	/** Placeholder text shown when input is empty */
	readonly placeholder: StyleFn;
	/** Cursor indicator in selection lists */
	readonly cursor: StyleFn;
	/** Selected / active item styling */
	readonly selected: StyleFn;
	/** Unselected / inactive item styling */
	readonly unselected: StyleFn;
	/** Validation error messages */
	readonly error: StyleFn;
	/** Success / confirmed value styling */
	readonly success: StyleFn;
	/** Hint text (e.g., keybinding hints, choice hints) */
	readonly hint: StyleFn;
	/** Spinner frame characters */
	readonly spinner: StyleFn;
	/** Matched characters in fuzzy filter results */
	readonly filterMatch: StyleFn;
}

/**
 * Recursive partial version of `PromptTheme` for user overrides.
 * Users only need to specify the slots they want to customize.
 */
export type PartialPromptTheme = {
	readonly [K in keyof PromptTheme]?: PromptTheme[K];
};

// ────────────────────────────────────────────────────────────────────────────
// Choices
// ────────────────────────────────────────────────────────────────────────────

/**
 * A choice item for select, multiselect, and filter prompts.
 *
 * Accepts either a plain string (where `label === value`) or an object
 * with explicit label, value, and optional hint.
 *
 * @example
 * ```ts
 * // String choices
 * const colors: Choice<string>[] = ["red", "green", "blue"];
 *
 * // Object choices with typed values
 * const ports: Choice<number>[] = [
 *   { label: "HTTP", value: 80 },
 *   { label: "HTTPS", value: 443, hint: "recommended" },
 * ];
 * ```
 */
export type Choice<T> =
	| string
	| { readonly label: string; readonly value: T; readonly hint?: string };

// ────────────────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────────────────

/**
 * Result of a validation function.
 * - `true` means valid
 * - A `string` is the error message to display
 */
export type ValidateResult = true | string;

/**
 * Validation function for prompt values.
 * May be synchronous or asynchronous.
 *
 * @example
 * ```ts
 * const validateEmail: ValidateFn<string> = (value) => {
 *   if (!value.includes("@")) return "Must be a valid email address";
 *   return true;
 * };
 * ```
 */
export type ValidateFn<T> = (
	value: T,
) => ValidateResult | Promise<ValidateResult>;
