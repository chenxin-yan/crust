#!/usr/bin/env node

import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import { Crust, resolveArtifactDir } from "@crustjs/core";
import { INSTALLED_COMMAND_NAME_RULE, isInstalledCommandName } from "@crustjs/core/tooling";
import { detectPackageManager, isInGitRepo, runSteps, scaffold } from "@crustjs/create";
import type { BuildOptions } from "@crustjs/crust";
import { spinner } from "@crustjs/progress";
import { confirm, input, select } from "@crustjs/prompts";
import { Eta } from "eta/core";

import corePkg from "../../core/package.json" with { type: "json" };
import crustPkg from "../../crust/package.json" with { type: "json" };
import extensionsPkg from "../../extensions/package.json" with { type: "json" };

type Runtime = "bun" | "node" | "deno";

// `tsLib`/`tsTypes` are spliced into tsconfig arrays, so they carry their own JSON quoting.
// Deno reads the project tsconfig and a supplied `lib` replaces its default `deno.window`,
// which would drop `Deno`, `console`, and `process` from `deno check`.
// `shebang` heads src/cli.ts: package.json `bin` points at the source, so a linked
// command must start the project's runtime itself. The runtime's package.json
// differences live in templates/base/package.json.
const RUNTIMES = {
	bun: { shebang: "#!/usr/bin/env bun", tsLib: '"ESNext"', tsTypes: '"bun"' },
	node: { shebang: "#!/usr/bin/env node", tsLib: '"ESNext"', tsTypes: '"node"' },
	deno: { shebang: "#!/usr/bin/env -S deno run -A", tsLib: '"ESNext", "deno.window"', tsTypes: "" },
} satisfies Record<Runtime, { shebang: string; tsLib: string; tsTypes: string }>;

// `eta/core` renders template strings only: no file loading or includes. Templates
// are trusted package code, not sandboxed. Generated files are never HTML, so output
// is raw, and whitespace is trimmed only where a tag asks for it (`-%>`).
const eta = new Eta({ autoEscape: false, autoTrim: false });

// ────────────────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────────────────

// The resolved basename is spliced into package.json (`name`, `bin` key, `start`
// script path) and a quoted TS string, whatever its origin: positional argument,
// prompt, or the cwd. This is interpolation safety, not full npm-name validation.
function validateProjectName(name: string): void {
	if (!isInstalledCommandName(name)) {
		throw new Error(
			`Project name ${JSON.stringify(name)} is not safe for the generated project.\n  The directory basename becomes the package and command name: use ${INSTALLED_COMMAND_NAME_RULE}.`,
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
			name: "artifact",
			type: "string",
			choices: ["package", "binary"],
			description: "Build output: runtime package or standalone binary",
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

		const targetDir =
			args.directory ??
			(await input({
				message: "Project directory",
				default: "my-cli",
				validate: validateProjectDirectory,
			}));

		const resolvedDir = resolve(process.cwd(), targetDir);
		const isCwd = resolvedDir === process.cwd();
		const name = basename(resolvedDir);
		validateProjectName(name);

		// Ask before writing into an existing destination. The cwd always exists,
		// so it only needs confirmation when non-empty; any other directory
		// prompts whenever it already exists.
		const needsOverwriteConfirm = isCwd
			? readdirSync(resolvedDir).length > 0
			: existsSync(resolvedDir);
		let overwrite = false;
		if (needsOverwriteConfirm) {
			overwrite = await confirm({
				message: isCwd
					? "Current directory is not empty. Overwrite conflicting files?"
					: `Directory "${name}" already exists. Overwrite?`,
				default: false,
				initial: flags.overwrite,
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
					hint: "Bun APIs and TypeScript execution",
				},
				{
					label: "Node.js",
					value: "node",
					hint: "Node.js APIs and ecosystem",
				},
				{
					label: "Deno",
					value: "deno",
					hint: "Deno APIs and permission model",
				},
			],
			default: "bun",
			initial: flags.runtime,
		});
		const artifact = await select<NonNullable<BuildOptions["artifact"]>>({
			message: "Build output",
			choices: [
				{
					label: "Standalone binary",
					value: "binary",
					hint: "Embeds the runtime; users need no separate JavaScript runtime",
				},
				{
					label: "Runtime package",
					value: "package",
					hint:
						runtime === "deno"
							? "Requires Deno installed; experimental bundling"
							: "JavaScript bundle; requires the selected runtime installed",
				},
			],
			default: runtime === "node" ? "package" : "binary",
			initial: flags.artifact,
		});
		const installDeps = await confirm({
			message: "Install dependencies?",
			default: true,
			initial: flags.install,
		});

		// Skip git init prompt if already inside a git repository. Git cannot run
		// in a directory scaffold has not created yet, so probe the nearest
		// existing ancestor (resolvedDir itself for "." or overwrite).
		let gitCheckDir = resolvedDir;
		while (!existsSync(gitCheckDir) && dirname(gitCheckDir) !== gitCheckDir) {
			gitCheckDir = dirname(gitCheckDir);
		}
		const alreadyInRepo = isInGitRepo(gitCheckDir);
		const initGit = alreadyInRepo
			? false
			: await confirm({
					message: "Initialize a git repository?",
					default: true,
					initial: flags.git,
				});

		// ── Execute all file operations after prompts are done ──────────

		const packageManager = runtime === "deno" ? "deno" : detectPackageManager(resolvedDir);
		// The bundle inlines the sibling package.json imports, so scaffolded projects
		// pin the Crust versions from the build that produced create-crust.
		const context = {
			name,
			runtime,
			artifact,
			run: packageManager === "deno" ? "deno task" : `${packageManager} run`,
			install: `${packageManager} install`,
			...RUNTIMES[runtime],
			coreVersion: corePkg.version,
			extensionsVersion: extensionsPkg.version,
			crustVersion: crustPkg.version,
		};
		// Scaffolding produces no console output, so it is safe inside a spinner.
		await spinner({
			message: "Scaffolding project...",
			task: () =>
				scaffold({
					// `templates` is a crust.include directory staged next to this bundle.
					template: join(resolveArtifactDir("templates"), "base"),
					dest: resolvedDir,
					context,
					render: (source, data) => eta.renderString(source, data),
					conflict: overwrite ? "overwrite" : "abort",
				}),
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

		console.log(`\nCreated ${name}!\n`);
		console.log("Next steps:");
		if (!isCwd) {
			const cdTarget =
				isAbsolute(targetDir) || targetDir.startsWith(".") ? targetDir : `./${targetDir}`;
			console.log(`  cd ${cdTarget}`);
		}
		if (!installDeps) console.log(`  ${context.install}`);
		console.log(`  ${context.run} dev`);
		console.log(`  ${context.run} build`);
	});

await app.execute();
