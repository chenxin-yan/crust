import type { Extension } from "@crustjs/core";
import { extensionFromPlugin } from "@crustjs/core/internal";

import { type CompletionPluginOptions, completionPlugin } from "./completion/index.ts";
import { type DidYouMeanPluginOptions, didYouMeanPlugin } from "./did-you-mean.ts";
import { helpPlugin } from "./help.ts";
import { noColorPlugin } from "./no-color.ts";
import { type UpdateNotifierPluginOptions, updateNotifierPlugin } from "./update-notifier.ts";
import { type VersionValue, versionPlugin } from "./version.ts";

const fromPlugin = extensionFromPlugin as unknown as (
	plugin: Parameters<typeof extensionFromPlugin>[0],
) => Extension;

export type { CompletionPluginOptions, CompletionShell } from "./completion/index.ts";
export type { DidYouMeanPluginOptions } from "./did-you-mean.ts";
export { renderHelp } from "./help.ts";
export type {
	UpdateNotifierCacheAdapter,
	UpdateNotifierCacheConfig,
	UpdateNotifierInstallScope,
	UpdateNotifierPackageManager,
	UpdateNotifierPluginOptions,
} from "./update-notifier.ts";
export type { VersionValue } from "./version.ts";

export function completion(options?: CompletionPluginOptions): Extension {
	return fromPlugin(completionPlugin(options));
}

export function didYouMean(options?: DidYouMeanPluginOptions): Extension {
	return fromPlugin(didYouMeanPlugin(options));
}

export function help(): Extension {
	return fromPlugin(helpPlugin());
}

export function noColor(): Extension {
	return fromPlugin(noColorPlugin());
}

export function updateNotifier(options: UpdateNotifierPluginOptions): Extension {
	return fromPlugin(updateNotifierPlugin(options));
}

export function version(value?: VersionValue): Extension {
	return fromPlugin(versionPlugin(value));
}
