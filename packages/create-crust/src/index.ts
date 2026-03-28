#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { Crust } from "@crustjs/core";
import {
	detectPackageManager,
	isInGitRepo,
	runSteps,
	scaffold,
} from "@crustjs/create";
import { spinner } from "@crustjs/progress";
import { confirm, input, select } from "@crustjs/prompts";

// ────────────────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────────────────

const INVALID_NAME_CHARS = /[<>:"|?*\\]/;

type DistributionMode = "binary" | "runtime";

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

const app = new Crust("create-crust")
	.meta({ description: "Scaffold a new Crust CLI project" })
	.args([
		{
			name: "directory",
			type: "string",
			description: "Project directory to scaffold into",
		},
	])
	.run(async ({ args }) => {
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

		const template = await select<"minimal" | "modular">({
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
		});

		const styleTemplatePath =
			template === "minimal" ? "templates/minimal" : "templates/modular";

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
		});

		const distributionTemplatePath =
			distributionMode === "binary"
				? "templates/distribution/binary"
				: "templates/distribution/runtime";

		const installDeps = await confirm({
			message: "Install dependencies?",
			default: true,
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
				});

		// ── Execute all file operations after prompts are done ──────────

		// Infer package name from directory
		const name = dirName;

		// Scaffold in layers: base -> style variant -> distribution variant
		await scaffold({
			template: "templates/base",
			dest: resolvedDir,
			context: { name },
			conflict: "overwrite",
		});

		await scaffold({
			template: styleTemplatePath,
			dest: resolvedDir,
			context: { name },
			conflict: "overwrite",
		});

		await scaffold({
			template: distributionTemplatePath,
			dest: resolvedDir,
			context: { name },
			conflict: "overwrite",
		});

		// Install dependencies using the detected package manager
		if (installDeps) {
			const pm = detectPackageManager(resolvedDir);
			const installCmd = pm === "npm" ? "npm install" : `${pm} install`;

			await runSteps([{ type: "command", cmd: installCmd }], resolvedDir);
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
