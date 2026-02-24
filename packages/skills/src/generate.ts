// ────────────────────────────────────────────────────────────────────────────
// Top-level generation — orchestrates manifest → render → write pipeline
// ────────────────────────────────────────────────────────────────────────────

import type { GenerateOptions, GenerateResult } from "./types.ts";

/**
 * Generates a distributable agent skill bundle from a Crust command tree.
 *
 * This is the primary high-level API for skill generation. It:
 * 1. Builds a canonical manifest from the command tree
 * 2. Renders markdown files from the manifest
 * 3. Writes the files to the output directory
 *
 * @param options - Generation options including the root command, metadata, and output config
 * @returns Result containing the output directory path and list of written files
 *
 * @example
 * ```ts
 * import { generateSkill } from "@crustjs/skills";
 * import { rootCommand } from "./commands.ts";
 *
 * const result = await generateSkill({
 *   command: rootCommand,
 *   meta: {
 *     name: "my-cli",
 *     description: "CLI tool for managing widgets",
 *     version: "1.0.0",
 *   },
 *   outDir: "./dist",
 * });
 *
 * console.log(`Generated ${result.files.length} files to ${result.outputDir}`);
 * ```
 */
export async function generateSkill(
	_options: GenerateOptions,
): Promise<GenerateResult> {
	// TODO: Implement in task 4 — bundle writer
	throw new Error("generateSkill is not yet implemented");
}
