#!/usr/bin/env node

import { existsSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";

import { Crust } from "@crustjs/core";
import { isInGitRepo, runSteps, scaffold } from "@crustjs/create";
import { spinner } from "@crustjs/progress";
import { confirm, input, select } from "@crustjs/prompts";

import corePackage from "../../core/package.json";
import crustPackage from "../../crust/package.json";
import extensionsPackage from "../../extensions/package.json";
import testingPackage from "../../testing/package.json";

type DistributionMode = "binary" | "runtime";

const TEMPLATE_VERSION_CONTEXT = {
	crustCoreVersion: corePackage.version,
	crustExtensionsVersion: extensionsPackage.version,
	crustCliVersion: crustPackage.version,
	crustTestingVersion: testingPackage.version,
} satisfies Record<string, string>;

const INVALID_NAME_CHARS = /[<>:"|?*\\]/;

function validateProjectName(name: string): void {
	if (!name) throw new Error("Project name cannot be empty");
	if (INVALID_NAME_CHARS.test(name)) {
		throw new Error(`Project name contains invalid characters: ${name}`);
	}
}

function parseDistribution(value: string | undefined): DistributionMode | undefined {
	if (value === undefined) return undefined;
	if (value === "binary" || value === "runtime") return value;
	throw new Error(`Invalid distribution "${value}". Expected "binary" or "runtime".`);
}

const app = new Crust("create-crust", { description: "Scaffold a new Crust CLI project" })
	.args({ name: "directory", type: "string", description: "Project directory to scaffold into" })
	.flags(
		{
			name: "distribution",
			type: "string",
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
	.action(async ({ args, flags }) => {
		// Resolve every decision before writing so cancellation cannot leave a partial project.
		const targetDir =
			args.directory ??
			(await input({
				message: "Project directory",
				default: "my-cli",
				validate: validateProjectName,
			}));
		const resolvedDir = resolve(process.cwd(), targetDir);
		const name = basename(resolvedDir);
		const selectedDistribution = parseDistribution(flags.distribution);
		const needsOverwrite =
			targetDir === "." ? readdirSync(resolvedDir).length > 0 : existsSync(resolvedDir);

		if (needsOverwrite) {
			if (flags.overwrite === true) {
				console.log(`Directory "${name}" already exists; overwriting (--overwrite).`);
			}
			const overwrite = await confirm({
				message:
					targetDir === "."
						? "Current directory is not empty. Overwrite conflicting files?"
						: `Directory "${name}" already exists. Overwrite?`,
				default: false,
				...(flags.overwrite !== undefined ? { initial: flags.overwrite } : {}),
			});
			if (!overwrite) {
				console.log("Aborted.");
				return;
			}
		}

		const distribution = await select<DistributionMode>({
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
			...(selectedDistribution ? { initial: selectedDistribution } : {}),
		});
		const install = await confirm({
			message: "Install dependencies?",
			default: true,
			...(flags.install !== undefined ? { initial: flags.install } : {}),
		});
		const gitCheckDir = existsSync(resolvedDir) ? resolvedDir : resolve(resolvedDir, "..");
		const initializeGit = isInGitRepo(gitCheckDir)
			? false
			: await confirm({
					message: "Initialize a git repository?",
					default: true,
					...(flags.git !== undefined ? { initial: flags.git } : {}),
				});

		const context = { name, ...TEMPLATE_VERSION_CONTEXT };
		await spinner({
			message: "Scaffolding project...",
			task: async () => {
				await scaffold({
					template: "templates/base",
					dest: resolvedDir,
					context,
					...(needsOverwrite ? { conflict: "overwrite" as const } : {}),
				});
				for (const template of ["templates/app", `templates/distribution/${distribution}`]) {
					await scaffold({ template, dest: resolvedDir, context, conflict: "overwrite" });
				}
			},
		});

		if (install) await runSteps([{ type: "install" }], resolvedDir);
		if (initializeGit) {
			await spinner({
				message: "Initializing git repository...",
				task: () => runSteps([{ type: "git-init", commit: "chore: initial commit" }], resolvedDir),
			});
		}

		console.log(`\nCreated ${name}!\n`);
		console.log("Next steps:");
		if (targetDir !== ".") {
			console.log(`  cd ${targetDir.startsWith("/") ? targetDir : `./${targetDir}`}`);
		}
		console.log("  bun run dev");
		console.log("  bun run build");
	});

await app.execute();
