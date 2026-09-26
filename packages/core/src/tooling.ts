// ────────────────────────────────────────────────────────────────────────────
// @crustjs/core/tooling — shared tooling models and utilities
//
// Crust.snapshot() is the supported in-process Command Snapshot API. The
// package root is for invocation-time authoring; this subpath owns build- and
// render-time helpers, the lockstep first-party subprocess protocol, and the
// flag value pipeline for first-party packages that bind values without argv.
// ────────────────────────────────────────────────────────────────────────────

export { BUILD_OUT_DIR_ENV } from "@crustjs/utils/artifacts";
export { SNAPSHOT_PATH_ENV } from "./command/invocation.ts";
export {
	buildCommandDocumentation,
	formatDefault,
	formatDescription,
} from "./command/documentation.ts";
export type {
	CommandDocumentation,
	DocumentationArg,
	DocumentationFlag,
	UsageSegment,
} from "./command/documentation.ts";
export type { CommandSnapshot } from "./command/snapshot.ts";
export { parseFlagValues } from "./parsing/parser.ts";
export type { FlagEnvironment } from "./parsing/parser.ts";
export { isListed, sectionsFor, visibleSectionsFor } from "./sections.ts";
