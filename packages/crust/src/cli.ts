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
import { packageCommand } from "./commands/package.ts";

/**
 * The root `crust` CLI command.
 *
 * Built entirely with `@crustjs/core`.
 * When invoked without a subcommand, displays help listing available commands.
 *
 * Subcommands:
 * - `crust build` - Compile your CLI to a standalone Bun executable
 * - `crust package` - Stage npm packages for platform-specific binary publishing
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
	.command("build", buildCommand)
	.command("package", packageCommand);

crustApp.execute();
