import { mkdir, writeFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";

import {
	type Extension,
	type ExtensionId,
	defineCommand,
	defineExtension,
	defineExtensionId,
} from "@crustjs/core";

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
	 *
	 * @default The root command's `meta.name`
	 */
	binName?: string;
	/**
	 * Free-form version string embedded in generated script headers. The
	 * walker does not parse it. Pass your `package.json` version when wiring
	 * the extension.
	 *
	 * @default "0.0.0"
	 */
	version?: string;
}

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

function renderForShell(
	shell: CompletionShell,
	spec: ReturnType<typeof walkCommandNode>,
	binName: string,
	version: string,
): string {
	return SHELL_RENDERERS[shell](spec, binName, version);
}

/**
 * Build an Extension that contributes a `completion <shell>` command
 * which emits a tab-completion script for bash, zsh, or fish.
 *
 * **Strategy: pure-static.** The action walks the final root snapshot, so
 * registration order is irrelevant — any commands or recursive flags added
 * by other Extensions are visible by the time we generate the script. The
 * walker projects the root snapshot to a small completion model; per-shell
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
 */
function completionFactory(options: CompletionOptions = {}): Extension {
	const subcommandName = options.command ?? "completion";
	const version = options.version ?? "0.0.0";

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
					const rootCommand = context.rootCommand;
					// Validate `binName` before emitting anything so misconfigured
					// CLIs fail loudly. The walker also re-validates command/flag
					// identifiers when it builds the spec.
					const binName = assertSafeBinName(options.binName ?? rootCommand.meta.name);
					// `version` flows into header comments only; sanitise to drop
					// control characters (newlines especially) so they cannot break
					// out of the comment line in the emitted script.
					const safeVersion = sanitizeFreeText(version);

					const { shell: requestedShell } = context.args;
					const spec = walkCommandNode(rootCommand);
					const outputDir = context.flags["output-dir"];

					if (outputDir === undefined) {
						const script = renderForShell(requestedShell, spec, binName, safeVersion);
						context.stdout(script);
						return;
					}

					// File path: write **all** supported shells. This matches
					// the packaging-time use case — distributors generate every
					// supported file in one invocation regardless of which
					// shell they nominally requested.
					const targetDir = resolvePath(outputDir);
					await mkdir(targetDir, { recursive: true });
					for (const shell of SUPPORTED_SHELLS) {
						const filename = filenameForShell(shell, binName);
						const script = renderForShell(shell, spec, binName, safeVersion);
						await writeFile(resolvePath(targetDir, filename), script, "utf8");
					}
				}),
	);

	return defineExtension(COMPLETION, { commands: [completionCommand] });
}

export const completion: typeof completionFactory & { readonly id: ExtensionId } = Object.assign(
	completionFactory,
	{ id: COMPLETION },
);
