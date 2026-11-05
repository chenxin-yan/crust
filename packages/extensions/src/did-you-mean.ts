import {
	CrustError,
	type ExtensionFactory,
	type ExtensionId,
	defineExtension,
	defineExtensionId,
} from "@crustjs/core";

import { renderHelp } from "./help.ts";

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
	mode?: "error" | "help";
}

export const didYouMean: ExtensionFactory<[options?: DidYouMeanOptions]> =
	/* @__PURE__ */ defineExtension(DID_YOU_MEAN).factory((extension, options = {}) => {
		const mode = options.mode ?? "error";

		return extension.onError(async (error, context) => {
			if (!(error instanceof CrustError) || !error.is("COMMAND_NOT_FOUND")) return;
			// The suggestion search and help renderer load only on this error path.
			const { reportUnknownCommand } = await import("./did-you-mean-report.ts");
			return reportUnknownCommand(error, context, mode, renderHelp);
		});
	});
