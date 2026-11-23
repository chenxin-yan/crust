import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, relative } from "node:path";

import { Crust, artifactPath } from "@crustjs/core";
import { INSTALLED_COMMAND_NAME_RULE, isInstalledCommandName } from "@crustjs/core/tooling";
import {
	detectPackageManager,
	isInGitRepo,
	type PackageManager,
	runSteps,
	scaffold,
} from "@crustjs/create";
import type { BuildOptions } from "@crustjs/crust";
import { help, version } from "@crustjs/extensions";
import { spinner } from "@crustjs/progress";
import { confirm, input, select } from "@crustjs/prompts";
import { resolveUserPath } from "@crustjs/utils/path";
import { shellQuote } from "@crustjs/utils/process";
import { Eta } from "eta/core";

import corePkg from "../../core/package.json" with { type: "json" };
import crustPkg from "../../crust/package.json" with { type: "json" };
import extensionsPkg from "../../extensions/package.json" with { type: "json" };
import testingPkg from "../../testing/package.json" with { type: "json" };
import pkg from "../package.json" with { type: "json" };

type Runtime = "bun" | "node";
type Artifact = NonNullable<BuildOptions["artifact"]>;

// `eta/core` renders template strings only: no file loading or includes. Templates
// are trusted package code, not sandboxed. Generated files are never HTML, so output
// is raw, and whitespace is trimmed only where a tag asks for it (`-%>`).
const eta = new Eta({ autoEscape: false, autoTrim: false });

// ────────────────────────────────────────────────────────────────────────────
// Generated files
// ────────────────────────────────────────────────────────────────────────────

/** `templates` is a crust.include directory staged next to this bundle. */
function readTemplate(path: string): string {
	return readFileSync(artifactPath(`templates/${path}`), "utf8");
}

function json(value: unknown): string {
	return `${JSON.stringify(value, null, "\t")}\n`;
}

/**
 * The files `templates/base` cannot hold as they are. The bundle inlines the sibling
 * package.json imports, so scaffolded projects pin the Crust versions from the build
 * that produced create-crust.
 */
function projectFiles(
	name: string,
	runtime: Runtime,
	artifact: Artifact,
	packageManager: PackageManager,
): Record<string, string> {
	const manifest = {
		$schema: "./node_modules/@crustjs/crust/schema/package.json",
		name,
		version: "0.0.0",
		// `crust publish` publishes `.crust/`; refuse a stray `npm publish` of the build input.
		private: true,
		type: "module",
		description: "A CLI built with Crust",
		crust: { runtime, artifact },
		bin: { [name]: "src/cli.ts" },
		scripts: {
			dev: { bun: "bun run src/cli.ts", node: "node src/cli.ts" }[runtime],
			build: "crust build",
			release: "crust publish",
			// A binary's launcher is a Node script that runs the binary built for this machine.
			start: `${artifact === "binary" ? "node" : runtime} .crust/root/bin/${name}.js`,
			// Early Node 24 releases' default pattern skips .ts files.
			test: { bun: "bun test", node: 'node --test "src/**/*.test.ts"' }[runtime],
			"check:types": "tsc --noEmit",
		},
		...(runtime === "node" ? { engines: { node: ">=24" } } : {}),
		dependencies: {
			"@crustjs/core": `^${corePkg.version}`,
			"@crustjs/extensions": `^${extensionsPkg.version}`,
		},
		devDependencies: {
			"@crustjs/crust": `^${crustPkg.version}`,
			"@crustjs/testing": `^${testingPkg.version}`,
			...(runtime === "bun" ? { "@types/bun": "latest" } : { "@types/node": "^24" }),
			typescript: "^7.0.2",
		},
	};
	const tsconfig = {
		compilerOptions: {
			lib: ["ESNext"],
			types: [runtime],
			target: "ESNext",
			module: "Preserve",
			moduleDetection: "force",
			moduleResolution: "bundler",
			allowImportingTsExtensions: true,
			verbatimModuleSyntax: true,
			noEmit: true,
			strict: true,
			skipLibCheck: true,
			noFallthroughCasesInSwitch: true,
			noUncheckedIndexedAccess: true,
		},
		include: ["src"],
	};
	return {
		"package.json": json(manifest),
		"tsconfig.json": json(tsconfig),
		"README.md": eta.renderString(readTemplate("README.md"), {
			name,
			runtime,
			artifact,
			run: `${packageManager} run`,
			install: `${packageManager} install`,
		}),
		"src/app.ts": readTemplate("base/src/app.ts").replace(
			'new Crust("my-cli"',
			`new Crust(${JSON.stringify(name)}`,
		),
		// package.json `bin` points at the source, so a linked command starts the runtime itself.
		"src/cli.ts": readTemplate("base/src/cli.ts").replace(
			"#!/usr/bin/env node",
			`#!/usr/bin/env ${runtime}`,
		),
	};
}

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

// The prompt accepts a directory path like the positional; only its basename is checked.
function validateProjectDirectory(path: string): void {
	if (!path) {
		throw new Error("Project directory cannot be empty");
	}
	validateProjectName(basename(resolveUserPath(path)));
}

// ────────────────────────────────────────────────────────────────────────────
// Command definition
// ────────────────────────────────────────────────────────────────────────────

export const app = new Crust("create-crust", {
	description: pkg.description,
	version: pkg.version,
})
	.extend(version(), help())
	.flags({
		runtime: {
			type: "string",
			choices: ["bun", "node"],
			description: 'Runtime to develop and build for ("bun" or "node")',
		},
		artifact: {
			type: "string",
			choices: ["package", "binary"],
			description: "Build output: runtime package or standalone binary",
		},
		install: {
			type: "boolean",
			negatable: true,
			description: "Install dependencies after scaffolding (--no-install to skip)",
		},
		git: {
			type: "boolean",
			negatable: true,
			description: "Initialize a git repository after scaffolding (--no-git to skip)",
		},
		overwrite: {
			type: "boolean",
			negatable: true,
			description:
				"Overwrite the destination directory if it already exists (--no-overwrite to abort)",
		},
	})
	.args({
		name: "directory",
		type: "path",
		description: "Project directory to scaffold into",
	})
	.action(async ({ args, flags, stdout, stderr }) => {
		// ── Collect all prompts before any file operations ──────────────
		// This ensures a mid-prompt Ctrl+C won't leave partially scaffolded files.

		const resolvedDir =
			args.directory ??
			resolveUserPath(
				await input({
					message: "Project directory",
					default: "my-cli",
					validate: validateProjectDirectory,
				}),
			);
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
				throw new Error(
					`${isCwd ? "The current directory is not empty" : `Directory "${name}" already exists`}. Pass --overwrite to write into it.`,
				);
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
			],
			default: "bun",
			initial: flags.runtime,
		});
		const artifact = await select<Artifact>({
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
					hint: "JavaScript bundle; requires the selected runtime installed",
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

		// Run by path, no package manager is named: use the one that comes with the runtime.
		const packageManager = detectPackageManager(resolvedDir) ?? (runtime === "bun" ? "bun" : "npm");
		// Scaffolding produces no console output, so it is safe inside a spinner.
		await spinner({
			message: "Scaffolding project...",
			task: () =>
				scaffold({
					template: artifactPath("templates/base"),
					dest: resolvedDir,
					files: projectFiles(name, runtime, artifact, packageManager),
					conflict: overwrite ? "overwrite" : "abort",
				}),
		});

		if (installDeps) {
			await runSteps([{ type: "install", packageManager }], resolvedDir, { stderr });
		}

		if (initGit) {
			await spinner({
				message: "Initializing git repository...",
				task: () =>
					runSteps([{ type: "git-init", commit: "chore: initial commit" }], resolvedDir, {
						stderr,
					}),
			});
		}

		stdout(`\nCreated ${name}!\n`);
		stdout("Next steps:");
		if (!isCwd) {
			const fromCwd = relative(process.cwd(), resolvedDir);
			const outsideCwd = isAbsolute(fromCwd) || fromCwd.startsWith("..");
			const target = outsideCwd ? resolvedDir : `./${fromCwd}`;
			// cmd.exe has no single quotes; a Windows path cannot contain a double quote.
			const word = process.platform === "win32" ? `"${target}"` : shellQuote(target);
			stdout(`  cd ${word}`);
		}
		if (!installDeps) stdout(`  ${packageManager} install`);
		stdout(`  ${packageManager} run dev`);
		stdout(`  ${packageManager} run build`);
	});
