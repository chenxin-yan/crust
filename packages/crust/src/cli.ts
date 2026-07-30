#!/usr/bin/env bun

import { Crust } from "@crustjs/core";
import { didYouMean, help, updateNotifier, version } from "@crustjs/extensions";

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
	.extend(
		version(pkg.version),
		updateNotifier({
			currentVersion: pkg.version,
			packageName: pkg.name,
		}),
		didYouMean({ mode: "help" }),
		help(),
	)
	.command(buildCommand)
	.command(publishCommand);

crustApp.execute();
