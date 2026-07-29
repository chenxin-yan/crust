import type { Extension } from "@crustjs/core";

import { type CompletionPluginOptions, completionExtension } from "./completion/index.ts";
import { type DidYouMeanPluginOptions, didYouMeanExtension } from "./did-you-mean.ts";
import { helpExtension } from "./help.ts";
import { noColorExtension } from "./no-color.ts";
import { type UpdateNotifierPluginOptions, updateNotifierExtension } from "./update-notifier.ts";
import { type VersionValue, versionExtension } from "./version.ts";

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
	return completionExtension(options);
}

export function didYouMean(options?: DidYouMeanPluginOptions): Extension {
	return didYouMeanExtension(options);
}

export function help(): Extension {
	return helpExtension();
}

export function noColor(): Extension {
	return noColorExtension();
}

export function updateNotifier(options: UpdateNotifierPluginOptions): Extension {
	return updateNotifierExtension(options);
}

export function version(value?: VersionValue): Extension {
	return versionExtension(value);
}
