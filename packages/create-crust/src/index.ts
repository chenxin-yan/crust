#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { Crust } from "@crustjs/core";
import { isInGitRepo, runSteps } from "@crustjs/create";
import { spinner } from "@crustjs/progress";
import { confirm, input, select } from "@crustjs/prompts";
import {
	type DistributionMode,
	scaffoldCrustProject,
	type TemplateStyle,
} from "./create-project.ts";

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

function parseTemplateStyle(
	value: string | undefined,
): TemplateStyle | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (value === "minimal" || value === "modular") {
		return value;
	}
	throw new Error(
		`Invalid template "${value}". Expected "minimal" or "modular".`,
	);
}

function parseDistributionMode(
	value: string | undefined,
): DistributionMode | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (value === "binary" || value === "runtime") {
		return value;
	}
	throw new Error(
		`Invalid distribution "${value}". Expected "binary" or "runtime".`,
	);
}

// ────────────────────────────────────────────────────────────────────────────
// Command definition
// ────────────────────────────────────────────────────────────────────────────

const app = new Crust("create-crust")
	.meta({ description: "Scaffold a new Crust CLI project" })
	.flags({
		template: {
			type: "string",
			description: 'Template style ("minimal" or "modular")',
		},
		distribution: {
			type: "string",
			description: 'Distribution mode ("binary" or "runtime")',
		},
		install: {
			type: "boolean",
			description: "Install dependencies after scaffolding",
		},
		git: {
			type: "boolean",
			description: "Initialize a git repository after scaffolding",
		},
		overwrite: {
			type: "boolean",
			description: "Overwrite the destination directory if it already exists",
		},
	})
	.args([
		{
			name: "directory",
			type: "string",
			description: "Project directory to scaffold into",
		},
	])
	.run(async ({ args, flags }) => {
		// ── Collect all prompts before any file operations ──────────────
		// This ensures a mid-prompt Ctrl+C won't leave partially scaffolded files.

		// Determine project directory from positional arg or prompt
		const targetDir =
			args.directory ??
			(await input({
				message: "Project directory",
				default: "my-cli",
				validate: validateProjectName,
			}));

		const resolvedDir = resolve(process.cwd(), targetDir);
		const dirName = basename(resolvedDir);
		const templateInitial = parseTemplateStyle(flags.template);
		const distributionInitial = parseDistributionMode(flags.distribution);

		// Check if directory already exists (skip for "." — scaffolding in-place is intentional)
		if (targetDir !== "." && existsSync(resolvedDir)) {
			const overwrite = await confirm({
				message: `Directory "${dirName}" already exists. Overwrite?`,
				default: false,
				...(flags.overwrite !== undefined ? { initial: flags.overwrite } : {}),
			});
			if (!overwrite) {
				console.log("Aborted.");
				return;
			}
		}

		const template = await select<TemplateStyle>({
			message: "Template style",
			choices: [
				{
					label: "Minimal",
					value: "minimal",
					hint: "single-file starter",
				},
				{
					label: "Modular",
					value: "modular",
					hint: "file split with .sub()",
				},
			],
			default: "minimal",
			...(templateInitial !== undefined ? { initial: templateInitial } : {}),
		});
		const distributionMode = await select<DistributionMode>({
			message: "Distribution mode",
			choices: [
				{
					label: "Standalone binaries (recommended)",
					value: "binary",
					hint: "compile with crust build, publish self-contained executables",
				},
				{
					label: "Bun runtime package",
					value: "runtime",
					hint: "ship JS build that runs with Bun",
				},
			],
			default: "binary",
			...(distributionInitial !== undefined
				? { initial: distributionInitial }
				: {}),
		});
		const installDeps = await confirm({
			message: "Install dependencies?",
			default: true,
			...(flags.install !== undefined ? { initial: flags.install } : {}),
		});

		// Skip git init prompt if already inside a git repository.
		// Check resolvedDir itself when it exists (e.g. "." or overwrite),
		// otherwise check the parent (directory will be created by scaffold).
		const gitCheckDir = existsSync(resolvedDir)
			? resolvedDir
			: resolve(resolvedDir, "..");
		const alreadyInRepo = isInGitRepo(gitCheckDir);
		const initGit = alreadyInRepo
			? false
			: await confirm({
					message: "Initialize a git repository?",
					default: true,
					...(flags.git !== undefined ? { initial: flags.git } : {}),
				});

		// ── Execute all file operations after prompts are done ──────────

		// Infer package name from directory
		const name = dirName;

		await spinner({
			message: "Scaffolding project...",
			task: () =>
				scaffoldCrustProject({
					resolvedDir,
					name,
					template,
					distributionMode,
				}),
		});

		if (installDeps) {
			await runSteps([{ type: "install" }], resolvedDir);
		}

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
	});

await app.execute();
