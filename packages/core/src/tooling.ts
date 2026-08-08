// ────────────────────────────────────────────────────────────────────────────
// @crustjs/core/tooling — shared tooling models and utilities
//
// Crust.snapshot() is the supported Command Snapshot preparation API. This
// subpath provides the snapshot type plus lockstep first-party tooling helpers.
// ────────────────────────────────────────────────────────────────────────────

export { VALIDATION_FORCE_EXIT_ENV, VALIDATION_MODE_ENV } from "./command/crust.ts";
export { buildCommandDocumentation } from "./command/documentation.ts";
export type {
	CommandDocumentation,
	DocumentationArg,
	DocumentationFlag,
	UsageSegment,
} from "./command/documentation.ts";
export { snapshotCommand } from "./command/snapshot.ts";
export type { CommandSnapshot } from "./command/snapshot.ts";
