import {
	type CommandDefinition,
	type CommandShape,
	type CommandSnapshot,
	type Extension,
	type ExtensionFactory,
	type ExtensionId,
	defineCommand,
	defineExtension,
	defineExtensionId,
} from "@crustjs/core";

import { COMPLETE_COMMAND, type Completer, completerAt } from "./complete.ts";
import { textOutput } from "./text-output.ts";

export type { Completer } from "./complete.ts";

declare module "@crustjs/core" {
	interface ArgExtras {
		/**
		 * Live completion values, read only by `completion()`: the generated scripts call the
		 * CLI's hidden `__complete` command, which calls this with the word being completed.
		 */
		complete?: Completer;
	}
	interface FlagExtras {
		/**
		 * Live completion values for a flag that takes a value, read only by `completion()`: the
		 * generated scripts call the CLI's hidden `__complete` command, which calls this with
		 * the word being completed.
		 */
		complete?: Completer;
	}
}

// Renderers, templates and file writing load on first use (see render.ts), so
// registering completion() costs nothing until a script is generated.
const loadRenderer = () => import("./render.ts");

const COMPLETION: ExtensionId = /* @__PURE__ */ defineExtensionId("crust:completion");

/** The shells `completion()` generates scripts for. */
export type CompletionShell = "bash" | "zsh" | "fish" | "powershell";

const SUPPORTED_SHELLS = [
	"bash",
	"zsh",
	"fish",
	"powershell",
] as const satisfies readonly CompletionShell[];

/** Options for the completion Extension. */
export interface CompletionOptions {
	/**
	 * Subcommand name. Override only if the default conflicts with an existing user-defined command.
	 * A literal name keeps the host's command tree type-checked; a dynamic `string` opens it.
	 *
	 * @default "completion"
	 */
	command?: string;
	/**
	 * Free-form version string embedded in generated script headers. The
	 * walker does not parse it.
	 *
	 * @default The root command's `meta.version`
	 */
	version?: string;
}

/** Render inputs shared by the pure shell renderers. */
export type CompletionRenderOptions = Pick<CompletionOptions, "version">;

const SHELL_ARG_DESCRIPTION = "Shell to generate completion for";
const OUTPUT_DIR_DESCRIPTION =
	"Write all supported shells' scripts into this directory instead of printing to stdout";

/**
 * The contributed `completion <shell>` command, spelled out because the exported
 * factory needs a declared type: a closed name keeps the host's command tree
 * precise after `.extend()`.
 */
export type CompletionCommandDefinition<Name extends string = "completion"> = CommandDefinition<
	Name,
	readonly [],
	CommandShape<
		readonly [
			{
				readonly name: "shell";
				readonly type: "string";
				readonly required: true;
				readonly description: typeof SHELL_ARG_DESCRIPTION;
				readonly choices: readonly ["bash", "zsh", "fish", "powershell"];
			},
		],
		{
			readonly "output-dir": {
				readonly type: "path";
				readonly description: typeof OUTPUT_DIR_DESCRIPTION;
			};
		},
		{},
		string | undefined,
		{}
	>
>;

/** The hidden `__complete <address> [word]` command the generated scripts call. */
export type CompleteCommandDefinition = CommandDefinition<
	typeof COMPLETE_COMMAND,
	readonly [],
	CommandShape<
		readonly [
			{ readonly name: "address"; readonly type: "string"; readonly required: true },
			{ readonly name: "word"; readonly type: "string" },
		],
		{},
		{},
		void,
		{}
	>
>;

type OpenCommands = readonly CommandDefinition<any, any, any, any>[];

// A non-literal name cannot be keyed statically, so it keeps the open command namespace.
type CompletionCommands<Name extends string> = string extends Name
	? OpenCommands
	: readonly [CompletionCommandDefinition<Name>, CompleteCommandDefinition];

/**
 * {@link completion}'s signature: a `command` that is always present flows into the host's
 * command tree, an absent one is `completion`, and a possibly absent one stays open. Each
 * shape has a variant for an explicit `version`; without one the root needs a `version`.
 */
export interface CompletionExtension {
	<const Name extends string>(
		options: CompletionOptions & { command: Name; version: string },
	): Extension<{}, [], {}, CompletionCommands<Name>>;
	<const Name extends string>(
		options: CompletionOptions & { command: Name },
	): Extension<{}, [], {}, CompletionCommands<Name>, "version">;
	(
		options: CompletionOptions & { command?: undefined; version: string },
	): Extension<{}, [], {}, readonly [CompletionCommandDefinition, CompleteCommandDefinition]>;
	(
		options?: CompletionOptions & { command?: undefined },
	): Extension<
		{},
		[],
		{},
		readonly [CompletionCommandDefinition, CompleteCommandDefinition],
		"version"
	>;
	// Omitted `Commands` is the open command namespace.
	(options: CompletionOptions & { version: string }): Extension<{}, [], {}>;
	(options?: CompletionOptions): Extension<{}, [], {}, OpenCommands, "version">;
	readonly id: ExtensionId;
}

/** Render a bash completion script from a prepared root Command Snapshot. */
export async function renderBashCompletion(
	root: CommandSnapshot,
	options?: CompletionRenderOptions,
): Promise<string> {
	return (await loadRenderer()).renderCompletionScript("bash", root, options);
}

/** Render a zsh completion script from a prepared root Command Snapshot. */
export async function renderZshCompletion(
	root: CommandSnapshot,
	options?: CompletionRenderOptions,
): Promise<string> {
	return (await loadRenderer()).renderCompletionScript("zsh", root, options);
}

/** Render a fish completion script from a prepared root Command Snapshot. */
export async function renderFishCompletion(
	root: CommandSnapshot,
	options?: CompletionRenderOptions,
): Promise<string> {
	return (await loadRenderer()).renderCompletionScript("fish", root, options);
}

/** Render a PowerShell completion script from a prepared root Command Snapshot. */
export async function renderPowerShellCompletion(
	root: CommandSnapshot,
	options?: CompletionRenderOptions,
): Promise<string> {
	return (await loadRenderer()).renderCompletionScript("powershell", root, options);
}

const completionFactory: ExtensionFactory<
	[options?: CompletionOptions],
	{},
	[],
	{},
	readonly [CompletionCommandDefinition<string>, CompleteCommandDefinition]
> = /* @__PURE__ */ defineExtension(COMPLETION)
	.owns("complete")
	.factory((extension, options = {}) => {
		const subcommandName = options.command ?? "completion";

		const completionCommand = defineCommand(
			subcommandName,
			{ description: "Generate shell tab-completion scripts" },
			(cmd) =>
				cmd
					.args({
						name: "shell",
						type: "string",
						required: true,
						description: SHELL_ARG_DESCRIPTION,
						choices: SUPPORTED_SHELLS,
					})
					.flags({
						"output-dir": {
							type: "path",
							description: OUTPUT_DIR_DESCRIPTION,
						},
					})
					.output(textOutput)
					.action(async (context) => {
						const renderer = await loadRenderer();
						const outputDir = context.flags["output-dir"];
						if (outputDir === undefined) {
							const script = renderer.renderCompletionScript(
								context.args.shell,
								context.rootCommand,
								options,
							);
							context.stdout(script);
							return script;
						}

						// File path: write **all** supported shells. This matches
						// the packaging-time use case — distributors generate every
						// supported file in one invocation regardless of which
						// shell they nominally requested.
						await renderer.writeCompletionFiles(
							outputDir,
							context.rootCommand,
							options,
							SUPPORTED_SHELLS,
						);
					}),
		);

		const completeCommand = defineCommand(
			COMPLETE_COMMAND,
			{ description: "Print the values of a complete function, one per line", hidden: true },
			(cmd) =>
				cmd
					.args(
						{ name: "address", type: "string", required: true },
						{ name: "word", type: "string" },
					)
					.action(async ({ args, rootCommand, stdout }) => {
						const completer = completerAt(rootCommand, args.address);
						// The scripts read one value per line and fish reads a tab as the start of a
						// description, so a value with either is left out.
						for (const value of (await completer?.(args.word ?? "")) ?? []) {
							if (!/[\r\n\t]/.test(value)) stdout(value);
						}
					}),
		);

		return extension
			.add(completionCommand, completeCommand)
			.sections((snapshot) => {
				// The line a user adds for each shell, as kubectl's and cobra's completion help print it.
				const run = `${snapshot.meta.name} ${subcommandName}`;
				return [
					{
						command: [subcommandName],
						title: "Setup",
						// Lines to copy: only help prints a body line by line.
						only: [defineExtensionId("crust:help")],
						body: [
							"# bash, in ~/.bashrc",
							`source <(${run} bash)`,
							"# zsh, in ~/.zshrc after compinit",
							`source <(${run} zsh)`,
							// fish reads config.fish for `fish -c` too; only an interactive shell completes.
							"# fish, in ~/.config/fish/config.fish",
							`status --is-interactive; and ${run} fish | source`,
							"# PowerShell, in $PROFILE",
							`${run} powershell | Out-String | Invoke-Expression`,
						].join("\n"),
					},
				];
			})
			.build(async ({ snapshot }) =>
				(await loadRenderer())
					.renderCompletionFiles(snapshot, options, SUPPORTED_SHELLS)
					.map((file) => ({
						...file,
						path: `completions/${file.path}`,
					})),
			);
	});

/**
 * Build an Extension that contributes a `completion <shell>` command
 * which emits a tab-completion script for bash, zsh, fish, or PowerShell.
 *
 * **Strategy: static, with live values on request.** The action walks the
 * final root snapshot, so registration order is irrelevant — any commands
 * or recursive flags added by other Extensions are visible by the time we
 * generate the script. The walker projects Core's documentation model to a
 * small completion model; per-shell renderers turn that into a
 * self-contained script. Only an argument or flag with a `complete` function,
 * or with `choices` the scripts cannot hold as written, calls back into the
 * CLI: the script runs the hidden `__complete` command, which prints the
 * function's values or the choices.
 *
 * **Print vs `--output-dir`.**
 * - With no `--output-dir`: print the script for the requested `<shell>`
 *   to stdout (the install pattern is
 *   `mycli completion bash > ~/.local/share/...`).
 * - With `--output-dir <path>`: write **all** supported shells' files
 *   into the directory using the canonical per-shell filename
 *   (`<bin>` for bash, `_<bin>` for zsh, `<bin>.fish` for fish,
 *   `<bin>.ps1` for PowerShell). This is the artifact-generation path used
 *   by Homebrew, Nix, and similar distribution channels — distributors run
 *   it once at packaging time and the resulting files become drop-ins.
 *
 * **Build hook.** Returns the same four files under `completions/`; `crust build`
 * writes them to `.crust/artifacts/completions/` and copies that directory into
 * the root package and each platform package's `bin/`. Scripts target the
 * root command name as the installed binary.
 */
// SAFETY: the runtime command name is `options.command ?? "completion"`, which each overload's name restates.
export const completion = completionFactory as CompletionExtension;
