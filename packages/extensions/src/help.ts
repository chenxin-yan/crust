import {
	type CommandSnapshot,
	type ExtensionContext,
	type ExtensionFactory,
	type ExtensionId,
	type Handled,
	defineExtension,
	defineExtensionId,
} from "@crustjs/core";

const HELP: ExtensionId = /* @__PURE__ */ defineExtensionId("crust:help");

/**
 * Render help text for a Command Snapshot without running the app. The renderer
 * and `@crustjs/style` load on the first call, so CLIs that never print help
 * never pay for them at startup.
 */
export async function renderHelp(
	command: CommandSnapshot,
	path?: readonly string[],
): Promise<string> {
	const { renderHelpText } = await import("./help-render.ts");
	return renderHelpText(command, path, HELP);
}

const helpFlags = {
	help: { type: "boolean", short: "h", noNegate: true, description: "Show help" },
} as const;

async function showHelp(context: ExtensionContext): Promise<Handled> {
	context.stdout(await renderHelp(context.command, context.commandPath));
	return context.handled();
}

export const help: ExtensionFactory<[], {}, [], typeof helpFlags> = /* @__PURE__ */ defineExtension(
	HELP,
).factory((extension) =>
	extension
		.flags(helpFlags)
		.preRun((context) => (context.flags.help === true ? showHelp(context) : undefined))
		// A fallback, so other Extensions' flags (`--version`) still work on command groups.
		.noAction(showHelp),
);
