import { mkdir, writeFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";

import { Crust, type CrustPlugin } from "@crustjs/core";

import { assertSafeBinName, sanitizeFreeText } from "./escape.ts";
import { renderBash } from "./templates/bash.ts";
import { renderFish } from "./templates/fish.ts";
import { renderZsh } from "./templates/zsh.ts";
import { walkCommandNode } from "./walker.ts";

/** The set of shells supported by the v1 completion plugin. */
export type CompletionShell = "bash" | "zsh" | "fish";

const SUPPORTED_SHELLS: readonly CompletionShell[] = ["bash", "zsh", "fish"] as const;

/** Options for {@link completionPlugin}. */
export interface CompletionPluginOptions {
	/**
	 * Subcommand name. Defaults to `"completion"`. Override only if the
	 * default conflicts with an existing user-defined command.
	 */
	command?: string;
	/**
	 * Binary name embedded in generated scripts (the `complete -F` target,
	 * the `#compdef` line, the `complete -c <bin>` rules). Defaults to the
	 * root command's `meta.name`.
	 */
	binName?: string;
	/**
	 * Shells to emit when running `<bin> completion <shell> --output-dir`.
	 * Defaults to all three. The positional `<shell>` argument is always
	 * the union of these values regardless of any narrower setting (we
	 * intentionally keep the user-facing CLI predictable).
	 */
	shells?: readonly CompletionShell[];
	/**
	 * Free-form version string embedded in generated script headers. The
	 * walker does not parse it — it flows through as text. Defaults to
	 * `"0.0.0"`. Pass your `package.json` version when wiring the plugin.
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

function renderForShell(
	shell: CompletionShell,
	spec: ReturnType<typeof walkCommandNode>,
	binName: string,
	version: string,
): string {
	switch (shell) {
		case "bash":
			return renderBash(spec, binName, version);
		case "zsh":
			return renderZsh(spec, binName, version);
		case "fish":
			return renderFish(spec, binName, version);
	}
}

/**
 * Build a `CrustPlugin` that registers a `completion <shell>` subcommand
 * which emits a tab-completion script for bash, zsh, or fish.
 *
 * **Strategy: pure-static.** The walk happens lazily inside `run()` (not
 * at `setup()` time) so plugin order is irrelevant — any subcommands or
 * inherited flags added by other plugins are visible by the time we
 * generate the script. The walker projects `rootCommand` to a small
 * `CompletionSpec`; per-shell renderers turn that into a self-contained
 * shell script with no runtime callbacks.
 *
 * **Print vs `--output-dir`.**
 * - With no `--output-dir`: print the script for the requested `<shell>`
 *   to stdout (the install pattern is
 *   `mycli completion bash > ~/.local/share/...`).
 * - With `--output-dir <path>`: write **all** configured shells' files
 *   into the directory using the canonical per-shell filename
 *   (`<bin>` for bash, `_<bin>` for zsh, `<bin>.fish` for fish). This
 *   is the artifact-generation path used by Homebrew, Nix, and similar
 *   distribution channels — distributors run it once at packaging time
 *   and the resulting files become drop-ins.
 */
export function completionPlugin(options: CompletionPluginOptions = {}): CrustPlugin {
	const subcommandName = options.command ?? "completion";
	const shells = options.shells ?? SUPPORTED_SHELLS;
	const version = options.version ?? "0.0.0";

	return {
		name: "completion",
		setup(context, actions) {
			const rootCommand = context.rootCommand;
			// Validate `binName` once, at setup, so misconfigured CLIs fail
			// loudly during plugin registration rather than at script-emit
			// time. The walker also re-validates command/flag identifiers
			// when it builds the spec.
			const binName = assertSafeBinName(options.binName ?? rootCommand.meta.name);
			// `version` flows into header comments only; sanitise to drop
			// control characters (newlines especially) so they cannot break
			// out of the comment line in the emitted script.
			const safeVersion = sanitizeFreeText(version);

			// Build the completion subcommand using a fresh `Crust` builder.
			// The handler closes over `rootCommand` so it can walk the live
			// tree at run time (lazy walk — see contract above).
			const node = new Crust(subcommandName)
				.meta({
					description: "Generate shell tab-completion scripts",
				})
				.args([
					{
						name: "shell",
						type: "string",
						required: true,
						description: "Shell to generate completion for",
						choices: SUPPORTED_SHELLS,
					},
				] as const)
				.flags({
					"output-dir": {
						type: "string",
						description:
							"Write all configured shells' scripts into this directory instead of printing to stdout",
					},
				})
				.run(async (ctx) => {
					const requestedShell = ctx.args.shell as CompletionShell;
					if (!SUPPORTED_SHELLS.includes(requestedShell)) {
						// Parser-side `choices` validation normally rejects this path;
						// keep the guard for direct handler invocation in tests/tools.
						console.error(
							`Unsupported shell "${requestedShell}". Supported: ${SUPPORTED_SHELLS.join(", ")}`,
						);
						process.exitCode = 1;
						return;
					}

					const spec = walkCommandNode(rootCommand);
					const outputDir = ctx.flags["output-dir"];

					if (outputDir === undefined) {
						// Print path: emit the requested shell's script to stdout.
						const script = renderForShell(requestedShell, spec, binName, safeVersion);
						process.stdout.write(script);
						return;
					}

					// File path: write **all** configured shells. This matches
					// the packaging-time use case — distributors generate every
					// supported file in one invocation regardless of which
					// shell they nominally requested.
					const targetDir = resolvePath(outputDir);
					await mkdir(targetDir, { recursive: true });
					for (const shell of shells) {
						const filename = filenameForShell(shell, binName);
						const script = renderForShell(shell, spec, binName, safeVersion);
						const targetPath = resolvePath(targetDir, filename);
						// Defence-in-depth: even though `binName` is validated
						// upstream (rejects path separators / `..`), verify the
						// resolved path stays inside `targetDir`. This catches
						// future regressions in the validator and platform-
						// specific edge cases (e.g. Windows drive letters).
						if (
							targetPath !== targetDir &&
							!targetPath.startsWith(`${targetDir}/`) &&
							!targetPath.startsWith(`${targetDir}\\`)
						) {
							throw new Error(
								`completion plugin: refusing to write outside output dir (${targetPath})`,
							);
						}
						await writeFile(targetPath, script, "utf8");
					}
				})._node;

			actions.addSubCommand(rootCommand, subcommandName, node);
		},
	};
}
