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
export { didYouMean } from "./did-you-mean.ts";
export type { DidYouMeanOptions } from "./did-you-mean.ts";
export { help, renderHelp } from "./help.ts";
export { input } from "./input.ts";
export { json } from "./json.ts";
export { noColor } from "./no-color.ts";
export { schema } from "./schema.ts";
export type { CommandSchema } from "./schema.ts";
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
