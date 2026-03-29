// ────────────────────────────────────────────────────────────────────────────
// Types — Shared type definitions for @crustjs/progress
// ────────────────────────────────────────────────────────────────────────────

import type { StyleFn } from "@crustjs/style";

export interface ProgressTheme {
	/** Spinner frame characters while the task is running. */
	readonly spinner: StyleFn;
	/** The status message displayed beside the spinner or final symbol. */
	readonly message: StyleFn;
	/** Final success symbol styling. */
	readonly success: StyleFn;
	/** Final error symbol styling. */
	readonly error: StyleFn;
}

/** Partial version of `ProgressTheme` for user overrides. */
export type PartialProgressTheme = Partial<ProgressTheme>;
