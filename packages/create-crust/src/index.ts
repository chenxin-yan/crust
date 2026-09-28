#!/usr/bin/env node

import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { Crust, resolveArtifactDir } from "@crustjs/core";
import { detectPackageManager, isInGitRepo, runSteps, scaffold } from "@crustjs/create";
import type { BuildOptions } from "@crustjs/crust";
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
// The remaining fields are the runtime's package.json differences; `startRunner`
// runs the built bin. Deno type-checks natively, so it needs no TypeScript packages.
const RUNTIMES = {
	bun: {
		shebang: "#!/usr/bin/env bun",
		tsLib: '"ESNext"',
		tsTypes: '"bun"',
		dev: "bun run src/cli.ts",
		startRunner: "bun",
		checkTypes: "tsc --noEmit",
		engines: undefined,
		devDependencies: { "@types/bun": "latest", typescript: "^7.0.2" },
	},
	node: {
		shebang: "#!/usr/bin/env node",
		tsLib: '"ESNext"',
		tsTypes: '"node"',
		dev: "node src/cli.ts",
		startRunner: "node",
		checkTypes: "tsc --noEmit",
		engines: { node: ">=22.18" },
		devDependencies: { "@types/node": "^22", typescript: "^7.0.2" },
	},
	deno: {
		shebang: "#!/usr/bin/env -S deno run -A",
		tsLib: '"ESNext", "deno.window"',
		tsTypes: "",
		dev: "deno run -A src/cli.ts",
		startRunner: "deno run -A",
		checkTypes: "deno check src/cli.ts",
		engines: undefined,
		devDependencies: {},
	},
} satisfies Record<
	Runtime,
	{
		shebang: string;
		tsLib: string;
		tsTypes: string;
		dev: string;
		startRunner: string;
		checkTypes: string;
		engines: Record<string, string> | undefined;
		devDependencies: Record<string, string>;
	}
>;

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
			...(runtimeInitial !== undefined ? { initial: runtimeInitial } : {}),
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
			...(flags.artifact !== undefined ? { initial: flags.artifact } : {}),
		});
		const installDeps = await confirm({
			message: "Install dependencies?",
			default: true,
			...(flags.install !== undefined ? { initial: flags.install } : {}),
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
					...(flags.git !== undefined ? { initial: flags.git } : {}),
				});

		// ── Execute all file operations after prompts are done ──────────

		// Infer package name from directory
		const name = dirName;

		// `templates` is a crust.include directory staged next to this bundle.
		const templatePath = (template: string) => join(resolveArtifactDir("templates"), template);
		const packageManager = runtime === "deno" ? "deno" : detectPackageManager(resolvedDir);
		const { shebang, tsLib, tsTypes, dev, startRunner, checkTypes, engines, devDependencies } =
			RUNTIMES[runtime];
		// The bundle inlines the sibling package.json imports, so scaffolded projects
		// pin the Crust versions from the build that produced create-crust.
		const packageJson = {
			$schema: "./node_modules/@crustjs/crust/schema/package.json",
			name,
			version: "0.0.0",
			private: true,
			type: "module",
			description: "A CLI built with Crust",
			crust: { runtime, artifact },
			bin: { [name]: "src/cli.ts" },
			scripts: {
				dev,
				build: "crust build",
				release: "crust publish",
				start: `${startRunner} .crust/root/bin/${name}.js`,
				"check:types": checkTypes,
			},
			engines,
			dependencies: {
				"@crustjs/core": `^${corePkg.version}`,
				"@crustjs/extensions": `^${extensionsPkg.version}`,
			},
			devDependencies: { "@crustjs/crust": `^${crustPkg.version}`, ...devDependencies },
		};
		const context = {
			name,
			runtime,
			artifact,
			run: packageManager === "deno" ? "deno task" : `${packageManager} run`,
			install: `${packageManager} install`,
			shebang,
			tsLib,
			tsTypes,
			// JSON.stringify omits `engines` when it is undefined (Bun, Deno).
			packageJson: JSON.stringify(packageJson, null, "\t"),
		};
		// Scaffolding produces no console output, so it is safe inside a spinner.
		await spinner({
			message: "Scaffolding project...",
			task: () =>
				scaffold({
					template: templatePath("base"),
					dest: resolvedDir,
					context,
					...(overwrite ? { conflict: "overwrite" } : {}),
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

		// Print success message
		console.log(`\nCreated ${name}!\n`);
		console.log("Next steps:");
		if (targetDir !== ".") {
			const relativeDir = targetDir.startsWith("/") ? targetDir : `./${targetDir}`;
			console.log(`  cd ${relativeDir}`);
		}
		if (!installDeps) console.log(`  ${context.install}`);
		console.log(`  ${context.run} dev`);
		console.log(`  ${context.run} build`);
	});

await app.execute();
