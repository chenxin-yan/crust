// Host artifact acceptance: public build -> npm pack -> npm install -> execute
// for the Node package, Bun binary, and Deno binary modes, on this host only
// (no cross-target builds), so it runs natively on Linux, macOS, and Windows.
// Each app is a real Crust command with a bundled application dependency and a
// crust.include asset, built from published-style installed dependencies, and
// run from an unrelated cwd after its source project is deleted. Missing tools
// or unbuilt workspace dists fail the tests instead of skipping them.
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

import { Crust } from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";
import { which } from "@crustjs/utils/process";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

import { buildCommand } from "../src/commands/build.ts";
import type { BuildRuntime } from "../src/utils/build-helpers.ts";
import type { ArtifactKind, DistributionManifest } from "../src/utils/distribute.ts";
import { reapBoundedProcesses, runBoundedProcess } from "./bounded-process.ts";
import { hostDenoTarget, hostTarget } from "./helpers.ts";

// Shared by every mode: dispatch (required arg + flag), a bare-specifier
// dependency that exists only in the source project, and a shipped asset.
// getBuiltinModule instead of node: imports, which \`deno compile\` only
// type-checks with @types/node installed; global process keeps Bun's
// PUBLIC_* inlining (it rewrites only the global \`process.env.X\`).
const ENTRY = `import { Crust, resolveArtifactDir } from "@crustjs/core";
import { punctuation } from "fixture-punctuation";

const { readFileSync } = process.getBuiltinModule("node:fs");
const { join } = process.getBuiltinModule("node:path");
const deno = (globalThis as { Deno?: { version: { deno: string } } }).Deno;
const runtime = deno
	? "deno " + deno.version.deno
	: process.versions.bun
		? "bun " + process.versions.bun
		: "node " + process.versions.node;
await new Crust("greet", { version: "0.1.0" })
	.args({ name: "name", type: "string", required: true })
	.flags({ name: "shout", type: "boolean" })
	.action(({ args, flags, stdout }) => {
		const greeting = "hello " + args.name + punctuation;
		stdout(JSON.stringify({
			greeting: flags.shout ? greeting.toUpperCase() : greeting,
			runtime,
			asset: readFileSync(join(resolveArtifactDir("assets"), "greeting.txt"), "utf8").trim(),
			publicMessage: process.env.PUBLIC_MESSAGE ?? null,
			secretMessage: process.env.SECRET_MESSAGE ?? null,
		}));
	})
	.execute();
`;

const originalCwd = process.cwd;
// Created in beforeAll, not at collection, so a filtered-out run creates nothing.
// Real path: macOS tmpdir is a symlink; Windows may report an 8.3 short name.
let root = "";
let libPacks = "";
let elsewhere = "";
let coreVersion = "";
/** Packed tarballs: `@crustjs/core`, `@crustjs/utils`, and `fixture-punctuation`. */
const tarballs: Record<string, string> = {};

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf8")) as T;
}

function requireTool(name: string): string {
	const path = which(name);
	if (!path) throw new Error(`${name} is required for host artifact acceptance.`);
	return path;
}

async function run(command: string, args: readonly string[], cwd: string, timeout = 60_000) {
	const result = await runBoundedProcess(command, args, { cwd, timeout });
	expect(result.exitCode, `${command} ${args.join(" ")}\n${result.stderr}`).toBe(0);
	return result;
}

/** Relative with forward slashes: npm accepts it on every OS. */
function fileSpec(from: string, tarball: string): string {
	return `file:${relative(from, tarball).replaceAll("\\", "/")}`;
}

async function npmPack(dir: string, destination: string): Promise<string> {
	mkdirSync(destination, { recursive: true });
	const packed = await run(
		requireTool("npm"),
		["pack", dir, "--pack-destination", destination],
		dir,
	);
	return join(destination, packed.stdout.trim().split("\n").at(-1)!);
}

async function npmInstall(dir: string, dependencies: Record<string, string>): Promise<void> {
	writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "install-only", dependencies }));
	// --legacy-peer-deps: core's typescript peer is not needed and not offline.
	await run(
		requireTool("npm"),
		["install", "--offline", "--no-audit", "--no-fund", "--ignore-scripts", "--legacy-peer-deps"],
		dir,
	);
}

/**
 * Writes the app into `<root>/<mode>/project` with Crust and the fixture
 * dependency installed from tarballs, then builds it. Returns the project dir,
 * the build stdout, and the staged manifest.
 */
async function buildProject(
	mode: string,
	crust: { runtime: BuildRuntime; artifact: ArtifactKind },
	argv: readonly string[],
	files: Record<string, string> = {},
) {
	const project = join(root, mode, "project");
	mkdirSync(join(project, "src"), { recursive: true });
	mkdirSync(join(project, "assets"));
	writeFileSync(join(project, "assets", "greeting.txt"), "hello from assets\n");
	writeFileSync(join(project, "src", "greet.ts"), ENTRY);
	for (const [name, content] of Object.entries(files)) writeFileSync(join(project, name), content);
	await npmInstall(
		project,
		Object.fromEntries(
			Object.entries(tarballs).map(([name, path]) => [name, fileSpec(project, path)]),
		),
	);
	// As if installed from the registry: Deno checks these ranges against node_modules.
	writeFileSync(
		join(project, "package.json"),
		JSON.stringify({
			name: `@crust-fixture/${mode}`,
			version: "0.1.0",
			type: "module",
			bin: { greet: "src/greet.ts" },
			crust: { include: ["assets"], ...crust },
			dependencies: { "@crustjs/core": `^${coreVersion}`, "fixture-punctuation": "^1.0.0" },
		}),
	);
	process.cwd = () => project;
	let result: Awaited<ReturnType<typeof captureExecute>>;
	try {
		result = await captureExecute(new Crust("test").add(buildCommand), ["build", ...argv]);
	} finally {
		process.cwd = originalCwd;
	}
	expect(result.exitCode, result.stderr).toBe(0);
	const manifest = readJson<DistributionManifest>(join(project, ".crust", "manifest.json"));
	return { project, stdout: result.stdout, manifest };
}

/** Packs every staged package, installs them into a fresh consumer with npm, and deletes the project. */
async function installStaged(mode: string, project: string, manifest: DistributionManifest) {
	const packs = join(root, mode, "packs");
	const consumer = join(root, mode, "consumer");
	mkdirSync(consumer);
	const dependencies: Record<string, string> = {};
	for (const dir of ["root", ...manifest.packages.map((pkg) => pkg.dir)]) {
		const staged = join(project, ".crust", dir);
		const { name } = readJson<{ name: string }>(join(staged, "package.json"));
		dependencies[name] = fileSpec(consumer, await npmPack(staged, packs));
	}
	await npmInstall(consumer, dependencies);
	// Neither the source project, its node_modules, nor its build output is needed any more.
	rmSync(project, { recursive: true, force: true });
	return consumer;
}

/** Runs the command from the unrelated cwd and returns its parsed JSON output. */
async function greet(command: string, args: readonly string[]) {
	const result = await runBoundedProcess(command, [...args, "world", "--shout"], {
		cwd: elsewhere,
		timeout: 60_000,
	});
	expect(result.exitCode, result.stderr).toBe(0);
	return JSON.parse(result.stdout.trim()) as unknown;
}

/** Core's dispatch error path inside the shipped bundle. */
async function expectUnknownFlag(command: string, args: readonly string[]) {
	const result = await runBoundedProcess(command, [...args, "--definitely-not-a-flag"], {
		cwd: elsewhere,
		timeout: 60_000,
	});
	expect(result.exitCode).toBe(1);
	expect(result.stderr).toContain("Unknown flag");
}

async function toolVersion(command: string, pattern: RegExp): Promise<string> {
	const { stdout } = await run(requireTool(command), ["--version"], root, 10_000);
	return pattern.exec(stdout)![1]!;
}

afterEach(reapBoundedProcesses);

describe("host artifact acceptance", () => {
	beforeAll(async () => {
		root = join(
			realpathSync.native(tmpdir()),
			`crust-host-artifacts-${randomBytes(6).toString("hex")}`,
		);
		libPacks = join(root, "lib-packs");
		elsewhere = join(root, "elsewhere");
		mkdirSync(elsewhere, { recursive: true });
		mkdirSync(libPacks);
		for (const name of ["core", "utils"]) {
			const dir = resolve(import.meta.dirname, "..", "..", name);
			// Fail, not skip: CI must build the workspace dists before this suite.
			statSync(join(dir, "dist"));
			if (name === "core")
				coreVersion = readJson<{ version: string }>(join(dir, "package.json")).version;
			// pnpm rewrites workspace ranges as on publish.
			const packed = await run(
				requireTool("pnpm"),
				["pack", "--ignore-scripts", "--pack-destination", libPacks],
				dir,
			);
			tarballs[`@crustjs/${name}`] = resolve(libPacks, packed.stdout.trim().split("\n").at(-1)!);
		}
		const dependency = join(root, "fixture-punctuation");
		mkdirSync(dependency);
		writeFileSync(
			join(dependency, "package.json"),
			JSON.stringify({
				name: "fixture-punctuation",
				version: "1.0.0",
				type: "module",
				exports: "./index.js",
			}),
		);
		writeFileSync(join(dependency, "index.js"), 'export const punctuation = "!";\n');
		tarballs["fixture-punctuation"] = await npmPack(dependency, libPacks);
	}, 120_000);

	afterAll(async () => {
		await reapBoundedProcesses();
		process.cwd = originalCwd;
		if (root) rmSync(root, { recursive: true, force: true });
	});

	it("Node package: installed CLI runs under Node with PUBLIC_* env-file values only", async () => {
		const node = requireTool("node");
		const { project, stdout, manifest } = await buildProject(
			"node-package",
			{ runtime: "node", artifact: "package" },
			["--env-file", ".env.build"],
			{ ".env.build": "PUBLIC_MESSAGE=hello-from-build\nSECRET_MESSAGE=private\n" },
		);
		expect(stdout).toContain("Runtime: node (from package.json)");
		expect(stdout).toContain("Artifact: package");
		expect(manifest).toMatchObject({
			runtime: "node",
			artifact: "package",
			packages: [],
			publishOrder: ["root"],
		});
		expect(manifest).not.toHaveProperty("embeddedRuntimeVersion");
		const stagedRoot = join(project, ".crust", "root");
		const stagedPackageJson = readJson<object>(join(stagedRoot, "package.json"));
		expect(stagedPackageJson).toMatchObject({
			bin: { greet: "bin/greet.js" },
			files: ["bin", "assets"],
		});
		expect(stagedPackageJson).not.toHaveProperty("dependencies");
		const bundlePath = join(stagedRoot, "bin", "greet.js");
		const bundle = readFileSync(bundlePath, "utf8");
		expect(bundle.startsWith("#!/usr/bin/env node\n")).toBe(true);
		if (process.platform !== "win32") expect(statSync(bundlePath).mode & 0o111).not.toBe(0);
		// The marker is inlined as a literal, not read from the environment.
		expect(bundle).not.toContain("process.env.CRUST_INTERNAL_BUILD");
		expect(bundle).not.toContain("SECRET_MESSAGE=private");

		const nodeVersion = await toolVersion("node", /^v(\S+)/);
		const consumer = await installStaged("node-package", project, manifest);
		// npm's .bin shim: a symlink on POSIX, `greet.cmd` on Windows.
		const bin = join(
			consumer,
			"node_modules",
			".bin",
			process.platform === "win32" ? "greet.cmd" : "greet",
		);
		expect(await greet(bin, [])).toEqual({
			greeting: "HELLO WORLD!",
			runtime: `node ${nodeVersion}`,
			asset: "hello from assets",
			publicMessage: "hello-from-build",
			secretMessage: null,
		});
		await expectUnknownFlag(bin, []);
		// Same installed bundle through the consumer's node, as a package-manager-free entry.
		const installedBundle = join(consumer, "node_modules", "@crust-fixture", "node-package");
		expect(await greet(node, [join(installedBundle, "bin", "greet.js")])).toMatchObject({
			greeting: "HELLO WORLD!",
			asset: "hello from assets",
		});
	}, 180_000);

	// Direct native binary and root launcher: `.bin` may select the platform
	// binary itself (both packages are direct dependencies), bypassing the resolver.
	for (const mode of [
		{
			name: "Bun binary",
			dir: "bun-binary",
			runtime: "bun",
			target: hostTarget,
			version: () => toolVersion("bun", /^(\S+)/),
		},
		{
			name: "Deno binary",
			dir: "deno-binary",
			runtime: "deno",
			target: hostDenoTarget,
			version: () => toolVersion("deno", /^deno (\S+)/),
		},
	] as const) {
		it(`${mode.name}: installed native binary and root launcher run with the embedded runtime`, async () => {
			const node = requireTool("node");
			const runtimeVersion = await mode.version();
			const target = mode.target();
			if (!target)
				throw new Error(`Unsupported ${mode.runtime} host: ${process.platform}-${process.arch}`);
			const { project, stdout, manifest } = await buildProject(
				mode.dir,
				{ runtime: mode.runtime, artifact: "binary" },
				["--target", "host"],
			);
			expect(stdout).toContain(`Runtime: ${mode.runtime}`);
			expect(stdout).toContain("Artifact: binary");
			const [platform] = manifest.packages;
			expect(manifest).toMatchObject({
				runtime: mode.runtime,
				artifact: "binary",
				embeddedRuntimeVersion: runtimeVersion,
				publishOrder: [platform!.dir, "root"],
			});
			expect(manifest.packages).toHaveLength(1);
			const expected = {
				greeting: "HELLO WORLD!",
				runtime: `${mode.runtime} ${runtimeVersion}`,
				asset: "hello from assets",
				publicMessage: null,
				secretMessage: null,
			};
			// In place, as a project's `start` script runs it: the launcher finds the sibling stage.
			expect(await greet(node, [join(project, ".crust", "root", "bin", "greet.js")])).toEqual(
				expected,
			);

			const consumer = await installStaged(mode.dir, project, manifest);
			const platformDir = join(consumer, "node_modules", platform!.name);
			const platformBin = readJson<{ bin: Record<string, string> }>(
				join(platformDir, "package.json"),
			).bin.greet!;
			expect(platformBin).toBe(`bin/greet-${target}${process.platform === "win32" ? ".exe" : ""}`);
			const binary = join(platformDir, platformBin);
			const launcher = join(
				consumer,
				"node_modules",
				"@crust-fixture",
				mode.dir,
				"bin",
				"greet.js",
			);
			expect(await greet(binary, [])).toEqual(expected);
			expect(await greet(node, [launcher])).toEqual(expected);
			await expectUnknownFlag(binary, []);
			await expectUnknownFlag(node, [launcher]);
		}, 240_000);
	}
});
