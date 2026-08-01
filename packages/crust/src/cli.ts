#!/usr/bin/env bun

import { crustBase } from "./app.ts";
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
export const crustApp = crustBase.mount("build", buildCommand).mount("publish", publishCommand);

await crustApp.execute();
