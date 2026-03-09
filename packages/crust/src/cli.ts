#!/usr/bin/env bun

import { Crust } from "@crustjs/core";
import {
	autoCompletePlugin,
	helpPlugin,
	updateNotifierPlugin,
	versionPlugin,
} from "@crustjs/plugins";
import pkg from "../package.json";
import { buildCommand } from "./commands/build.ts";

/**
 * The root `crust` CLI command.
 *
 * Built entirely with `@crustjs/core`.
 * When invoked without a subcommand, displays help listing available commands.
 *
 * Subcommands:
 * - `crust build` - Compile your CLI to a standalone Bun executable
 */
export const crustApp = new Crust(pkg.name)
	.meta({ description: pkg.description })
	.use(versionPlugin(pkg.version))
	.use(
		updateNotifierPlugin({
			currentVersion: pkg.version,
			packageName: pkg.name,
		}),
	)
	.use(autoCompletePlugin({ mode: "help" }))
	.use(helpPlugin())
	.command("build", buildCommand);

crustApp.execute();
