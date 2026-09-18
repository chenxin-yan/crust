import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import corePackage from "../../core/package.json";
import crustPackage from "../../crust/package.json";
import extensionsPackage from "../../extensions/package.json";

const packageRoot = resolve(import.meta.dir, "..");
const builtCliPath = join(packageRoot, ".crust", "root", "bin", "create-crust.js");
const tempRoots: string[] = [];
// Every runtime template ships exactly these scripts.
const templateScriptKeys = ["build", "check:types", "dev", "release", "start"];

function makeTempRoot(label: string): string {
	const dir = join(tmpdir(), `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	tempRoots.push(dir);
	return dir;
}

async function runCreateCrust(
	args: string[],
	options?: { env?: Record<string, string>; cwd?: string; entrypoint?: string },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const proc = Bun.spawn(["node", options?.entrypoint ?? builtCliPath, ...args], {
		cwd: options?.cwd ?? packageRoot,
		env: {
			...process.env,
			...options?.env,
		},
		stdout: "pipe",
		stderr: "pipe",
	});

	return {
		exitCode: await proc.exited,
		stdout: await new Response(proc.stdout).text(),
		stderr: await new Response(proc.stderr).text(),
	};
}

afterEach(() => {
	for (const root of tempRoots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

describe("create-crust CLI", () => {
	beforeAll(() => {
		if (!existsSync(builtCliPath)) {
			throw new Error(
				`Built CLI not found at ${builtCliPath}. Run the package build before tests (e.g. bun run build in this package or turbo run test).`,
			);
		}
	});

	it("scaffolds a project non-interactively when flags are provided", async () => {
		const tempRoot = makeTempRoot("create-crust-cli");
		const projectDir = join(tempRoot, "my-cli");

		const result = await runCreateCrust([
			projectDir,
			"--runtime",
			"bun",
			"--no-install",
			"--no-git",
		]);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).not.toContain("Error:");
		expect(result.stdout).toContain("Created my-cli!");
		const pkg = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf-8"));
		expect(pkg).toMatchObject({
			$schema: "./node_modules/@crustjs/crust/schema/package.json",
			name: "my-cli",
			version: "0.0.0",
			type: "module",
			crust: { runtime: "bun" },
			bin: { "my-cli": "src/cli.ts" },
			scripts: {
				dev: "bun run src/cli.ts",
				build: "crust build",
				release: "crust publish",
				start: "bun .crust/root/bin/my-cli.js",
				"check:types": "tsc --noEmit",
			},
			dependencies: {
				"@crustjs/core": `^${corePackage.version}`,
				"@crustjs/extensions": `^${extensionsPackage.version}`,
			},
			devDependencies: {
				"@crustjs/crust": `^${crustPackage.version}`,
				"@types/bun": "latest",
			},
		});
		expect(pkg.devDependencies["@crustjs/core"]).toBeUndefined();
		expect(pkg.devDependencies["@crustjs/extensions"]).toBeUndefined();
		expect(pkg.files).toBeUndefined();
		expect(Object.keys(pkg.scripts).sort()).toEqual(templateScriptKeys);
		const tsconfig = JSON.parse(readFileSync(join(projectDir, "tsconfig.json"), "utf-8"));
		expect(tsconfig.compilerOptions.lib).toEqual(["ESNext"]);
		expect(tsconfig.compilerOptions.types).toEqual(["bun"]);
		const cli = readFileSync(join(projectDir, "src", "cli.ts"), "utf-8");
		// `bin` points at the source, so the linked command needs the runtime's shebang.
		expect(cli.startsWith("#!/usr/bin/env bun\n")).toBe(true);
		expect(cli).toContain('new Crust("my-cli"');
		expect(cli).toContain(".execute()");
		expect(cli).toContain("help()");
		expect(cli).toContain("version: pkg.version");
		expect(cli).toContain("version()");
		expect(cli).toContain('import pkg from "../package.json" with { type: "json" };');
		const gitignore = readFileSync(join(projectDir, ".gitignore"), "utf-8");
		expect(gitignore).toContain("node_modules");
		expect(gitignore).toContain(".crust");
		const readme = readFileSync(join(projectDir, "README.md"), "utf-8");
		expect(readme).toContain("# my-cli");
		expect(readme).toContain("bun run dev");
		expect(readme).toContain("bun run release");
		expect(readme).not.toContain("{{");
		expect(existsSync(join(projectDir, "node_modules"))).toBe(false);
		expect(existsSync(join(projectDir, ".git"))).toBe(false);
	}, 30_000);

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
				symlinkSync(join(packageRoot, "src", "index.ts"), shim, "file");
			} else {
				writeFileSync(shim, `await import(${JSON.stringify(pathToFileURL(builtCliPath).href)});\n`);
			}
			const projectDir = join(tempRoot, "my-cli");

			const result = await runCreateCrust(
				[projectDir, "--runtime", "bun", "--no-install", "--no-git"],
				{ cwd: tempRoot, entrypoint: shim },
			);

			expect(result.stderr).not.toContain("Template directory");
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("Created my-cli!");
			expect(existsSync(join(projectDir, "src", "cli.ts"))).toBe(true);
			const pkg = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf-8"));
			expect(pkg.scripts.dev).toBe("bun run src/cli.ts");
		},
		30_000,
	);

	it("scaffolds a Node runtime project through the real CLI", async () => {
		const tempRoot = makeTempRoot("create-crust-node");
		const projectDir = join(tempRoot, "node-cli");

		const result = await runCreateCrust([
			projectDir,
			"--runtime",
			"node",
			"--no-install",
			"--no-git",
		]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("npm run dev");
		const pkg = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf-8"));
		expect(pkg).toMatchObject({
			$schema: "./node_modules/@crustjs/crust/schema/package.json",
			crust: { runtime: "node" },
			bin: { "node-cli": "src/cli.ts" },
			scripts: {
				dev: "node src/cli.ts",
				build: "crust build",
				release: "crust publish",
				start: "node .crust/root/bin/node-cli.js",
				"check:types": "tsc --noEmit",
			},
			engines: { node: ">=22.18" },
			dependencies: {
				"@crustjs/core": `^${corePackage.version}`,
				"@crustjs/extensions": `^${extensionsPackage.version}`,
			},
			devDependencies: {
				"@crustjs/crust": `^${crustPackage.version}`,
				"@types/node": "^22",
			},
		});
		expect(pkg.files).toBeUndefined();
		expect(Object.keys(pkg.scripts).sort()).toEqual(templateScriptKeys);
		const tsconfig = JSON.parse(readFileSync(join(projectDir, "tsconfig.json"), "utf-8"));
		expect(tsconfig.compilerOptions.lib).toEqual(["ESNext"]);
		expect(tsconfig.compilerOptions.types).toEqual(["node"]);
		expect(
			readFileSync(join(projectDir, "src", "cli.ts"), "utf-8").startsWith("#!/usr/bin/env node\n"),
		).toBe(true);
		const readme = readFileSync(join(projectDir, "README.md"), "utf-8");
		expect(readme).toContain("npm run dev");
		expect(readme).not.toContain("bun run");
	}, 30_000);

	it("scaffolds a Deno runtime project through the real CLI", async () => {
		const tempRoot = makeTempRoot("create-crust-deno");
		const projectDir = join(tempRoot, "deno-cli");

		const result = await runCreateCrust([
			projectDir,
			"--runtime",
			"deno",
			"--no-install",
			"--no-git",
		]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("deno task dev");
		const pkg = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf-8"));
		expect(pkg).toMatchObject({
			$schema: "./node_modules/@crustjs/crust/schema/package.json",
			crust: { runtime: "deno" },
			bin: { "deno-cli": "src/cli.ts" },
			scripts: {
				dev: "deno run -A src/cli.ts",
				build: "crust build",
				release: "crust publish",
				start: "deno run -A .crust/root/bin/deno-cli.js",
				"check:types": "deno check src/cli.ts",
			},
			dependencies: {
				"@crustjs/core": `^${corePackage.version}`,
				"@crustjs/extensions": `^${extensionsPackage.version}`,
			},
			devDependencies: { "@crustjs/crust": `^${crustPackage.version}` },
		});
		expect(pkg.files).toBeUndefined();
		expect(Object.keys(pkg.scripts).sort()).toEqual(templateScriptKeys);
		expect(pkg.devDependencies.typescript).toBeUndefined();
		const tsconfig = JSON.parse(readFileSync(join(projectDir, "tsconfig.json"), "utf-8"));
		expect(tsconfig.compilerOptions.lib).toEqual(["ESNext", "deno.window"]);
		expect(tsconfig.compilerOptions.types).toEqual([]);
		expect(
			readFileSync(join(projectDir, "src", "cli.ts"), "utf-8").startsWith(
				"#!/usr/bin/env -S deno run -A\n",
			),
		).toBe(true);
		const readme = readFileSync(join(projectDir, "README.md"), "utf-8");
		expect(readme).toContain("deno task dev");
		expect(readme).not.toContain("bun run");
	}, 30_000);

	it("installs a Deno runtime project with deno install", async () => {
		const tempRoot = makeTempRoot("create-crust-deno-install");
		const projectDir = join(tempRoot, "deno-cli");
		// A fake `deno` on PATH records its argv so the test proves the CLI runs
		// `deno install` instead of the detected npm-style package manager.
		const binDir = join(tempRoot, "bin");
		const argvLog = join(tempRoot, "deno-argv.txt");
		mkdirSync(binDir);
		if (process.platform === "win32") {
			writeFileSync(join(binDir, "deno.cmd"), `@echo %*> "${argvLog}"\r\n`);
		} else {
			const shim = join(binDir, "deno");
			writeFileSync(shim, `#!/bin/sh\necho "$@" > "${argvLog}"\n`);
			chmodSync(shim, 0o755);
		}

		const result = await runCreateCrust(
			[projectDir, "--runtime", "deno", "--install", "--no-git"],
			{ env: { PATH: `${binDir}${delimiter}${process.env.PATH}` } },
		);

		expect(result.exitCode).toBe(0);
		expect(readFileSync(argvLog, "utf-8").trim()).toBe("install");
		expect(existsSync(join(projectDir, "package-lock.json"))).toBe(false);
	}, 30_000);

	it("fails with a clear error for an invalid runtime", async () => {
		const tempRoot = makeTempRoot("create-crust-invalid-runtime");
		const projectDir = join(tempRoot, "bad-runtime");

		const result = await runCreateCrust([
			projectDir,
			"--runtime",
			"invalid",
			"--no-install",
			"--no-git",
		]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			'Error: Invalid value "invalid" for --runtime. Expected one of: bun, node, deno',
		);
		expect(existsSync(projectDir)).toBe(false);
	}, 30_000);

	// The basename becomes the package name, bin key, and a quoted TS string, so
	// positional input must meet the same command-name contract as the prompt.
	it.each(['bad"name', "bad name", ".hidden-cli", "-leading-dash", "__proto__"])(
		"rejects the project directory basename %j before writing anything",
		async (dirName) => {
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
		},
		30_000,
	);

	it("rejects scaffolding into a current directory whose basename is not a valid name", async () => {
		const tempRoot = makeTempRoot("create-crust-bad-dot");
		const projectDir = join(tempRoot, "has space");
		mkdirSync(projectDir);

		const result = await runCreateCrust([".", "--runtime", "bun", "--no-install", "--no-git"], {
			cwd: projectDir,
		});

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			'Error: Project name "has space" is not safe for the generated project.',
		);
		expect(readdirSync(projectDir)).toEqual([]);
	}, 30_000);

	it("aborts cleanly when the destination exists and --no-overwrite is passed", async () => {
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
			"--no-overwrite",
		]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Aborted.");
		expect(readFileSync(join(projectDir, "sentinel.txt"), "utf-8")).toBe("keep me");
		expect(existsSync(join(projectDir, "package.json"))).toBe(false);
	}, 30_000);

	it("aborts scaffolding into a non-empty current directory without --overwrite", async () => {
		const tempRoot = makeTempRoot("create-crust-dot-non-empty");
		writeFileSync(join(tempRoot, "sentinel.txt"), "keep me", "utf-8");

		const result = await runCreateCrust(
			[".", "--runtime", "bun", "--no-install", "--no-git", "--no-overwrite"],
			{ cwd: tempRoot },
		);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Aborted.");
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

	it("scaffolds into an empty current directory without prompting", async () => {
		const tempRoot = makeTempRoot("create-crust-dot-empty");

		const result = await runCreateCrust([".", "--runtime", "bun", "--no-install", "--no-git"], {
			cwd: tempRoot,
		});

		expect(result.exitCode).toBe(0);
		expect(result.stderr).not.toContain("Error:");
		expect(existsSync(join(tempRoot, "package.json"))).toBe(true);
	}, 30_000);

	it("skips git initialization inside an existing repository even when --git is passed", async () => {
		const tempRoot = makeTempRoot("create-crust-git-repo");
		const repoRoot = join(tempRoot, "repo");
		const projectName = "inside-repo-cli";
		const projectDir = join(repoRoot, projectName);
		mkdirSync(repoRoot, { recursive: true });

		const gitInit = Bun.spawnSync(["git", "init"], {
			cwd: repoRoot,
			stdout: "ignore",
			stderr: "pipe",
		});
		expect(gitInit.exitCode).toBe(0);

		const result = await runCreateCrust([projectDir, "--runtime", "bun", "--no-install", "--git"]);

		expect(result.exitCode).toBe(0);
		expect(existsSync(join(projectDir, "package.json"))).toBe(true);
		expect(existsSync(join(projectDir, ".git"))).toBe(false);
	}, 30_000);
});
