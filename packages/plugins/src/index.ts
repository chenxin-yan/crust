export type { AutoCompletePluginOptions } from "./autocomplete.ts";
export { autoCompletePlugin } from "./autocomplete.ts";
export { helpPlugin, renderHelp } from "./help.ts";
export type {
	ManPageCommandSection,
	ManPageGeneratorOptions,
	ManPagePluginOptions,
	ManPageSectionBlock,
} from "./man.ts";
export { manPagePlugin, renderManPage } from "./man.ts";
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
