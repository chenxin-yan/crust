import type { CommandNode, CrustPlugin, FlagDef } from "@crustjs/core";
import { getGlobalColorMode, setGlobalColorMode } from "@crustjs/style";

const colorFlagDef: FlagDef = {
	type: "boolean",
	default: true,
	inherit: true,
	description: "Enable colored output",
};

function injectColorFlag(
	command: CommandNode,
	addFlag: (command: CommandNode, name: string, def: FlagDef) => void,
): void {
	addFlag(command, "color", colorFlagDef);

	for (const subCommand of Object.values(command.subCommands)) {
		injectColorFlag(subCommand, addFlag);
	}
}

export function noColorPlugin(): CrustPlugin {
	return {
		name: "no-color",
		setup(context, actions) {
			injectColorFlag(context.rootCommand, actions.addFlag);
		},
		async middleware(context, next) {
			const flagValue = context.input?.flags.color;
			if (typeof flagValue !== "boolean") {
				await next();
				return;
			}

			const previousMode = getGlobalColorMode();
			setGlobalColorMode(flagValue ? "always" : "never");

			try {
				await next();
			} finally {
				setGlobalColorMode(previousMode);
			}
		},
	};
}
