import {
	type CommandSnapshot,
	type ExtensionFactory,
	type ExtensionId,
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

const helpFlags = [
	{ name: "help", type: "boolean", short: "h", noNegate: true, description: "Show help" },
] as const;

export const help: ExtensionFactory<[], {}, [], typeof helpFlags> = /* @__PURE__ */ defineExtension(
	HELP,
).factory((extension) =>
	extension.flags(...helpFlags).preRun(async (context) => {
		if (context.flags.help !== true && context.command.hasAction) return;
		context.stdout(await renderHelp(context.command, context.commandPath));
		return context.handled();
	}),
);
