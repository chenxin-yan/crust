import {
	type ContextFactory,
	type ContextInstance,
	type ExtensionFactory,
	type ExtensionId,
	defineContext,
	defineExtension,
	defineExtensionId,
} from "@crustjs/core";

const DRY_RUN: ExtensionId = /* @__PURE__ */ defineExtensionId("crust:dry-run");

const dryRunFlags = {
	"dry-run": {
		type: "boolean",
		noNegate: true,
		description: "Show what the command would do without changing anything",
	},
} as const;

/**
 * Whether `--dry-run` was passed. Provided by {@link dryRun}; a command opts in
 * to `--dry-run` by declaring it with its own `.use(dryRunContext)` and
 * branching on `await ctx.dryRun`.
 */
export const dryRunContext: ContextFactory<"dryRun", void, boolean, typeof dryRunFlags> =
	/* @__PURE__ */ defineContext("dryRun")
		.flags(dryRunFlags)
		.setup(({ flags }) => flags["dry-run"] === true);

/** `--dry-run` was passed to a command that does not `.use(dryRunContext)`. */
export class DryRunUnsupportedError extends Error {
	override name = "DryRunUnsupportedError";

	constructor(command: string) {
		super(`"${command}" does not support --dry-run.`);
	}
}

/**
 * Provides {@link dryRunContext}, which owns a recursive `--dry-run` flag.
 * Before a command runs with `--dry-run`, it throws
 * {@link DryRunUnsupportedError} unless the command declares the Context with
 * its own `.use()`, so a command that cannot dry-run never runs for real.
 */
export const dryRun: ExtensionFactory<
	[],
	{},
	readonly [ContextInstance<"dryRun", boolean, typeof dryRunFlags, {}>]
> = /* @__PURE__ */ defineExtension(DRY_RUN).factory((extension) =>
	extension.provide(dryRunContext()).preRun((context) => {
		if (
			context.flags["dry-run"] === true &&
			!context.command.uses.includes(dryRunContext.contextName)
		) {
			throw new DryRunUnsupportedError(context.commandPath.join(" "));
		}
	}),
);
