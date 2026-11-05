import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve as resolvePath } from "node:path";

import { CrustError, type BuildArtifacts, type CommandSnapshot } from "@crustjs/core";
import { buildCommandDocumentation } from "@crustjs/core/tooling";

import { assertSafeBinName, sanitizeFreeText } from "./escape.ts";
import type { CompletionOptions, CompletionShell } from "./index.ts";
import { renderBash } from "./templates/bash.ts";
import { renderFish } from "./templates/fish.ts";
import { renderZsh } from "./templates/zsh.ts";
import { walkCommand } from "./walker.ts";

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

function prepareRender(root: CommandSnapshot, options: CompletionOptions) {
	// Validate the root name before emitting anything so misconfigured CLIs fail loudly.
	// The walker also re-validates command/flag identifiers when it builds the spec.
	const binName = assertSafeBinName(root.meta.name);
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
		spec: walkCommand(buildCommandDocumentation(root)),
		binName,
		version: sanitizeFreeText(version),
		command: options.command ?? "completion",
	};
}

/** Every supported shell's drop-in file, named by its autoload convention. */
export function renderCompletionFiles(
	root: CommandSnapshot,
	options: CompletionOptions,
	shells: readonly CompletionShell[],
): BuildArtifacts {
	const { spec, binName, version, command } = prepareRender(root, options);
	return shells.map((shell) => ({
		path: filenameForShell(shell, binName),
		content: SHELL_RENDERERS[shell](spec, binName, version, command),
	}));
}

export function renderCompletionScript(
	shell: CompletionShell,
	root: CommandSnapshot,
	options: CompletionOptions = {},
): string {
	const { spec, binName, version, command } = prepareRender(root, options);
	return SHELL_RENDERERS[shell](spec, binName, version, command);
}

/** Write every supported shell's drop-in file into `outputDir`. */
export async function writeCompletionFiles(
	outputDir: string,
	root: CommandSnapshot,
	options: CompletionOptions,
	shells: readonly CompletionShell[],
): Promise<void> {
	const dir = resolvePath(outputDir);
	const files = renderCompletionFiles(root, options, shells);
	await mkdir(dir, { recursive: true });
	for (const file of files) await writeFile(join(dir, file.path), file.content);
}
