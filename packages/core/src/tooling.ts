// ────────────────────────────────────────────────────────────────────────────
// @crustjs/core/tooling — shared tooling models and utilities
//
// Crust.snapshot() is the supported in-process Command Snapshot API. The
// package root is for invocation-time authoring; this subpath owns build- and
// render-time helpers, the lockstep first-party subprocess protocol, the
// flag value pipeline for first-party packages that bind values without argv,
// and the mapping between a command and its flat JSON input.
// ────────────────────────────────────────────────────────────────────────────

export { BUILD_OUT_DIR_ENV } from "@crustjs/utils/artifacts";
export { SNAPSHOT_PATH_ENV } from "./command/invocation.ts";
export {
	commandInputFields,
	commandInputSchema,
	parseCommandInput,
	RAW_INPUT_PROPERTY,
} from "./command/command-input.ts";
export type {
	CommandInputFields,
	CommandInputPropertySchema,
	CommandInputSchema,
} from "./command/command-input.ts";
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
export { INSTALLED_COMMAND_NAME_RULE, isInstalledCommandName } from "./installed-command-name.ts";
export { parseFlagValues } from "./parsing/parser.ts";
export type { FlagEnvironment } from "./parsing/parser.ts";
export { isListed, sectionsFor, visibleSectionsFor } from "./sections.ts";
export type { RunInputPayload, RunInputValue } from "./types.ts";
export type { LocalValueBrand } from "./validation/shared.ts";
