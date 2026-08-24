// ────────────────────────────────────────────────────────────────────────────
// @crustjs/core/tooling — shared tooling models and utilities
//
// Crust.snapshot() is the supported in-process Command Snapshot API. The
// package root is for invocation-time authoring; this subpath owns build- and
// render-time helpers plus the lockstep first-party subprocess protocol.
// ────────────────────────────────────────────────────────────────────────────

export { BUILD_OUT_DIR_ENV, SNAPSHOT_PATH_ENV } from "./command/crust.ts";
export { buildCommandDocumentation, formatDescription } from "./command/documentation.ts";
export type {
	CommandDocumentation,
	DocumentationArg,
	DocumentationFlag,
	UsageSegment,
} from "./command/documentation.ts";
export { snapshotCommand } from "./command/snapshot.ts";
export type { CommandSnapshot } from "./command/snapshot.ts";
export { isListed, sectionsFor, visibleSectionsFor } from "./sections.ts";
