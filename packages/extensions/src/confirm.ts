import {
	type ContextInstance,
	type ExtensionFactory,
	type ExtensionId,
	defineContext,
	defineExtension,
	defineExtensionId,
} from "@crustjs/core";

const CONFIRM: ExtensionId = /* @__PURE__ */ defineExtensionId("crust:confirm");

const yesFlags = {
	yes: {
		type: "boolean",
		noNegate: true,
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
		const { promptConfirmation } = await import("./confirm-prompt.ts");
		const confirmed = await promptConfirmation(message);
		if (confirmed === undefined) throw new ConfirmationRequiredError(message);
		if (!confirmed) throw new Error(`Not confirmed: ${message} Nothing was changed.`);
	});

/**
 * Provides the `confirm` Context, which owns the `--yes` flag. Commands that
 * `.use(confirm)` await `ctx.confirm` for the function, then await it with the
 * message before a destructive change.
 */
export const confirm: ExtensionFactory<
	[],
	{},
	readonly [ContextInstance<"confirm", Confirm, typeof yesFlags, {}>]
> = /* @__PURE__ */ defineExtension(CONFIRM).factory((extension) =>
	extension.provide(confirmContext()),
);
