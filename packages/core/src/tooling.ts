// ────────────────────────────────────────────────────────────────────────────
// @crustjs/core/tooling — shared tooling models and utilities
//
// Crust.snapshot() is the supported in-process Command Snapshot API. The
// package root is for invocation-time authoring; this subpath owns build- and
// render-time helpers, the parse-only binding boundary used by test tooling,
// and the lockstep first-party subprocess protocol.
// ────────────────────────────────────────────────────────────────────────────

export { BUILD_OUT_DIR_ENV } from "@crustjs/utils/artifacts";
export { bindInput, customBindings } from "./command/crust.ts";
export type { BindInput } from "./command/crust.ts";
export { SNAPSHOT_PATH_ENV } from "./command/invocation.ts";
export type { BoundInput, CustomBindings } from "./command/invocation.ts";
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
export { isListed, sectionsFor, visibleSectionsFor } from "./sections.ts";
