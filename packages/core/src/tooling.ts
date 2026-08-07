// ────────────────────────────────────────────────────────────────────────────
// @crustjs/core/tooling — explicitly unsupported tooling bridge
//
// Limited to serializable Command Snapshot preparation and the
// build-validation protocol. No stability guarantees: first-party tooling
// (man pages, skills, crust build) moves in lockstep with core.
// ────────────────────────────────────────────────────────────────────────────

export {
	prepareCommandSnapshot,
	VALIDATION_FORCE_EXIT_ENV,
	VALIDATION_MODE_ENV,
} from "./command/crust.ts";
export { buildCommandDocumentation } from "./command/documentation.ts";
export type {
	CommandDocumentation,
	DocumentationArg,
	DocumentationFlag,
	UsageSegment,
} from "./command/documentation.ts";
export { snapshotCommand } from "./command/snapshot.ts";
