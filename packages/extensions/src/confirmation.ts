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
		description: "Run a destructive command without asking for confirmation",
	},
} as const;

/** A destructive command ran without `--yes` where no confirmation prompt can be shown. */
export class ConfirmationRequiredError extends Error {
	override name = "ConfirmationRequiredError";

	constructor(command: string) {
		super(`"${command}" is destructive and needs confirmation; pass --yes to run it.`);
	}
}

/**
 * Adds a recursive `--yes` flag. Before a command marked `destructive` runs,
 * it asks for confirmation when stdin and stderr are TTYs (defaulting to no)
 * and fails when the user declines; without a TTY it throws
 * {@link ConfirmationRequiredError}. `--yes` skips both.
 */
export const confirmation: ExtensionFactory<[], {}, [], typeof yesFlags> =
	/* @__PURE__ */ defineExtension(CONFIRMATION).factory((extension) =>
		extension.flags(yesFlags).preRun(async (context) => {
			if (context.command.meta.destructive !== true || context.flags.yes === true) return;
			const command = context.commandPath.join(" ");
			const [{ confirm, isTTY }, { getTerminalIO }] = await Promise.all([
				import("@crustjs/prompts"),
				import("@crustjs/utils/terminal"),
			]);
			// Same stream resolution as prompts' short-circuit: a `default` answers without asking unless both are TTYs.
			if (!(isTTY() && isTTY(getTerminalIO()?.output ?? process.stderr))) {
				throw new ConfirmationRequiredError(command);
			}
			if (!(await confirm({ message: `Run destructive command "${command}"?`, default: false }))) {
				throw new Error(`"${command}" was not confirmed; nothing was changed.`);
			}
		}),
	);
