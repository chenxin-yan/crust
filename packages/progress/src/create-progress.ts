// ────────────────────────────────────────────────────────────────────────────
// createProgress — themed indicator instance factory for @crustjs/progress
// ────────────────────────────────────────────────────────────────────────────

import { type ProgressHandle, type ProgressOptions, progress } from "./progress.ts";
import { type SpinnerHandleOptions, spinner } from "./spinner.ts";
import { defaultTheme } from "./theme.ts";
import type { PartialProgressTheme, ProgressTheme } from "./types.ts";

/** Configuration for {@link createProgress}. */
export interface CreateProgressOptions {
	/**
	 * Partial theme applied to every indicator from this instance.
	 * Per-call `theme` options layer on top; unspecified slots
	 * fall back to `defaultTheme`.
	 */
	readonly theme?: PartialProgressTheme;
}

/**
 * Progress indicators bound to a theme. Same signatures as the bare
 * `progress`/`spinner` exports; the only difference is the theme
 * resolution order: `defaultTheme` ← instance theme ← per-call `theme`.
 */
export interface ProgressInstance {
	/** The fully resolved instance theme. */
	readonly theme: ProgressTheme;
	readonly progress: typeof progress;
	readonly spinner: typeof spinner;
}

/**
 * Create a {@link ProgressInstance} with a theme applied to every
 * indicator. There is no global theme state: theming is explicit,
 * owned by whoever holds the instance.
 *
 * @example
 * ```ts
 * import { createProgress } from "@crustjs/progress";
 * import { cyan, green } from "@crustjs/style";
 *
 * const p = createProgress({ theme: { spinner: cyan, success: green } });
 * await p.spinner({ message: "Working...", task: async () => doWork() });
 * ```
 */
export function createProgress(options: CreateProgressOptions = {}): ProgressInstance {
	// Snapshot so later mutation of the caller's object can't diverge
	// rendering from the exposed `theme`.
	const overrides = { ...options.theme };
	const themed = <O extends { readonly theme?: PartialProgressTheme }>(opts: O): O => ({
		...opts,
		theme: { ...overrides, ...opts.theme },
	});
	return {
		theme: { ...defaultTheme, ...overrides },
		progress: (opts: ProgressOptions): ProgressHandle => progress(themed(opts)),
		// Double cast: the wrapper can't express spinner's task/handle overloads.
		spinner: ((opts: SpinnerHandleOptions) =>
			spinner(themed(opts) as never)) as unknown as typeof spinner,
	};
}
