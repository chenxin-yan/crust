#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "@crust/core";
import { defineCommand, runMain } from "@crust/core";
import { buildCommand } from "./commands/build.ts";
import { devCommand } from "./commands/dev.ts";

// Read version from package.json at runtime
function getVersion(): string {
	try {
		const pkgPath = resolve(import.meta.dirname, "../package.json");
		const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
			version?: string;
		};
		return pkg.version ?? "0.0.0";
	} catch {
		return "0.0.0";
	}
}

const crustVersion = getVersion();

function formatRootHelp(): string {
	return [
		"crust - A Bun-native, TypeScript-first CLI framework",
		"",
		"USAGE:",
		"  crust <command> [options]",
		"",
		"COMMANDS:",
		"  build   Compile your CLI to a standalone executable",
		"  dev     Start your CLI in development mode with hot reload",
		"",
		"OPTIONS:",
		"  -h, --help      Show this help",
		"  -v, --version   Show version",
	].join("\n");
}

/**
 * The root `crust` CLI command.
 *
 * Built entirely with `@crust/core` (self-hosting / dogfooding).
 * When invoked without a subcommand, displays help listing available commands.
 *
 * Subcommands:
 * - `crust build` - Compile your CLI to a standalone Bun executable
 * - `crust dev` - Start your CLI in development mode with hot reload
 */
// biome-ignore lint/suspicious/noExplicitAny: Exported command uses wide type for isolatedDeclarations compatibility
export const crustCommand: Command<any, any> = defineCommand({
	meta: {
		name: "crust",
		description: "A Bun-native, TypeScript-first CLI framework",
	},
	flags: {
		help: { type: Boolean, alias: "h" },
		version: { type: Boolean, alias: "v" },
	},
	subCommands: {
		build: buildCommand,
		dev: devCommand,
	},
	run({ flags }) {
		if (flags.version) {
			console.log(`crust v${crustVersion}`);
			return;
		}

		console.log(formatRootHelp());
	},
});

runMain(crustCommand);
