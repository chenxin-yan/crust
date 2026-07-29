import type { Extension } from "@crustjs/core";

import { type CompletionOptions, completionExtension } from "./completion/index.ts";
import { type DidYouMeanOptions, didYouMeanExtension } from "./did-you-mean.ts";
import { helpExtension } from "./help.ts";
import { noColorExtension } from "./no-color.ts";
import { type UpdateNotifierOptions, updateNotifierExtension } from "./update-notifier.ts";
import { type VersionValue, versionExtension } from "./version.ts";

export type { CompletionOptions, CompletionShell } from "./completion/index.ts";
export type { DidYouMeanOptions } from "./did-you-mean.ts";
export { renderHelp } from "./help.ts";
export type {
	UpdateNotifierCacheAdapter,
	UpdateNotifierCacheConfig,
	UpdateNotifierInstallScope,
	UpdateNotifierPackageManager,
	UpdateNotifierOptions,
} from "./update-notifier.ts";
export type { VersionValue } from "./version.ts";

export function completion(options?: CompletionOptions): Extension {
	return completionExtension(options);
}

export function didYouMean(options?: DidYouMeanOptions): Extension {
	return didYouMeanExtension(options);
}

export function help(): Extension {
	return helpExtension();
}

export function noColor(): Extension {
	return noColorExtension();
}

export function updateNotifier(options: UpdateNotifierOptions): Extension {
	return updateNotifierExtension(options);
}

export function version(value?: VersionValue): Extension {
	return versionExtension(value);
}
