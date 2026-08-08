export { completionExtension as completion } from "./completion/index.ts";
export type { CompletionOptions, CompletionShell } from "./completion/index.ts";
export { didYouMeanExtension as didYouMean } from "./did-you-mean.ts";
export type { DidYouMeanOptions } from "./did-you-mean.ts";
export { helpExtension as help, renderHelp } from "./help.ts";
export { noColorExtension as noColor } from "./no-color.ts";
export { updateNotifierExtension as updateNotifier } from "./update-notifier.ts";
export type {
	UpdateNotifierCacheAdapter,
	UpdateNotifierCacheConfig,
	UpdateNotifierInstallScope,
	UpdateNotifierPackageManager,
	UpdateNotifierOptions,
} from "./update-notifier.ts";
export { versionExtension as version } from "./version.ts";
export type { VersionOptions, VersionValue } from "./version.ts";
