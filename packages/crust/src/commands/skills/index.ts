import { defineCommand } from "@crustjs/core";
import { generateCommand } from "./generate.ts";

// ────────────────────────────────────────────────────────────────────────────
// Skills group command — parent for skill-related subcommands
// ────────────────────────────────────────────────────────────────────────────

/**
 * `crust skills` — Agent skill generation commands.
 *
 * Group command that provides subcommands for generating distributable
 * agent skill bundles from Crust command definitions.
 *
 * Subcommands:
 * - `crust skills generate` — Generate a skill bundle from a command module
 */
export const skillsCommand = defineCommand({
	meta: {
		name: "skills",
		description: "Agent skill generation commands",
	},
	subCommands: {
		generate: generateCommand,
	},
});
