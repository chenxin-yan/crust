#!/usr/bin/env node

import { existsSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";

import { Crust } from "@crustjs/core";
import { isInGitRepo, runSteps, scaffold } from "@crustjs/create";
import { spinner } from "@crustjs/progress";
import { confirm, input, select } from "@crustjs/prompts";

declare const CRUST_CORE_VERSION: string;
declare const CRUST_CLI_VERSION: string;
declare const CRUST_EXTENSIONS_VERSION: string;

type DistributionMode = "binary" | "runtime";

const CRUST_TEMPLATE_VERSION_CONTEXT = {
	crustCoreVersion: CRUST_CORE_VERSION,
	crustExtensionsVersion: CRUST_EXTENSIONS_VERSION,
	crustCliVersion: CRUST_CLI_VERSION,
} satisfies Record<string, string>;

// ────────────────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────────────────

const INVALID_NAME_CHARS = /[<>:"|?*\\]/;
function validateProjectName(name: string): void {
	if (!name) {
		throw new Error("Project name cannot be empty");
	}
	if (INVALID_NAME_CHARS.test(name)) {
		throw new Error(`Project name contains invalid characters: ${name}`);
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Command definition
// ────────────────────────────────────────────────────────────────────────────

const app = new Crust("create-crust", { description: "Scaffold a new Crust CLI project" })
	.flags(
		{
			name: "distribution",
			type: "string",
			choices: ["binary", "runtime"],
			description: 'Distribution mode ("binary" or "runtime")',
		},
		{
			name: "install",
			type: "boolean",
			description: "Install dependencies after scaffolding",
		},
		{
			name: "git",
			type: "boolean",
			description: "Initialize a git repository after scaffolding",
		},
		{
			name: "overwrite",
			type: "boolean",
			description: "Overwrite the destination directory if it already exists",
		},
	)
	.args({
		name: "directory",
		type: "string",
		description: "Project directory to scaffold into",
	})
	.action(async ({ args, flags }) => {
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
		const distributionInitial = flags.distribution;

		// Ask before writing into an existing destination. The cwd (".") always
		// exists, so it only needs confirmation when non-empty; a named directory
		// prompts whenever it already exists.
		const needsOverwriteConfirm =
			targetDir === "." ? readdirSync(resolvedDir).length > 0 : existsSync(resolvedDir);
		let overwrite = false;
		if (needsOverwriteConfirm) {
			overwrite = await confirm({
				message:
					targetDir === "."
						? "Current directory is not empty. Overwrite conflicting files?"
						: `Directory "${dirName}" already exists. Overwrite?`,
				default: false,
				...(flags.overwrite !== undefined ? { initial: flags.overwrite } : {}),
			});
			if (!overwrite) {
				console.log("Aborted.");
				return;
			}
		}

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
			...(distributionInitial !== undefined ? { initial: distributionInitial } : {}),
		});
		const installDeps = await confirm({
			message: "Install dependencies?",
			default: true,
			...(flags.install !== undefined ? { initial: flags.install } : {}),
		});

		// Skip git init prompt if already inside a git repository.
		// Check resolvedDir itself when it exists (e.g. "." or overwrite),
		// otherwise check the parent (directory will be created by scaffold).
		const gitCheckDir = existsSync(resolvedDir) ? resolvedDir : resolve(resolvedDir, "..");
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

		// Scaffolding produces no console output, so it is safe inside a spinner.
		const context = { name, ...CRUST_TEMPLATE_VERSION_CONTEXT };
		await spinner({
			message: "Scaffolding project...",
			task: async () => {
				await scaffold({
					template: "templates/base",
					dest: resolvedDir,
					context,
					...(overwrite ? { conflict: "overwrite" } : {}),
				});
				await scaffold({
					template: "templates/minimal",
					dest: resolvedDir,
					context,
					conflict: "overwrite",
				});
				await scaffold({
					template: `templates/distribution/${distributionMode}`,
					dest: resolvedDir,
					context,
					conflict: "overwrite",
				});
			},
		});

		if (installDeps) {
			await runSteps([{ type: "install" }], resolvedDir);
		}

		if (initGit) {
			await spinner({
				message: "Initializing git repository...",
				task: () => runSteps([{ type: "git-init", commit: "chore: initial commit" }], resolvedDir),
			});
		}

		// Print success message
		console.log(`\nCreated ${name}!\n`);
		console.log("Next steps:");
		if (targetDir !== ".") {
			const relativeDir = targetDir.startsWith("/") ? targetDir : `./${targetDir}`;
			console.log(`  cd ${relativeDir}`);
		}
		console.log("  bun run dev");
		console.log("  bun run build");
	});

await app.execute();
