export type { AutoCompletePluginOptions } from "./autocomplete.ts";
export { autoCompletePlugin } from "./autocomplete.ts";
export type {
	CompletionContext,
	CompletionItem,
	CompletionPluginOptions,
	CompletionPosition,
	CompletionProvider,
	CompletionShell,
} from "./completion.ts";
export { completeArg, completeFlag, completionPlugin } from "./completion.ts";
export { helpPlugin, renderHelp } from "./help.ts";
export type {
	UpdateNotifierCacheAdapter,
	UpdateNotifierCacheConfig,
	UpdateNotifierPluginOptions,
} from "./update-notifier.ts";
export { updateNotifierPlugin } from "./update-notifier.ts";
export type { VersionValue } from "./version.ts";
export { versionPlugin } from "./version.ts";
