import { resolve } from "node:path";
import type { AnyCommand } from "@crustjs/core";
import { defineCommand } from "@crustjs/core";
import { generateSkill } from "@crustjs/skills";

// ────────────────────────────────────────────────────────────────────────────
// Command module loading — dynamic import of user CLI entrypoints
// ────────────────────────────────────────────────────────────────────────────

/**
 * Dynamically imports a command module and extracts the root `AnyCommand` export.
 *
 * Resolution order:
 * 1. Named export matching `--export` value (default: `"default"`)
 * 2. If `"default"` is requested and no default export exists, uses the first
 *    export value that has a `meta` property (duck-typed `AnyCommand` check)
 *
 * @param modulePath - Path to the user's command module (resolved to absolute)
 * @param exportName - Named export to extract (default: `"default"`)
 * @returns The resolved `AnyCommand` root
 * @throws {Error} If the module cannot be imported or no valid command export is found
 */
export async function loadCommandModule(
	modulePath: string,
	exportName: string = "default",
): Promise<AnyCommand> {
	const absolutePath = resolve(modulePath);

	let mod: Record<string, unknown>;
	try {
		mod = (await import(absolutePath)) as Record<string, unknown>;
	} catch (cause) {
		throw new Error(
			`Failed to import command module: ${absolutePath}\n` +
				`Ensure the file exists and exports a valid command.\n` +
				`Tip: Guard runtime code with \`if (import.meta.main)\` to avoid side effects on import.`,
			{ cause: cause instanceof Error ? cause : undefined },
		);
	}

	// 1. Try the requested export name
	if (exportName in mod && isAnyCommand(mod[exportName])) {
		return mod[exportName] as AnyCommand;
	}

	// 2. If requesting default and no default export, try to find the first AnyCommand
	if (exportName === "default") {
		for (const value of Object.values(mod)) {
			if (isAnyCommand(value)) {
				return value as AnyCommand;
			}
		}
	}

	throw new Error(
		`No valid command export found in: ${absolutePath}\n` +
			`Expected a \`${exportName}\` export with a \`meta\` property (an AnyCommand from defineCommand).\n` +
			`Available exports: ${Object.keys(mod).join(", ") || "(none)"}`,
	);
}

/**
 * Duck-type check for `AnyCommand` — verifies the value has a `meta` object
 * with a `name` string property, which is the minimum shape of a command
 * created by `defineCommand`.
 */
function isAnyCommand(value: unknown): boolean {
	if (typeof value !== "object" || value === null || !("meta" in value)) {
		return false;
	}
	const meta = (value as Record<string, unknown>).meta;
	if (typeof meta !== "object" || meta === null) {
		return false;
	}
	return typeof (meta as Record<string, unknown>).name === "string";
}

// ────────────────────────────────────────────────────────────────────────────
// Skills generate command definition
// ────────────────────────────────────────────────────────────────────────────

/**
 * `crust skills generate` — Generate a distributable agent skill bundle
 * from a Crust command module.
 *
 * Takes a command module path as a positional argument, dynamically imports
 * it, and uses `@crustjs/skills` to generate the skill bundle.
 *
 * @example
 * ```sh
 * crust skills generate ./src/cli.ts --name my-cli --description "My CLI tool"
 * crust skills generate ./src/cli.ts --name my-cli --description "My CLI" --version 1.0.0
 * crust skills generate ./src/cli.ts --name my-cli --description "My CLI" --out-dir ./dist
 * crust skills generate ./src/cli.ts --name my-cli --description "My CLI" --export rootCommand
 * ```
 */
export const generateCommand = defineCommand({
	meta: {
		name: "generate",
		description: "Generate a distributable agent skill bundle from a command",
	},
	args: [
		{
			name: "module",
			type: "string",
			description: "Path to the command module to generate skills from",
			required: true,
		},
	] as const,
	flags: {
		name: {
			type: "string",
			alias: "n",
			description: "Skill name (used as directory name and in metadata)",
			required: true,
		},
		description: {
			type: "string",
			alias: "d",
			description: "Human-readable description of the CLI",
			required: true,
		},
		version: {
			type: "string",
			alias: "V",
			description: "Version string for the generated skill bundle",
		},
		"out-dir": {
			type: "string",
			alias: "o",
			description: "Output directory (files go to <out-dir>/skills/<name>/)",
			default: ".",
		},
		clean: {
			type: "boolean",
			description:
				"Remove existing skill directory before writing (default: true)",
			default: true,
		},
		export: {
			type: "string",
			alias: "e",
			description:
				'Named export to use from the module (default: "default", or first AnyCommand export)',
			default: "default",
		},
	} as const,
	async run({ args, flags }) {
		const modulePath = args.module;

		// Load the command from the user's module
		const command = await loadCommandModule(modulePath, flags.export);

		// Build generation options
		const result = await generateSkill({
			command,
			meta: {
				name: flags.name,
				description: flags.description,
				version: flags.version,
			},
			outDir: flags["out-dir"],
			clean: flags.clean,
		});

		// Success output
		console.log(
			`Generated skill "${flags.name}" with ${result.files.length} files`,
		);
		console.log(`Output: ${result.outputDir}`);
	},
});
