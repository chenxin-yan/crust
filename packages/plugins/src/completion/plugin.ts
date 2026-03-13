import { type CommandNode, Crust, type CrustPlugin } from "@crustjs/core";
import { renderHelp } from "../help.ts";
import { generateCompletionCandidates } from "./analyze.ts";
import { renderCompletionScript } from "./renderers.ts";
import type { CompletionPluginOptions, CompletionShell } from "./types.ts";

const INTERNAL_COMPLETE_COMMAND = "__complete";
const DEFAULT_COMMAND_NAME = "completion";

function createShellScriptCommand(params: {
	rootCommand: CommandNode;
	commandName: string;
	binName: string;
	shell: CompletionShell;
}): Crust {
	return new Crust(params.shell)
		.meta({
			description: `Print ${params.shell} completion script`,
		})
		.run(() => {
			console.log(
				renderCompletionScript({
					binName: params.binName,
					commandName: params.commandName,
					shell: params.shell,
				}),
			);
		});
}

function createInternalCommand(params: {
	rootCommand: CommandNode;
	commandName: string;
}): Crust {
	return new Crust(INTERNAL_COMPLETE_COMMAND)
		.meta({
			description: "Internal completion backend",
			hidden: true,
		})
		.args([
			{
				name: "shell",
				type: "string",
				required: true,
			},
		] as const)
		.flags({
			index: {
				type: "number",
				required: true,
			},
			current: {
				type: "string",
				required: true,
			},
		})
		.run(async (ctx) => {
			const shell = ctx.args.shell as CompletionShell;
			if (shell !== "bash" && shell !== "fish" && shell !== "zsh") {
				return;
			}

			const lines = await generateCompletionCandidates({
				rootCommand: params.rootCommand,
				shell,
				tokensBeforeCurrent: ctx.rawArgs,
				currentToken: ctx.flags.current,
			});

			if (lines.length > 0) {
				console.log(lines.join("\n"));
			}
		});
}

function createCompletionCommand(params: {
	rootCommand: CommandNode;
	commandName: string;
	binName: string;
}): Crust {
	const command = new Crust(params.commandName)
		.meta({
			description: "Generate shell completion scripts",
		})
		.run(() => {
			const completionCommand =
				params.rootCommand.subCommands[params.commandName];
			if (!completionCommand) return;
			console.log(
				renderHelp(completionCommand, [
					params.rootCommand.meta.name,
					params.commandName,
				]),
			);
		})
		.command(
			createShellScriptCommand({
				...params,
				shell: "bash",
			}),
		)
		.command(
			createShellScriptCommand({
				...params,
				shell: "zsh",
			}),
		)
		.command(
			createShellScriptCommand({
				...params,
				shell: "fish",
			}),
		)
		.command(
			createInternalCommand({
				rootCommand: params.rootCommand,
				commandName: params.commandName,
			}),
		);

	return command;
}

export function completionPlugin(
	options: CompletionPluginOptions = {},
): CrustPlugin {
	const commandName = options.command ?? DEFAULT_COMMAND_NAME;

	return {
		name: "completion",
		setup(context, actions) {
			const binName = options.binName ?? context.rootCommand.meta.name;
			actions.addSubCommand(
				context.rootCommand,
				commandName,
				createCompletionCommand({
					rootCommand: context.rootCommand,
					commandName,
					binName,
				})._node,
			);
		},
	};
}
