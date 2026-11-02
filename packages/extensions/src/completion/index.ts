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

// Renderers, templates and file writing load on first use (see render.ts), so
// registering completion() costs nothing until a script is generated.
const loadRenderer = () => import("./render.ts");

const COMPLETION: ExtensionId = /* @__PURE__ */ defineExtensionId("crust:completion");

/** The set of shells supported by the v1 completion extension. */
export type CompletionShell = "bash" | "zsh" | "fish";

const SUPPORTED_SHELLS = ["bash", "zsh", "fish"] as const satisfies readonly CompletionShell[];

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
				readonly choices: readonly ["bash", "zsh", "fish"];
			},
		],
		{
			readonly "output-dir": {
				readonly type: "string";
				readonly description: typeof OUTPUT_DIR_DESCRIPTION;
			};
		},
		{},
		void,
		{}
	>
>;

// A non-literal name cannot be keyed statically, so it keeps the open command namespace.
type CompletionCommands<Name extends string> = string extends Name
	? readonly CommandDefinition<any, any, any, any>[]
	: readonly [CompletionCommandDefinition<Name>];

/**
 * {@link completion}'s signature: a `command` that is always present flows into the host's
 * command tree, an absent one is `completion`, and a possibly absent one stays open.
 */
export interface CompletionExtension {
	<const Name extends string>(
		options: CompletionOptions & { command: Name },
	): Extension<{}, [], [], CompletionCommands<Name>>;
	(
		options?: CompletionOptions & { command?: undefined },
	): Extension<{}, [], [], readonly [CompletionCommandDefinition]>;
	// Omitted `Commands` is the open command namespace.
	(options?: CompletionOptions): Extension<{}, [], []>;
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

const completionFactory: ExtensionFactory<
	[options?: CompletionOptions],
	{},
	[],
	[],
	readonly [CompletionCommandDefinition<string>]
> = /* @__PURE__ */ defineExtension(COMPLETION).factory((extension, options = {}) => {
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
					name: "output-dir",
					type: "string",
					description: OUTPUT_DIR_DESCRIPTION,
				})
				.action(async (context) => {
					const renderer = await loadRenderer();
					const outputDir = context.flags["output-dir"];
					if (outputDir === undefined) {
						context.stdout(
							renderer.renderCompletionScript(context.args.shell, context.rootCommand, options),
						);
						return;
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

	return extension.add(completionCommand).build(async ({ snapshot }) =>
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
 * which emits a tab-completion script for bash, zsh, or fish.
 *
 * **Strategy: pure-static.** The action walks the final root snapshot, so
 * registration order is irrelevant — any commands or recursive flags added
 * by other Extensions are visible by the time we generate the script. The
 * walker projects Core's documentation model to a small completion model; per-shell
 * renderers turn that into a self-contained shell script with no runtime
 * callbacks.
 *
 * **Print vs `--output-dir`.**
 * - With no `--output-dir`: print the script for the requested `<shell>`
 *   to stdout (the install pattern is
 *   `mycli completion bash > ~/.local/share/...`).
 * - With `--output-dir <path>`: write **all** supported shells' files
 *   into the directory using the canonical per-shell filename
 *   (`<bin>` for bash, `_<bin>` for zsh, `<bin>.fish` for fish). This
 *   is the artifact-generation path used by Homebrew, Nix, and similar
 *   distribution channels — distributors run it once at packaging time
 *   and the resulting files become drop-ins.
 *
 * **Build hook.** Returns the same three files under `completions/`; `crust build`
 * writes them to `.crust/artifacts/completions/` and copies that directory into
 * the root package and each platform package's `bin/`. Scripts target the
 * root command name as the installed binary.
 */
// SAFETY: the runtime command name is `options.command ?? "completion"`, which each overload's name restates.
export const completion = completionFactory as CompletionExtension;
