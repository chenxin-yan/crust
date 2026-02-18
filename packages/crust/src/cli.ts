#!/usr/bin/env bun

import { defineCommand, runMain } from "@crust/core";
import { autoCompletePlugin, helpPlugin, versionPlugin } from "@crust/plugins";
import pkg from "../package.json";
import { buildCommand } from "./commands/build.ts";
import { devCommand } from "./commands/dev.ts";

/**
 * The root `crust` CLI command.
 *
 * Built entirely with `@crust/core`.
 * When invoked without a subcommand, displays help listing available commands.
 *
 * Subcommands:
 * - `crust build` - Compile your CLI to a standalone Bun executable
 * - `crust dev` - Start your CLI in development mode with hot reload
 */
export const crustCommand = defineCommand({
	meta: {
		name: pkg.name,
		description: pkg.description,
	},
	subCommands: {
		build: buildCommand,
		dev: devCommand,
	},
});

runMain(crustCommand, {
	plugins: [
		versionPlugin(pkg.version),
		autoCompletePlugin({ mode: "help" }),
		helpPlugin(),
	],
});
