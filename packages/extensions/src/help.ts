import {
	type CommandDefinition,
	type CommandShape,
	type CommandSnapshot,
	CrustError,
	type Extension,
	type ExtensionContext,
	type ExtensionFactory,
	type ExtensionId,
	defineCommand,
	defineExtension,
	defineExtensionId,
} from "@crustjs/core";

import { withTypedColorFlag } from "./no-color.ts";
import { textOutput } from "./text-output.ts";

const HELP: ExtensionId = /* @__PURE__ */ defineExtensionId("crust:help");

/** Options for {@link renderHelp}. */
export interface RenderHelpOptions {
	/** Terminal width that descriptions wrap to; they do not wrap when absent. */
	readonly columns?: number | undefined;
}

/**
 * Render help text for a Command Snapshot without running the app. The renderer
 * and `@crustjs/style` load on the first call, so CLIs that never print help
 * never pay for them at startup.
 */
export async function renderHelp(
	command: CommandSnapshot,
	path?: readonly string[],
	options?: RenderHelpOptions,
): Promise<string> {
	const { renderHelpText } = await import("./help-render.ts");
	return renderHelpText(command, path, HELP, options?.columns);
}

const helpFlags = {
	help: { type: "boolean", short: "h", description: "Show help" },
} as const;

async function showHelp(context: ExtensionContext): Promise<void> {
	context.stdout(
		await renderHelp(context.command, context.commandPath, { columns: context.stdout.columns }),
	);
}

const COMMAND_ARG_DESCRIPTION = "Command path, e.g. `remote add`; omit for the root command";

/** The `help [command...]` command, spelled out because the exported factory needs a declared type. */
type HelpCommandDefinition = CommandDefinition<
	"help",
	readonly [],
	CommandShape<
		readonly [
			{
				readonly name: "command";
				readonly type: "string";
				readonly variadic: true;
				readonly description: typeof COMMAND_ARG_DESCRIPTION;
			},
		],
		{},
		{},
		string | undefined,
		{}
	>
>;

/** Options for {@link help}. */
export interface HelpOptions {
	/**
	 * Add a `help [command...]` command: `app help db migrate` prints what
	 * `app db migrate --help` prints. Off by default, because in an application without
	 * subcommands it would take the root command's first argument.
	 */
	readonly command?: boolean;
}

/**
 * Adds `-h` / `--help` to every command, prints a command's help when it has no
 * action, and prints the help of the command a mistyped flag was given to when
 * `-h` or `--help` is its own word before `--`, keeping the usage-error exit code.
 */
export interface HelpExtension {
	(
		options: HelpOptions & { readonly command: true },
	): Extension<{}, [], typeof helpFlags, readonly [HelpCommandDefinition]>;
	(options?: HelpOptions & { readonly command?: false }): Extension<{}, [], typeof helpFlags, []>;
	readonly id: ExtensionId;
}

const helpFactory: ExtensionFactory<
	[options?: HelpOptions],
	{},
	[],
	typeof helpFlags,
	readonly HelpCommandDefinition[]
> = /* @__PURE__ */ defineExtension(HELP).factory((extension, options = {}) => {
	const shown = extension
		.flags(helpFlags)
		.handle("help", showHelp, { eager: true })
		.noAction(showHelp)
		.onError(async (error, context) => {
			if (!(error instanceof CrustError) || error.code !== "PARSE") return;
			const end = context.argv.indexOf("--");
			const words = end === -1 ? context.argv : context.argv.slice(0, end);
			if (!words.includes("-h") && !words.includes("--help")) return;
			await withTypedColorFlag(context, () => showHelp(context));
			return true;
		});
	if (options.command !== true) return shown;
	return shown.add(
		defineCommand("help", { description: "Show help for a command" }, (cmd) =>
			cmd
				.args({
					name: "command",
					type: "string",
					variadic: true,
					description: COMMAND_ARG_DESCRIPTION,
				})
				.output(textOutput)
				.action(async ({ args, rootCommand, stdout }) => {
					const { resolveCommand } = await import("./resolve-command.ts");
					const { command, path } = resolveCommand(rootCommand, args.command);
					const text = await renderHelp(command, [rootCommand.meta.name, ...path], {
						columns: stdout.columns,
					});
					stdout(text);
					return text;
				}),
		),
	);
});

// SAFETY: the runtime adds the `help` command exactly when `options.command` is `true`, as each overload restates.
export const help = helpFactory as HelpExtension;
