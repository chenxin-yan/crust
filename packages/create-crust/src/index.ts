#!/usr/bin/env node

import { existsSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { Crust, resolveArtifactDir } from "@crustjs/core";
import { isInGitRepo, runSteps, scaffold } from "@crustjs/create";
import { spinner } from "@crustjs/progress";
import { confirm, input, select } from "@crustjs/prompts";

import corePkg from "../../core/package.json" with { type: "json" };
import crustPkg from "../../crust/package.json" with { type: "json" };
import extensionsPkg from "../../extensions/package.json" with { type: "json" };

type Runtime = "bun" | "node" | "deno";

// `tsLib`/`tsTypes` are spliced into tsconfig arrays, so they carry their own JSON quoting.
// Deno reads the project tsconfig and a supplied `lib` replaces its default `deno.window`,
// which would drop `Deno`, `console`, and `process` from `deno check`.
// `shebang` heads src/cli.ts: package.json `bin` points at the source, so a linked
// command must start the project's runtime itself.
const RUNTIME_TEMPLATE_CONTEXT = {
	bun: { run: "bun run", shebang: "#!/usr/bin/env bun", tsLib: '"ESNext"', tsTypes: '"bun"' },
	node: { run: "npm run", shebang: "#!/usr/bin/env node", tsLib: '"ESNext"', tsTypes: '"node"' },
	deno: {
		run: "deno task",
		shebang: "#!/usr/bin/env -S deno run -A",
		tsLib: '"ESNext", "deno.window"',
		tsTypes: "",
	},
} satisfies Record<Runtime, { run: string; shebang: string; tsLib: string; tsTypes: string }>;

// The bundle inlines these JSON imports, so scaffolded package.json files pin
// the sibling package versions from the build that produced create-crust.
const CRUST_TEMPLATE_VERSION_CONTEXT = {
	crustCoreVersion: corePkg.version,
	crustExtensionsVersion: extensionsPkg.version,
	crustCliVersion: crustPkg.version,
};

// ────────────────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────────────────

// The resolved basename is spliced into package.json (`name`, `bin` key, `start`
// script path) and a quoted TS string, whatever its origin: positional argument,
// prompt, or the cwd for ".". Use the build bin-key subset, excluding Core's
// reserved command name. This is interpolation safety, not full npm-name validation.
const PROJECT_NAME_PATTERN = /^[A-Za-z0-9_~][A-Za-z0-9._~-]*$/;
function validateProjectName(name: string): void {
	if (name === "__proto__" || !PROJECT_NAME_PATTERN.test(name)) {
		throw new Error(
			`Project name ${JSON.stringify(name)} is not safe for the generated project.\n  The directory basename becomes the package and command name: use letters, digits, ".", "_", "~", and "-", not starting with "." or "-"; "__proto__" is reserved.`,
		);
	}
}

// The prompt accepts a directory path, so parent segments only need to be
// path-safe; the basename must also pass the project-name check.
const INVALID_PATH_CHARS = /[<>:"|?*\\]/;
function validateProjectDirectory(path: string): void {
	if (!path) {
		throw new Error("Project directory cannot be empty");
	}
	if (INVALID_PATH_CHARS.test(path)) {
		throw new Error(`Project directory contains invalid characters: ${path}`);
	}
	validateProjectName(basename(resolve(path)));
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
				validate: validateProjectDirectory,
			}));

		const resolvedDir = resolve(process.cwd(), targetDir);
		const dirName = basename(resolvedDir);
		validateProjectName(dirName);
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
					hint: "standalone binaries per platform, published as npm packages",
				},
				{
					label: "Node.js",
					value: "node",
					hint: "one JavaScript bundle, published as a single npm package",
				},
				{
					label: "Deno",
					value: "deno",
					hint: "standalone binaries per platform, published as npm packages",
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

		// `templates` is a crust.include directory staged next to this bundle.
		const templatePath = (template: string) => join(resolveArtifactDir("templates"), template);
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
					template: templatePath("base"),
					dest: resolvedDir,
					context,
					...(overwrite ? { conflict: "overwrite" } : {}),
				});
				await scaffold({
					template: templatePath(`runtime/${runtime}`),
					dest: resolvedDir,
					context,
					conflict: "overwrite",
				});
			},
		});

		if (installDeps) {
			// The generic install step only detects npm-style package managers and falls
			// back to npm, which a Deno-only machine lacks; Deno installs package.json
			// dependencies itself.
			await runSteps(
				[runtime === "deno" ? { type: "command", cmd: "deno install" } : { type: "install" }],
				resolvedDir,
			);
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
