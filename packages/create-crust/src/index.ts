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

type Runtime = "bun" | "node" | "deno";

// `tsLib`/`tsTypes` are spliced into tsconfig arrays, so they carry their own JSON quoting.
// Deno reads the project tsconfig and a supplied `lib` replaces its default `deno.window`,
// which would drop `Deno`, `console`, and `process` from `deno check`.
const RUNTIME_TEMPLATE_CONTEXT = {
	bun: { run: "bun run", tsLib: '"ESNext"', tsTypes: '"bun"' },
	node: { run: "npm run", tsLib: '"ESNext"', tsTypes: '"node"' },
	deno: { run: "deno task", tsLib: '"ESNext", "deno.window"', tsTypes: "" },
} satisfies Record<Runtime, { run: string; tsLib: string; tsTypes: string }>;

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
			name: "runtime",
			type: "string",
			choices: ["bun", "node", "deno"],
			description: 'Runtime to develop and build for ("bun", "node", or "deno")',
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
		const runtimeInitial = flags.runtime;

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

		const runtime = await select<Runtime>({
			message: "Runtime",
			choices: [
				{
					label: "Bun (recommended)",
					value: "bun",
					hint: "compile with crust build, publish per-platform npm packages",
				},
				{
					label: "Node.js",
					value: "node",
					hint: "bundle with crust build, publish one npm package that runs on Node",
				},
				{
					label: "Deno",
					value: "deno",
					hint: "compile with crust build, ship self-contained executables",
				},
			],
			default: "bun",
			...(runtimeInitial !== undefined ? { initial: runtimeInitial } : {}),
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

		// Shipped templates belong to this module, not the user's working directory.
		const templateUrl = (template: string) => new URL(`../templates/${template}`, import.meta.url);
		// Scaffolding produces no console output, so it is safe inside a spinner.
		const context = {
			name,
			...RUNTIME_TEMPLATE_CONTEXT[runtime],
			...CRUST_TEMPLATE_VERSION_CONTEXT,
		};
		await spinner({
			message: "Scaffolding project...",
			task: async () => {
				await scaffold({
					template: templateUrl("base"),
					dest: resolvedDir,
					context,
					...(overwrite ? { conflict: "overwrite" } : {}),
				});
				await scaffold({
					template: templateUrl("minimal"),
					dest: resolvedDir,
					context,
					conflict: "overwrite",
				});
				await scaffold({
					template: templateUrl(`runtime/${runtime}`),
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
		console.log(`  ${context.run} dev`);
		console.log(`  ${context.run} build`);
	});

await app.execute();
