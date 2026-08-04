// ────────────────────────────────────────────────────────────────────────────
// @crustjs/progress — Progress indicators for Crust
// ────────────────────────────────────────────────────────────────────────────

export type { CreateProgressOptions, ProgressHandle } from "./progress.ts";
export { createProgress } from "./progress.ts";
export type {
	CreateSpinnerOptions,
	SpinnerController,
	SpinnerHandle,
	SpinnerOptions,
	SpinnerOutcome,
	SpinnerSigintPolicy,
	SpinnerType,
} from "./spinner.ts";
export { createSpinner, spinner } from "./spinner.ts";
export { createTheme, defaultTheme, setTheme } from "./theme.ts";
export type { PartialProgressTheme, ProgressTheme } from "./types.ts";
