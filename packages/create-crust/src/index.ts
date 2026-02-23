#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { defineCommand, runMain } from "@crustjs/core";
import { detectPackageManager, runSteps, scaffold } from "@crustjs/create";
import { confirm, input, spinner } from "@crustjs/prompts";

// ────────────────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────────────────

const INVALID_NAME_CHARS = /[<>:"|?*\\]/;

function validateProjectName(name: string): true | string {
	if (!name) {
		return "Project name cannot be empty";
	}
	if (INVALID_NAME_CHARS.test(name)) {
		return `Project name contains invalid characters: ${name}`;
	}
	return true;
}

// ────────────────────────────────────────────────────────────────────────────
// Command definition
// ────────────────────────────────────────────────────────────────────────────

const command = defineCommand({
	meta: {
		name: "create-crust",
		description: "Scaffold a new Crust CLI project",
	},
	args: [
		{
			name: "directory",
			type: "string",
			description: "Project directory to scaffold into",
		},
	],
	async run({ args }) {
		// Determine project directory from positional arg or prompt
		const targetDir =
			args.directory ??
			(await input({
				message: "Project directory",
				placeholder: "my-cli",
				validate: validateProjectName,
			}));

		const resolvedDir = resolve(process.cwd(), targetDir);
		const dirName = basename(resolvedDir);

		// Check if directory already exists (skip for "." — scaffolding in-place is intentional)
		if (targetDir !== "." && existsSync(resolvedDir)) {
			const overwrite = await confirm({
				message: `Directory "${dirName}" already exists. Overwrite?`,
				default: false,
			});
			if (!overwrite) {
				console.log("Aborted.");
				return;
			}
		}

		// Infer package name from directory
		const name = dirName;

		// Scaffold the project using @crustjs/create
		await scaffold({
			template: "./templates/base",
			dest: resolvedDir,
			context: { name },
			conflict: "overwrite",
		});

		// Install dependencies using the detected package manager
		const installDeps = await confirm({
			message: "Install dependencies?",
			default: true,
		});

		if (installDeps) {
			const pm = detectPackageManager(resolvedDir);
			const installCmd = pm === "npm" ? "npm install" : `${pm} install`;

			await runSteps([{ type: "command", cmd: installCmd }], resolvedDir);
		}

		const initGit = await confirm({
			message: "Initialize a git repository?",
			default: true,
		});

		if (initGit) {
			await spinner({
				message: "Initializing git repository...",
				task: () =>
					runSteps(
						[{ type: "git-init", commit: "chore: initial commit" }],
						resolvedDir,
					),
			});
		}

		// Print success message
		console.log(`\nCreated ${name}!\n`);
		console.log("Next steps:");
		if (targetDir !== ".") {
			const relativeDir = targetDir.startsWith("/")
				? targetDir
				: `./${targetDir}`;
			console.log(`  cd ${relativeDir}`);
		}
		console.log("  bun run dev");
		console.log("  bun run build");
	},
});

runMain(command);
