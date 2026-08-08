// ────────────────────────────────────────────────────────────────────────────
// Types — Shared type definitions for @crustjs/prompts
// ────────────────────────────────────────────────────────────────────────────

import type { StyleFn } from "@crustjs/style";
import type { StandardSchema } from "@crustjs/utils/schema";

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
	/** Matched characters in fuzzy filter results */
	readonly filterMatch: StyleFn;
}

/**
 * Partial version of `PromptTheme` for user overrides.
 * Users only need to specify the slots they want to customize.
 */
export type PartialPromptTheme = Partial<PromptTheme>;

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
 * Validation function for prompt values.
 *
 * Throw an `Error` to reject the input — the error's `message` is rendered
 * inline below the prompt. Return `void` (or `Promise<void>`) when the value
 * is valid. May be synchronous or asynchronous.
 *
 * This matches the throw-on-fail contract used by `@crustjs/store`'s
 * hand-written `FieldDef.validate` callbacks.
 *
 * @example
 * ```ts
 * const validateEmail: ValidateFn<string> = (value) => {
 *   if (!value.includes("@")) {
 *     throw new Error("Must be a valid email address");
 *   }
 * };
 * ```
 */
export type ValidateFn<T> = (value: T) => void | Promise<void>;

/** @internal Parse an initial/default value through a Standard Schema. */
export async function parseShortCircuit<Output>(
	schema: StandardSchema<unknown, Output>,
	value: string,
	source: "initial" | "default",
): Promise<Output> {
	const result = await schema["~standard"].validate(value);
	if (result.issues?.length) {
		const message = result.issues[0]?.message || "Validation failed";
		throw new Error(`${source} value rejected by schema: ${message}`);
	}
	return (result as { value: Output }).value;
}
