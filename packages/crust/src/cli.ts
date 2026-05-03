#!/usr/bin/env bun

import { Crust } from "@crustjs/core";
import {
	didYouMeanPlugin,
	helpPlugin,
	updateNotifierPlugin,
	versionPlugin,
} from "@crustjs/plugins";
import pkg from "../package.json";
import { buildCommand } from "./commands/build.ts";
import { publishCommand } from "./commands/publish.ts";

/**
 * The root `crust` CLI command.
 *
 * Built entirely with `@crustjs/core`.
 * When invoked without a subcommand, displays help listing available commands.
 *
 * Subcommands:
 * - `crust build` - Compile your CLI to a standalone Bun executable
 * - `crust publish` - Publish staged npm packages in manifest order
 */
export const crustApp = new Crust("crust")
	.meta({ description: pkg.description })
	.use(versionPlugin(pkg.version))
	.use(
		updateNotifierPlugin({
			currentVersion: pkg.version,
			packageName: pkg.name,
		}),
	)
	.use(didYouMeanPlugin({ mode: "help" }))
	.use(helpPlugin())
	.command(buildCommand)
	.command(publishCommand);

crustApp.execute();
