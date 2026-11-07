import {
	type ExtensionFactory,
	type ExtensionId,
	defineExtension,
	defineExtensionId,
} from "@crustjs/core";

const CONFIRMATION: ExtensionId = /* @__PURE__ */ defineExtensionId("crust:confirmation");

const yesFlags = {
	yes: {
		type: "boolean",
		noNegate: true,
		description: "Run without asking for confirmation",
	},
} as const;

/** A command needed confirmation without `--yes` where no confirmation prompt can be shown. */
export class ConfirmationRequiredError extends Error {
	override name = "ConfirmationRequiredError";

	constructor(command: string) {
		super(`"${command}" needs confirmation; pass --yes to run it.`);
	}
}

/** Adds a recursive `--yes` flag. */
export const confirmation: ExtensionFactory<[], {}, [], typeof yesFlags> =
	/* @__PURE__ */ defineExtension(CONFIRMATION).factory((extension) => extension.flags(yesFlags));
