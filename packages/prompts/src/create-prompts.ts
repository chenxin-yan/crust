// ────────────────────────────────────────────────────────────────────────────
// createPrompts — themed prompt instance factory for @crustjs/prompts
// ────────────────────────────────────────────────────────────────────────────

import type { PromptIO } from "./core/renderer.ts";
import { defaultTheme } from "./core/theme.ts";
import type { PartialPromptTheme, PromptTheme } from "./core/types.ts";
import { type ConfirmOptions, confirm } from "./prompts/confirm.ts";
import { type FilterOptions, filter } from "./prompts/filter.ts";
import { type InputOptions, input } from "./prompts/input.ts";
import { type MultifilterOptions, multifilter } from "./prompts/multifilter.ts";
import { type MultiselectOptions, multiselect } from "./prompts/multiselect.ts";
import { type PasswordOptions, password } from "./prompts/password.ts";
import { type SelectOptions, select } from "./prompts/select.ts";

/** Configuration for {@link createPrompts}. */
export interface CreatePromptsOptions {
	/**
	 * Partial theme applied to every prompt from this instance.
	 * Per-call `theme` options layer on top; unspecified slots
	 * fall back to `defaultTheme`.
	 */
	readonly theme?: PartialPromptTheme;
}

/**
 * A set of prompt functions bound to a theme.
 *
 * Same signatures as the bare exports (`input`, `select`, …); the only
 * difference is the theme resolution order: `defaultTheme` ← instance
 * theme ← per-call `theme` option.
 */
export interface PromptsInstance {
	/**
	 * The fully resolved instance theme. Pass to custom `runPrompt`
	 * renderers to match this instance's styling.
	 */
	readonly theme: PromptTheme;
	readonly input: typeof input;
	readonly password: typeof password;
	readonly confirm: typeof confirm;
	readonly select: typeof select;
	readonly multiselect: typeof multiselect;
	readonly filter: typeof filter;
	readonly multifilter: typeof multifilter;
}

/**
 * Create a {@link PromptsInstance} with a theme applied to every prompt.
 *
 * There is no global theme state: theming is explicit, owned by whoever
 * holds the instance.
 *
 * @example
 * ```ts
 * import { createPrompts } from "@crustjs/prompts";
 * import { magenta, cyan } from "@crustjs/style";
 *
 * const p = createPrompts({ theme: { prefix: magenta, success: cyan } });
 * const name = await p.input({ message: "Name?" });
 * ```
 */
export function createPrompts(options: CreatePromptsOptions = {}): PromptsInstance {
	// Snapshot so later mutation of the caller's object can't diverge
	// rendering from the exposed `theme`.
	const overrides = { ...options.theme };
	// Layer instance overrides under per-call overrides; each prompt merges
	// the combined partial onto defaultTheme itself.
	const themed = <O extends { readonly theme?: PartialPromptTheme }>(opts: O): O => ({
		...opts,
		theme: { ...overrides, ...opts.theme },
	});
	return {
		theme: { ...defaultTheme, ...overrides },
		input: ((opts?: InputOptions<unknown>, io?: PromptIO) =>
			input(themed(opts ?? {}) as never, io)) as typeof input,
		password: ((opts?: PasswordOptions<unknown>, io?: PromptIO) =>
			password(themed(opts ?? {}) as never, io)) as typeof password,
		confirm: (opts: ConfirmOptions, io?: PromptIO) => confirm(themed(opts), io),
		select: <T>(opts: SelectOptions<T>, io?: PromptIO) => select(themed(opts), io),
		multiselect: <T>(opts: MultiselectOptions<T>, io?: PromptIO) => multiselect(themed(opts), io),
		filter: <T>(opts: FilterOptions<T>, io?: PromptIO) => filter(themed(opts), io),
		multifilter: <T>(opts: MultifilterOptions<T>, io?: PromptIO) => multifilter(themed(opts), io),
	};
}
