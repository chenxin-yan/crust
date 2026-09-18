import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve as resolvePath } from "node:path";

import {
	CrustError,
	type BuildArtifacts,
	type CommandDefinition,
	type CommandSnapshot,
	type ExtensionFactory,
	type ExtensionId,
	defineCommand,
	defineExtension,
	defineExtensionId,
} from "@crustjs/core";
import { buildCommandDocumentation } from "@crustjs/core/tooling";

import { assertSafeBinName, sanitizeFreeText } from "./escape.ts";
import { renderBash } from "./templates/bash.ts";
import { renderFish } from "./templates/fish.ts";
import { renderZsh } from "./templates/zsh.ts";
import { walkCommandNode } from "./walker.ts";

const COMPLETION: ExtensionId = defineExtensionId("crust:completion");

/** The set of shells supported by the v1 completion extension. */
export type CompletionShell = "bash" | "zsh" | "fish";

const SUPPORTED_SHELLS: readonly CompletionShell[] = ["bash", "zsh", "fish"] as const;

/** Options for the completion Extension. */
export interface CompletionOptions {
	/**
	 * Subcommand name. Override only if the default conflicts with an existing user-defined command.
	 *
	 * @default "completion"
	 */
	command?: string;
	/**
	 * Binary name embedded in generated scripts (the `complete -F` target,
	 * the `#compdef` line, the `complete -c <bin>` rules).
	 * Applies to the runtime command and build hook; set it when the npm bin key
	 * installs the CLI under a different name.
	 *
	 * @default The root command's `meta.name`
	 */
	binName?: string;
	/**
	 * Free-form version string embedded in generated script headers. The
	 * walker does not parse it.
	 *
	 * @default The root command's `meta.version`
	 */
	version?: string;
}

/** Render inputs shared by the pure shell renderers. */
export type CompletionRenderOptions = Pick<CompletionOptions, "binName" | "version">;

/** Filename convention for each shell's drop-in completion file. */
function filenameForShell(shell: CompletionShell, binName: string): string {
	switch (shell) {
		case "bash":
			// bash-completion expects the file named exactly after the command
			// (no extension) under
			// `~/.local/share/bash-completion/completions/`.
			return binName;
		case "zsh":
			// zsh's `compinit` autoloads files named `_<command>` from $fpath.
			return `_${binName}`;
		case "fish":
			// fish auto-loads `~/.config/fish/completions/<command>.fish`.
			return `${binName}.fish`;
	}
}

const SHELL_RENDERERS = {
	bash: renderBash,
	zsh: renderZsh,
	fish: renderFish,
} satisfies Record<CompletionShell, typeof renderBash>;

function prepareRender(root: CommandSnapshot, options: CompletionRenderOptions) {
	// Validate `binName` before emitting anything so misconfigured CLIs fail loudly.
	// The walker also re-validates command/flag identifiers when it builds the spec.
	const binName = assertSafeBinName(options.binName ?? root.meta.name);
	const version = options.version ?? root.meta.version;
	if (version === undefined) {
		throw new CrustError(
			"DEFINITION",
			"The completion extension requires a version in new Crust(name, { version }) or completion({ version })",
		);
	}
	// `version` flows into header comments only; strip control characters so it
	// cannot break out of the comment line in the emitted script.
	return {
		spec: walkCommandNode(buildCommandDocumentation(root)),
		binName,
		version: sanitizeFreeText(version),
	};
}

/** Every supported shell's drop-in file, named by its autoload convention. */
function renderCompletionFiles(
	root: CommandSnapshot,
	options: CompletionRenderOptions,
): BuildArtifacts {
	const { spec, binName, version } = prepareRender(root, options);
	return SUPPORTED_SHELLS.map((shell) => ({
		path: filenameForShell(shell, binName),
		content: SHELL_RENDERERS[shell](spec, binName, version),
	}));
}

function renderCompletionScript(
	shell: CompletionShell,
	root: CommandSnapshot,
	options: CompletionRenderOptions = {},
): string {
	const { spec, binName, version } = prepareRender(root, options);
	return SHELL_RENDERERS[shell](spec, binName, version);
}

/** Render a bash completion script from a prepared root Command Snapshot. */
export function renderBashCompletion(
	root: CommandSnapshot,
	options?: CompletionRenderOptions,
): string {
	return renderCompletionScript("bash", root, options);
}

/** Render a zsh completion script from a prepared root Command Snapshot. */
export function renderZshCompletion(
	root: CommandSnapshot,
	options?: CompletionRenderOptions,
): string {
	return renderCompletionScript("zsh", root, options);
}

/** Render a fish completion script from a prepared root Command Snapshot. */
export function renderFishCompletion(
	root: CommandSnapshot,
	options?: CompletionRenderOptions,
): string {
	return renderCompletionScript("fish", root, options);
}

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
 * the root package and each platform package's `bin/`. The binary name defaults
 * to the snapshot's `meta.name`, unless `options.binName` is set.
 */
// Configurable command names require an open command namespace.
export const completion: ExtensionFactory<
	[options?: CompletionOptions],
	{},
	[],
	[],
	readonly CommandDefinition<any, any, any, any>[]
> = defineExtension(COMPLETION, (options = {}) => {
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
					description: "Shell to generate completion for",
					choices: SUPPORTED_SHELLS,
				})
				.flags({
					name: "output-dir",
					type: "string",
					description:
						"Write all supported shells' scripts into this directory instead of printing to stdout",
				})
				.action(async (context) => {
					const outputDir = context.flags["output-dir"];
					if (outputDir === undefined) {
						context.stdout(
							renderCompletionScript(context.args.shell, context.rootCommand, options),
						);
						return;
					}

					// File path: write **all** supported shells. This matches
					// the packaging-time use case — distributors generate every
					// supported file in one invocation regardless of which
					// shell they nominally requested.
					const dir = resolvePath(outputDir);
					const files = renderCompletionFiles(context.rootCommand, options);
					await mkdir(dir, { recursive: true });
					for (const file of files) await writeFile(join(dir, file.path), file.content);
				}),
	);

	return {
		commands: [completionCommand],
		build: ({ snapshot }) =>
			renderCompletionFiles(snapshot, options).map((file) => ({
				...file,
				path: `completions/${file.path}`,
			})),
	};
});
