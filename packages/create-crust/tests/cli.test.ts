import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { withTerminalIO } from "@crustjs/prompts";
import { createPromptIO } from "@crustjs/prompts/testing";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import corePackage from "../../core/package.json";
import crustPackage from "../../crust/package.json";
import { BUN_TARGETS, NODE_TARGETS } from "../../crust/src/targets.ts";
import { reapBoundedProcesses, runBoundedProcess } from "../../crust/tests/bounded-process.ts";
import extensionsPackage from "../../extensions/package.json";
import testingPackage from "../../testing/package.json";
import type { RunProcessResult } from "../../utils/src/process.ts";
import packageJson from "../package.json";
import { app } from "../src/index.ts";

const packageRoot = resolve(import.meta.dirname, "..");
const builtCliPath = join(packageRoot, ".crust", "root", "bin", "create-crust.js");
const tempRoots: string[] = [];

function makeTempRoot(label: string): string {
	const dir = mkdtempSync(join(tmpdir(), `${label}-`));
	tempRoots.push(dir);
	return dir;
}

async function runCreateCrust(
	args: string[],
	options?: { cwd?: string; entrypoint?: string; userAgent?: string },
): Promise<RunProcessResult> {
	const env = { ...process.env };
	delete env.npm_config_user_agent;
	if (options?.userAgent !== "") env.npm_config_user_agent = options?.userAgent ?? "npm/11.0.0";
	return runBoundedProcess("node", [options?.entrypoint ?? builtCliPath, ...args], {
		cwd: options?.cwd ?? packageRoot,
		env,
		// Below the 30s test timeout, so a hung CLI fails with its output.
		timeout: 20_000,
	});
}

afterEach(async () => {
	await reapBoundedProcesses();
	for (const root of tempRoots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

describe("create-crust CLI", () => {
	beforeAll(() => {
		if (!existsSync(builtCliPath)) {
			throw new Error(
				`Built CLI not found at ${builtCliPath}. Run the package build before tests (e.g. pnpm run build in this package or pnpm run test).`,
			);
		}
	});

	it.each([
		["bun", "binary"],
		["node", "package"],
	])(
		"scaffolds a %s project with the default %s artifact non-interactively",
		async (runtime, artifact) => {
			const projectDir = join(makeTempRoot("create-crust-cli"), "my-cli");

			const result = await runCreateCrust([
				projectDir,
				"--runtime",
				runtime,
				"--no-install",
				"--no-git",
			]);

			expect(result.exitCode).toBe(0);
			expect(result.stderr).not.toContain("Error:");
			expect(result.stdout).toContain("Created my-cli!");
			expect(result.stdout).toContain("npm run dev");
			expectManifest(readFileSync(join(projectDir, "package.json"), "utf-8"), runtime, artifact);
			const tsconfig = JSON.parse(readFileSync(join(projectDir, "tsconfig.json"), "utf-8"));
			expect(tsconfig.compilerOptions.lib).toEqual(["ESNext"]);
			expect(tsconfig.compilerOptions.types).toEqual([runtime]);
			const cli = readFileSync(join(projectDir, "src", "cli.ts"), "utf-8");
			// `bin` points at the source, so the linked command needs the runtime's shebang.
			expect(cli.startsWith(`#!/usr/bin/env ${runtime}\n`)).toBe(true);
			expect(cli).toContain("await app.execute();");
			const app = readFileSync(join(projectDir, "src", "app.ts"), "utf-8");
			expect(app).toContain('export const app = new Crust("my-cli"');
			expect(app).toContain("version: pkg.version");
			expect(app).toContain('import pkg from "../package.json" with { type: "json" };');
			const test = readFileSync(join(projectDir, "src", "app.test.ts"), "utf-8");
			expect(test).toContain("captureExecute(app,");
			const gitignore = readFileSync(join(projectDir, ".gitignore"), "utf-8");
			expect(gitignore).toContain("node_modules");
			expect(gitignore).toContain(".crust");
			const readme = readFileSync(join(projectDir, "README.md"), "utf-8");
			expect(readme).toContain("# my-cli");
			expect(readme).toContain("npm run dev");
			expect(readme).toContain("npm run release");
			if (runtime === "node") expect(readme).not.toContain("bun run");
			expect(existsSync(join(projectDir, "node_modules"))).toBe(false);
			expect(existsSync(join(projectDir, ".git"))).toBe(false);
		},
		30_000,
	);

	it("uses the destination lockfile for instructions before installation", async () => {
		const projectDir = join(makeTempRoot("create-crust-lockfile"), "my-cli");
		mkdirSync(projectDir);
		writeFileSync(join(projectDir, "pnpm-lock.yaml"), "");

		const result = await runCreateCrust([
			projectDir,
			"--runtime",
			"node",
			"--overwrite",
			"--no-install",
			"--no-git",
		]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("  pnpm install\n  pnpm run dev");
		expect(readFileSync(join(projectDir, "README.md"), "utf-8")).toContain("pnpm run dev");
	});

	// Run by path, as in `node create-crust.js`: no package manager sets a user agent.
	it.each([
		["bun", "bun"],
		["node", "npm"],
	])(
		"uses the %s runtime's package manager when none is detected",
		async (runtime, pm) => {
			const projectDir = join(makeTempRoot("create-crust-runtime-pm"), "other-cli");

			const result = await runCreateCrust(
				[projectDir, "--runtime", runtime, "--no-install", "--no-git"],
				{ userAgent: "" },
			);

			expect(result.exitCode, result.stderr).toBe(0);
			expect(result.stdout).toContain(`  ${pm} install\n  ${pm} run dev`);
			expect(readFileSync(join(projectDir, "README.md"), "utf-8")).toContain(`${pm} run test`);
			expect(readFileSync(join(projectDir, "src", "app.ts"), "utf-8")).toContain(
				'new Crust("other-cli"',
			);
		},
		30_000,
	);

	it.each(["bundle", "source"])(
		"finds %s templates through a .bin entry in another package root",
		async (mode) => {
			// npx and bun x run the CLI via <cache>/node_modules/.bin/create-crust, so process.argv[1]
			// walks up to the cache's package.json, not to create-crust's own package root.
			const tempRoot = makeTempRoot("create-crust-shim");
			const binDir = join(tempRoot, "node_modules", ".bin");
			mkdirSync(binDir, { recursive: true });
			writeFileSync(join(tempRoot, "package.json"), '{"name":"launcher-cache"}', "utf-8");
			const shim = join(binDir, mode === "source" ? "create-crust" : "create-crust.mjs");
			if (mode === "source") {
				symlinkSync(join(packageRoot, "src", "cli.ts"), shim, "file");
			} else {
				writeFileSync(shim, `await import(${JSON.stringify(pathToFileURL(builtCliPath).href)});\n`);
			}
			const projectDir = join(tempRoot, "my-cli");

			const result = await runCreateCrust(
				[projectDir, "--runtime", "bun", "--no-install", "--no-git"],
				{ cwd: tempRoot, entrypoint: shim },
			);

			expect(result.stderr).not.toContain("to copy does not exist");
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("Created my-cli!");
			expect(existsSync(join(projectDir, "src", "cli.ts"))).toBe(true);
			const pkg = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf-8"));
			expect(pkg.scripts.dev).toBe("bun run src/cli.ts");
		},
		30_000,
	);

	// Checks what the scaffolder interpolates, not the template's static content.
	const expectManifest = (text: string, runtime: string, artifact: string) => {
		const name = "my-cli";
		const pkg = JSON.parse(text);
		expect(text).toBe(`${JSON.stringify(pkg, null, "\t")}\n`);
		expect(pkg).toMatchObject({
			name,
			// `crust publish` publishes `.crust/`; refuse a stray `npm publish` of the build input.
			private: true,
			bin: { [name]: "src/cli.ts" },
			scripts: {
				dev: { bun: "bun run src/cli.ts", node: "node src/cli.ts" }[runtime],
				build: "crust build",
				release: "crust build && crust publish",
				// A binary's Node launcher runs the binary built for this machine.
				start: `${artifact === "binary" ? "node" : runtime} .crust/root/bin/${name}.js`,
				test: { bun: "bun test", node: 'node --test "src/**/*.test.ts"' }[runtime],
			},
			dependencies: {
				"@crustjs/core": `^${corePackage.version}`,
				"@crustjs/extensions": `^${extensionsPackage.version}`,
			},
			devDependencies: {
				"@crustjs/crust": `^${crustPackage.version}`,
				"@crustjs/testing": `^${testingPackage.version}`,
				[`@types/${runtime}`]: expect.any(String),
			},
		});
		expect("engines" in pkg).toBe(runtime === "node");
		// A binary release ships exactly crust.targets: every target of the runtime until trimmed.
		const table = runtime === "bun" ? BUN_TARGETS : NODE_TARGETS;
		expect(pkg.crust).toEqual({
			runtime,
			artifact,
			...(artifact === "binary" ? { targets: [...table.targets] } : {}),
		});
	};

	for (const runtime of ["bun", "node"]) {
		it.each(["package", "binary"])(
			`scaffolds ${runtime} with explicit artifact %s`,
			async (artifact) => {
				const projectDir = join(makeTempRoot("create-crust-artifact"), "my-cli");
				const result = await runCreateCrust([
					projectDir,
					"--runtime",
					runtime,
					"--artifact",
					artifact,
					"--no-install",
					"--no-git",
				]);
				expect(result.exitCode, result.stderr).toBe(0);
				expectManifest(readFileSync(join(projectDir, "package.json"), "utf8"), runtime, artifact);
				const readme = readFileSync(join(projectDir, "README.md"), "utf8");
				expect(readme).toContain(`Runtime: **${runtime}**`);
				expect(readme).toContain(`Build output: **${artifact}**`);
				expect(readme).toContain("npm is optional");
			},
		);
	}

	// Deno support was removed; a dropped runtime must stay rejected, not silently scaffolded.
	it("rejects --runtime deno before writing anything", async () => {
		const projectDir = join(makeTempRoot("create-crust-deno"), "my-cli");

		const result = await runCreateCrust([
			projectDir,
			"--runtime",
			"deno",
			"--no-install",
			"--no-git",
		]);

		expect(result.exitCode).not.toBe(0);
		expect(result.stderr).toContain("Invalid value for --runtime. Expected one of: bun, node");
		expect(existsSync(projectDir)).toBe(false);
	}, 30_000);

	it.each(["--help", "-h"])(
		"prints usage for %s without scaffolding",
		async (flag) => {
			const tempRoot = makeTempRoot("create-crust-help");

			const result = await runCreateCrust([flag], { cwd: tempRoot });

			expect(result.exitCode, result.stderr).toBe(0);
			expect(result.stdout).toContain("Usage:");
			expect(result.stdout).toContain("--runtime");
			expect(readdirSync(tempRoot)).toEqual([]);
		},
		30_000,
	);

	it("prints its version for --version", async () => {
		const result = await runCreateCrust(["--version"]);

		expect(result.exitCode, result.stderr).toBe(0);
		expect(result.stdout).toContain(packageJson.version);
	}, 30_000);

	// The basename becomes the package name, bin key, and a quoted TS string, so
	// positional input must meet the same command-name contract as the prompt.
	it("rejects an unsafe project directory basename before writing anything", async () => {
		const dirName = 'bad"name';
		const tempRoot = makeTempRoot("create-crust-bad-name");
		const projectDir = join(tempRoot, dirName);

		const result = await runCreateCrust([
			projectDir,
			"--runtime",
			"node",
			"--no-install",
			"--no-git",
		]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			`Error: Project name ${JSON.stringify(dirName)} is not safe for the generated project.`,
		);
		expect(existsSync(projectDir)).toBe(false);
	}, 30_000);

	// Without a terminal the overwrite prompt takes its default, no.
	it.each([[["--no-overwrite"]], [[]]])(
		"fails without writing when the destination exists, given %j",
		async (flags) => {
			const tempRoot = makeTempRoot("create-crust-no-overwrite");
			const projectDir = join(tempRoot, "existing-cli");
			mkdirSync(projectDir, { recursive: true });
			writeFileSync(join(projectDir, "sentinel.txt"), "keep me", "utf-8");

			const result = await runCreateCrust([
				projectDir,
				"--runtime",
				"bun",
				"--no-install",
				"--no-git",
				...flags,
			]);

			expect(result.exitCode).toBe(1);
			expect(result.stdout).toBe("");
			expect(result.stderr).toContain(
				'Directory "existing-cli" already exists. Pass --overwrite to write into it.',
			);
			expect(readFileSync(join(projectDir, "sentinel.txt"), "utf-8")).toBe("keep me");
			expect(existsSync(join(projectDir, "package.json"))).toBe(false);
		},
		30_000,
	);

	it("ends without an error when the overwrite prompt is answered no", async () => {
		const projectDir = join(makeTempRoot("create-crust-declined"), "existing-cli");
		mkdirSync(projectDir);
		writeFileSync(join(projectDir, "sentinel.txt"), "keep me", "utf-8");
		const terminal = createPromptIO();

		const outcome = withTerminalIO(terminal.io, () =>
			app.run([], {
				args: { directory: projectDir },
				flags: { runtime: "bun", install: false, git: false },
			}),
		);
		await vi.waitFor(() => expect(terminal.screen()).toContain("already exists. Overwrite?"));
		terminal.keys("enter");

		expect(await outcome).toMatchObject({ status: "completed", stdout: "Aborted." });
		expect(readdirSync(projectDir)).toEqual(["sentinel.txt"]);
	});

	it("fails when the current directory is not empty and --overwrite is not passed", async () => {
		const tempRoot = makeTempRoot("create-crust-dot-non-empty");
		writeFileSync(join(tempRoot, "sentinel.txt"), "keep me", "utf-8");

		const result = await runCreateCrust([".", "--runtime", "bun", "--no-install", "--no-git"], {
			cwd: tempRoot,
		});

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			"The current directory is not empty. Pass --overwrite to write into it.",
		);
		expect(readFileSync(join(tempRoot, "sentinel.txt"), "utf-8")).toBe("keep me");
		expect(existsSync(join(tempRoot, "package.json"))).toBe(false);
	}, 30_000);

	it("scaffolds into a non-empty current directory when --overwrite is passed", async () => {
		const tempRoot = makeTempRoot("create-crust-dot-overwrite");
		writeFileSync(join(tempRoot, "package.json"), '{"name":"old"}', "utf-8");

		const result = await runCreateCrust(
			[".", "--runtime", "bun", "--no-install", "--no-git", "--overwrite"],
			{ cwd: tempRoot },
		);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).not.toContain("Error:");
		expect(existsSync(join(tempRoot, "src", "cli.ts"))).toBe(true);
		const pkg = JSON.parse(readFileSync(join(tempRoot, "package.json"), "utf-8"));
		expect(pkg.name).toBe(basename(tempRoot));
	}, 30_000);

	it('scaffolds into an empty current directory given "." without prompting', async () => {
		const tempRoot = makeTempRoot("create-crust-dot-empty");

		const result = await runCreateCrust([".", "--runtime", "bun", "--no-install", "--no-git"], {
			cwd: tempRoot,
		});

		expect(result.exitCode).toBe(0);
		expect(result.stderr).not.toContain("Error:");
		expect(existsSync(join(tempRoot, "package.json"))).toBe(true);
		expect(result.stdout).not.toContain("  cd ");
	}, 30_000);

	// Windows always double-quotes the target and joins it with a backslash.
	it.each(
		process.platform === "win32"
			? [
					["nested-cli", '"./nested-cli"'],
					["my apps/nested-cli", String.raw`"./my apps\nested-cli"`],
				]
			: [
					["nested-cli", "./nested-cli"],
					["./nested-cli", "./nested-cli"],
					["my apps/nested-cli", "'./my apps/nested-cli'"],
				],
	)(
		"prints a cd step for %j as %j",
		async (directory, cdTarget) => {
			const tempRoot = makeTempRoot("create-crust-cd-step");

			const result = await runCreateCrust(
				[directory, "--runtime", "bun", "--no-install", "--no-git"],
				{ cwd: tempRoot },
			);

			expect(result.exitCode, result.stderr).toBe(0);
			expect(result.stdout).toContain(`  cd ${cdTarget}\n`);
		},
		30_000,
	);

	// Missing intermediate directories must not hide the enclosing repository.
	it("skips git initialization for a destination with missing parents inside a repository, even when --git is passed", async () => {
		const tempRoot = makeTempRoot("create-crust-git-repo");
		const repoRoot = join(tempRoot, "repo");
		const projectDir = join(repoRoot, "missing-parent", "inside-repo-cli");
		mkdirSync(repoRoot, { recursive: true });

		const gitInit = await runBoundedProcess("git", ["init"], { cwd: repoRoot, timeout: 10_000 });
		expect(gitInit.exitCode).toBe(0);

		const result = await runCreateCrust([projectDir, "--runtime", "bun", "--no-install", "--git"]);

		expect(result.exitCode, result.stderr).toBe(0);
		expect(existsSync(join(projectDir, "package.json"))).toBe(true);
		expect(existsSync(join(projectDir, ".git"))).toBe(false);
	}, 30_000);

	it("initializes git for a destination with missing parents outside any repository", async () => {
		const tempRoot = makeTempRoot("create-crust-git-outside");
		const projectDir = join(tempRoot, "missing-parent", "outside-repo-cli");
		const probe = await runBoundedProcess("git", ["rev-parse", "--is-inside-work-tree"], {
			cwd: tempRoot,
			timeout: 10_000,
		});
		expect(probe.exitCode, "temp directory must be outside any Git repository").not.toBe(0);

		const result = await runCreateCrust([projectDir, "--runtime", "bun", "--no-install", "--git"]);

		expect(result.exitCode, result.stderr).toBe(0);
		expect(existsSync(join(projectDir, ".git"))).toBe(true);
	}, 30_000);
});
