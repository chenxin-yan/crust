// ────────────────────────────────────────────────────────────────────────────
// @crustjs/core/tooling — shared tooling models and utilities
//
// Crust.snapshot() is the supported in-process Command Snapshot API. This
// subpath provides its models plus the lockstep first-party subprocess protocol.
// ────────────────────────────────────────────────────────────────────────────

export { SNAPSHOT_PATH_ENV } from "./command/crust.ts";
export { buildCommandDocumentation, formatDescription } from "./command/documentation.ts";
export type {
	CommandDocumentation,
	DocumentationArg,
	DocumentationFlag,
	UsageSegment,
} from "./command/documentation.ts";
export { snapshotCommand } from "./command/snapshot.ts";
export type { CommandSnapshot, ExtensionSnapshot } from "./command/snapshot.ts";
