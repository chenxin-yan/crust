// ────────────────────────────────────────────────────────────────────────────
// Confirm — Yes/no boolean confirmation prompt for @crustjs/prompts
// ────────────────────────────────────────────────────────────────────────────

import type { KeypressEvent } from "./renderer.ts";
import { runPrompt } from "./renderer.ts";
import { resolveTheme } from "./theme.ts";
import type { PartialPromptTheme, PromptTheme } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

/**
 * Options for the {@link confirm} prompt.
 *
 * @example
 * ```ts
 * const shouldContinue = await confirm({
 *   message: "Do you want to continue?",
 * });
 * ```
 *
 * @example
 * ```ts
 * const agreed = await confirm({
 *   message: "Accept terms?",
 *   active: "Agree",
 *   inactive: "Decline",
 *   default: false,
 * });
 * ```
 */
export interface ConfirmOptions {
	/** The prompt message displayed to the user */
	readonly message: string;
	/** Default value when the user presses Enter without toggling (defaults to `true`) */
	readonly default?: boolean;
	/** Initial value — if provided, the prompt is skipped and this value is returned immediately */
	readonly initial?: boolean;
	/** Label for the affirmative option (defaults to `"Yes"`) */
	readonly active?: string;
	/** Label for the negative option (defaults to `"No"`) */
	readonly inactive?: string;
	/** Per-prompt theme overrides */
	readonly theme?: PartialPromptTheme;
}

// ────────────────────────────────────────────────────────────────────────────
// State
// ────────────────────────────────────────────────────────────────────────────

interface ConfirmState {
	readonly value: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// Keypress handler
// ────────────────────────────────────────────────────────────────────────────

function handleKey(
	key: KeypressEvent,
	state: ConfirmState,
): ConfirmState | { readonly submit: boolean } {
	// Enter — submit current value
	if (key.name === "return") {
		return { submit: state.value };
	}

	// Left/Right arrows toggle between yes/no
	if (key.name === "left" || key.name === "right") {
		return { value: !state.value };
	}

	// h/l (vim-style) toggle
	if (key.name === "h") {
		return { value: true };
	}
	if (key.name === "l") {
		return { value: false };
	}

	// Tab toggles
	if (key.name === "tab") {
		return { value: !state.value };
	}

	// y shortcut — set to true
	if (key.char === "y" || key.char === "Y") {
		return { value: true };
	}

	// n shortcut — set to false
	if (key.char === "n" || key.char === "N") {
		return { value: false };
	}

	return state;
}

// ────────────────────────────────────────────────────────────────────────────
// Render
// ────────────────────────────────────────────────────────────────────────────

const PREFIX_SYMBOL = "?";
const SEPARATOR = " / ";

function renderConfirm(
	state: ConfirmState,
	theme: PromptTheme,
	message: string,
	activeLabel: string,
	inactiveLabel: string,
): string {
	const prefix = theme.prefix(PREFIX_SYMBOL);
	const msg = theme.message(message);

	const activeDisplay = state.value
		? theme.selected(activeLabel)
		: theme.unselected(activeLabel);

	const inactiveDisplay = state.value
		? theme.unselected(inactiveLabel)
		: theme.selected(inactiveLabel);

	return `${prefix} ${msg}\n${activeDisplay}${SEPARATOR}${inactiveDisplay}`;
}

function renderSubmitted(
	state: ConfirmState,
	_value: boolean,
	theme: PromptTheme,
	message: string,
	activeLabel: string,
	inactiveLabel: string,
): string {
	const prefix = theme.prefix(PREFIX_SYMBOL);
	const msg = theme.message(message);
	const answer = state.value ? activeLabel : inactiveLabel;
	return `${prefix} ${msg} ${theme.success(answer)}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Display an interactive yes/no confirmation prompt.
 *
 * Shows two side-by-side options (default: "Yes" / "No") that the user
 * toggles with arrow keys, h/l, y/n, or Tab, then confirms with Enter.
 *
 * If `initial` is provided, the prompt is skipped and the value is returned
 * immediately — useful for prefilling from CLI flags.
 *
 * @param options - Confirm prompt configuration
 * @returns The user's boolean selection
 * @throws {NonInteractiveError} when stdin is not a TTY and no `initial` is provided
 *
 * @example
 * ```ts
 * const proceed = await confirm({
 *   message: "Do you want to continue?",
 * });
 * ```
 *
 * @example
 * ```ts
 * // Custom labels with default value
 * const accepted = await confirm({
 *   message: "Accept the license?",
 *   active: "Accept",
 *   inactive: "Decline",
 *   default: false,
 * });
 * ```
 *
 * @example
 * ```ts
 * // Skip prompt when flag is provided
 * const yes = await confirm({
 *   message: "Continue?",
 *   initial: flags.yes,
 * });
 * ```
 */
export async function confirm(options: ConfirmOptions): Promise<boolean> {
	// Short-circuit: return initial value immediately without rendering
	if (options.initial !== undefined) {
		return options.initial;
	}

	const theme = resolveTheme(undefined, options.theme);
	const activeLabel = options.active ?? "Yes";
	const inactiveLabel = options.inactive ?? "No";
	const defaultValue = options.default ?? true;

	const initialState: ConfirmState = {
		value: defaultValue,
	};

	return runPrompt<ConfirmState, boolean>({
		initialState,
		theme,
		render: (state, t) =>
			renderConfirm(state, t, options.message, activeLabel, inactiveLabel),
		handleKey,
		renderSubmitted: (state, value, t) =>
			renderSubmitted(
				state,
				value,
				t,
				options.message,
				activeLabel,
				inactiveLabel,
			),
	});
}
