import {
	type DidYouMeanPluginOptions,
	didYouMeanPlugin,
} from "./did-you-mean.ts";

export type { DidYouMeanPluginOptions } from "./did-you-mean.ts";
export { didYouMeanPlugin } from "./did-you-mean.ts";

/**
 * @deprecated Use `didYouMeanPlugin` instead. Will be removed in 1.0.0.
 */
export const autoCompletePlugin: typeof didYouMeanPlugin = didYouMeanPlugin;

/**
 * @deprecated Use `DidYouMeanPluginOptions` instead. Will be removed in 1.0.0.
 */
export type AutoCompletePluginOptions = DidYouMeanPluginOptions;

export { helpPlugin, renderHelp } from "./help.ts";
export { noColorPlugin } from "./no-color.ts";
export type {
	UpdateNotifierCacheAdapter,
	UpdateNotifierCacheConfig,
	UpdateNotifierInstallScope,
	UpdateNotifierPackageManager,
	UpdateNotifierPluginOptions,
} from "./update-notifier.ts";
export { updateNotifierPlugin } from "./update-notifier.ts";
export type { VersionValue } from "./version.ts";
export { versionPlugin } from "./version.ts";
