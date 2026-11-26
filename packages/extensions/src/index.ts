export {
	completion,
	renderBashCompletion,
	renderFishCompletion,
	renderZshCompletion,
} from "./completion/index.ts";
export type {
	CompletionExtension,
	CompletionOptions,
	CompletionRenderOptions,
	CompletionShell,
} from "./completion/index.ts";
export { ConfirmationRequiredError, confirmation } from "./confirmation.ts";
export { didYouMean } from "./did-you-mean.ts";
export type { DidYouMeanOptions } from "./did-you-mean.ts";
export { help, renderHelp } from "./help.ts";
export type { RenderHelpOptions } from "./help.ts";
export { json } from "./json.ts";
export { jsonInput } from "./json-input.ts";
export { nextSteps } from "./next-steps.ts";
export type { NextStep, NextSteps, NextStepsOptions } from "./next-steps.ts";
export { noColor } from "./no-color.ts";
export { renderCommandIndex, schema } from "./schema.ts";
export type { CommandSchema, SchemaExtension, SchemaOptions } from "./schema.ts";
export { search } from "./search.ts";
export type { SearchExtension, SearchMatch, SearchOptions } from "./search.ts";
export { telemetry } from "./telemetry.ts";
export type { TelemetryEvent, TelemetryOptions } from "./telemetry.ts";
export { updateNotifier } from "./update-notifier.ts";
export type {
	UpdateCommandResolver,
	UpdateNotifierCacheAdapter,
	UpdateNotifierCacheConfig,
	UpdateNotifierExtension,
	UpdateNotifierPackageManager,
	UpdateNotifierOptions,
	UpdateNotifierState,
} from "./update-notifier.ts";
export { version } from "./version.ts";
export type { VersionExtension, VersionOptions, VersionValue } from "./version.ts";
