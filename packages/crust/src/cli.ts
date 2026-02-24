#!/usr/bin/env bun

import { type Command, defineCommand, runMain } from "@crustjs/core";
import {
	autoCompletePlugin,
	helpPlugin,
	versionPlugin,
} from "@crustjs/plugins";
import pkg from "../package.json";
import { buildCommand } from "./commands/build.ts";
import { skillsCommand } from "./commands/skills/index.ts";

/**
 * The root `crust` CLI command.
 *
 * Built entirely with `@crustjs/core`.
 * When invoked without a subcommand, displays help listing available commands.
 *
 * Subcommands:
 * - `crust build` - Compile your CLI to a standalone Bun executable
 * - `crust skills` - Agent skill generation commands
 */
export const crustCommand: Command = defineCommand({
	meta: {
		name: pkg.name,
		description: pkg.description,
	},
	subCommands: {
		build: buildCommand,
		skills: skillsCommand,
	},
});

runMain(crustCommand, {
	plugins: [
		versionPlugin(pkg.version),
		autoCompletePlugin({ mode: "help" }),
		helpPlugin(),
	],
});
