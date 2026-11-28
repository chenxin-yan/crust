import {
	CrustError,
	type ExtensionFactory,
	type ExtensionId,
	defineExtension,
	defineExtensionId,
} from "@crustjs/core";

import { renderHelp } from "./help.ts";
import { withTypedColorFlag } from "./no-color.ts";

const DID_YOU_MEAN: ExtensionId = /* @__PURE__ */ defineExtensionId("crust:did-you-mean");

export interface DidYouMeanOptions {
	/**
	 * Presentation mode for command-not-found errors.
	 *
	 * `"error"` writes the message and visible commands to stderr. `"help"`
	 * writes the message and parent command help to stdout.
	 *
	 * @default "error"
	 */
	mode?: "error" | "help" | undefined;
}

/**
 * Presents an unknown command with the closest visible sibling, and adds the closest
 * long flag to an unknown-flag error's message. A name matches when it starts with the
 * typed word or is within two edits of it; an empty word matches nothing.
 */
export const didYouMean: ExtensionFactory<[options?: DidYouMeanOptions]> =
	/* @__PURE__ */ defineExtension(DID_YOU_MEAN).factory((extension, options = {}) => {
		const mode = options.mode ?? "error";

		return extension.onError(async (error, context) => {
			if (!(error instanceof CrustError)) return;
			if (error.is("COMMAND_NOT_FOUND")) {
				// The suggestion search and help renderer load only on this error path.
				const { reportUnknownCommand } = await import("./did-you-mean-report.ts");
				return reportUnknownCommand(error, context, mode, (...args) =>
					withTypedColorFlag(context, () => renderHelp(...args)),
				);
			}
			if (error.is("PARSE") && error.details?.reason === "unknown-flag") {
				const { suggestFlag } = await import("./did-you-mean-report.ts");
				suggestFlag(error, context.command);
			}
		});
	});
