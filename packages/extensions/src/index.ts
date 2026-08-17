export { completion } from "./completion/index.ts";
export type { CompletionOptions, CompletionShell } from "./completion/index.ts";
export { didYouMean } from "./did-you-mean.ts";
export type { DidYouMeanOptions } from "./did-you-mean.ts";
export { HELP, help, renderHelp } from "./help.ts";
export { noColor } from "./no-color.ts";
export { updateNotifier } from "./update-notifier.ts";
export type {
	UpdateNotifierCacheAdapter,
	UpdateNotifierCacheConfig,
	UpdateNotifierInstallScope,
	UpdateNotifierPackageManager,
	UpdateNotifierOptions,
} from "./update-notifier.ts";
export { version } from "./version.ts";
export type { VersionOptions, VersionValue } from "./version.ts";
