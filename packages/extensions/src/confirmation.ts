import {
	type ContextInstance,
	type ExtensionFactory,
	type ExtensionId,
	defineContext,
	defineExtension,
	defineExtensionId,
} from "@crustjs/core";

const CONFIRMATION: ExtensionId = /* @__PURE__ */ defineExtensionId("crust:confirmation");

const yesFlags = {
	yes: {
		type: "boolean",
		short: "y",
		description: "Confirm without asking",
	},
} as const;

/** Asks the user to confirm `message`; resolves when confirmed, throws otherwise. */
type Confirm = (message: string) => Promise<void>;

/** Confirmation was needed without `--yes` where no confirmation prompt can be shown. */
export class ConfirmationRequiredError extends Error {
	override name = "ConfirmationRequiredError";

	constructor(message: string) {
		super(`Confirmation required: ${message} Pass --yes to confirm.`);
	}
}

const confirmContext = /* @__PURE__ */ defineContext("confirm")
	.flags(yesFlags)
	.setup(({ flags }): Confirm => async (message) => {
		if (flags.yes === true) return;
		const confirmed = await (await import("./confirmation-prompt.ts")).promptConfirmation(message);
		if (confirmed === undefined) throw new ConfirmationRequiredError(message);
		if (!confirmed) throw new Error(`Not confirmed: ${message} Nothing was changed.`);
	});

/**
 * Provides the `confirm` Context, which owns the `--yes` (`-y`) flag. Commands that
 * `.use(confirmation)` await `ctx.confirm` for the function, then await it with the
 * message before a destructive change.
 */
export const confirmation: ExtensionFactory<
	[],
	{},
	readonly [ContextInstance<"confirm", Confirm, typeof yesFlags, {}>]
> = /* @__PURE__ */ defineExtension(CONFIRMATION).factory((extension) =>
	extension.provide(confirmContext()),
);
