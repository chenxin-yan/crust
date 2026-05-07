// ────────────────────────────────────────────────────────────────────────────
// Types — Shared type definitions for @crustjs/prompts
// ────────────────────────────────────────────────────────────────────────────

import type { StyleFn } from "@crustjs/style";
import type { StandardSchemaV1 } from "@standard-schema/spec";

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

/**
 * Polymorphic validate slot for text-input prompts.
 *
 * Accepts either:
 * - a {@link ValidateFn} (returns `true` for valid or a string error), or
 * - a {@link StandardSchemaV1} schema (e.g. Zod, Valibot, Effect Schema)
 *   that parses the raw `string` input into a transformed `Output`.
 *
 * When a schema is supplied, the prompt resolves to the schema's transformed
 * output type instead of the raw `string`.
 *
 * @internal Surfaced via the `validate` slot on `InputOptions` /
 * `PasswordOptions`; not re-exported from the package root because callers
 * can derive it from those option types when needed.
 */
export type PromptValidate<Output> =
	| ValidateFn<string>
	| StandardSchemaV1<unknown, Output>;

/**
 * Type guard: discriminate the polymorphic `validate` slot.
 *
 * Accepts both plain object schemas and callable schema instances (the
 * Standard Schema spec only requires the `~standard` property; some vendors
 * expose schemas as callable function-objects). Also asserts that
 * `~standard.validate` is itself a function so a malformed value cannot slip
 * through and crash later inside the prompt.
 *
 * @internal Used only by `input()` and `password()` to dispatch between the
 * function-validator and Standard Schema branches.
 */
export function isStandardSchema<Output>(
	value: PromptValidate<Output> | undefined,
): value is StandardSchemaV1<unknown, Output> {
	if (value === undefined || value === null) return false;
	const t = typeof value;
	if (t !== "object" && t !== "function") return false;
	const std = (
		value as {
			"~standard"?: { version?: unknown; validate?: unknown };
		}
	)["~standard"];
	return (
		!!std &&
		typeof std === "object" &&
		std.version === 1 &&
		typeof std.validate === "function"
	);
}
