import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { which } from "@crustjs/utils/process";
import { describe, expect, it } from "vite-plus/test";

import crustPackage from "../package.json" with { type: "json" };
import { type BuildCompiler, resolveNodeBuildRunner } from "./compilers.ts";
import {
	assertNodeExeBackendSupports,
	crustInstallPath,
	NODE_EXE_BACKEND_PACKAGES,
	nodeExeTarget,
	resolveNodeBinaryCompiler,
	resolveNodeExeBackend,
} from "./node-exe.ts";
import { NODE_TARGETS } from "./targets.ts";

async function withoutBunOnPath<T>(run: () => T): Promise<T> {
	const path = process.env.PATH;
	process.env.PATH = "";
	try {
		return await run();
	} finally {
		process.env.PATH = path;
	}
}

describe("nodeExeTarget", () => {
	it("maps each target to tsdown's executable target and npm metadata", () => {
		expect(
			NODE_TARGETS.targets.map((target) => [
				target,
				nodeExeTarget(target, "26.10.0"),
				NODE_TARGETS.info[target].platformKey,
			]),
		).toEqual([
			["linux-x64", { platform: "linux", arch: "x64", nodeVersion: "26.10.0" }, "linux-x64"],
			["linux-arm64", { platform: "linux", arch: "arm64", nodeVersion: "26.10.0" }, "linux-arm64"],
			["darwin-x64", { platform: "darwin", arch: "x64", nodeVersion: "26.10.0" }, "darwin-x64"],
			[
				"darwin-arm64",
				{ platform: "darwin", arch: "arm64", nodeVersion: "26.10.0" },
				"darwin-arm64",
			],
			["win-x64", { platform: "win", arch: "x64", nodeVersion: "26.10.0" }, "win32-x64"],
			["win-arm64", { platform: "win", arch: "arm64", nodeVersion: "26.10.0" }, "win32-arm64"],
		]);
		// Official Node Linux builds link glibc; npm must skip them on musl.
		expect(NODE_TARGETS.info["linux-arm64"].libc).toBe("glibc");
	});
});

describe("crustInstallPath", () => {
	it("resolves from the executable inside a compiled crust and from the module otherwise", () => {
		const exe = resolve("/pkg/node_modules/@crustjs/crust-linux-x64/bin/crust-bun-linux-x64");
		expect(crustInstallPath("file:///$bunfs/root/crust", exe)).toBe(exe);
		expect(crustInstallPath("file:///B:/~BUN/root/crust.exe", exe)).toBe(exe);
		const library = pathToFileURL(resolve("/pkg/node_modules/@crustjs/crust/dist/index.js"));
		expect(crustInstallPath(library.href, exe)).toBe(
			resolve("/pkg/node_modules/@crustjs/crust/dist/index.js"),
		);
	});
});

describe("Node binary compiler", () => {
	const nodePath = which("node");
	const backend = { version: "0.23.0", engines: "^22.18.0 || ^24.11.0 || >=26.0.0" };
	const nodeCompiler = (version: string): BuildCompiler => ({
		runtime: "node",
		runner: { command: "/opt/node/bin/node", env: {} },
		version,
	});

	it("tells tsdown's package engines apart from its executable minimum", () => {
		expect(() =>
			assertNodeExeBackendSupports(nodeCompiler("25.9.0"), { ...backend, seaMinVersion: "25.7.0" }),
		).toThrow(
			'Node 25.9.0 (/opt/node/bin/node) is not supported by tsdown 0.23.0, which builds node standalone binaries: its package requires Node "^22.18.0 || ^24.11.0 || >=26.0.0".\n' +
				"  Binaries embed the selected node's version; crust does not install or upgrade it.\n" +
				"  Put a supported node first on PATH (e.g. with your version manager).",
		);
		expect(() =>
			assertNodeExeBackendSupports(nodeCompiler("24.21.0"), {
				...backend,
				seaMinVersion: "25.7.0",
			}),
		).toThrow(
			"Node 24.21.0 (/opt/node/bin/node) cannot build standalone executables: tsdown 0.23.0's executable builder requires Node 25.7.0 or later.",
		);
		expect(() => assertNodeExeBackendSupports(nodeCompiler("24.21.0"), backend)).not.toThrow();
		expect(() =>
			assertNodeExeBackendSupports(nodeCompiler("26.10.0"), {
				...backend,
				seaMinVersion: "25.7.0",
			}),
		).not.toThrow();
	});

	it.skipIf(nodePath === null)(
		"reads both requirements from the tsdown installed with crust, under the selected node",
		async () => {
			const compiler = { ...nodeCompiler("24.21.0"), runner: resolveNodeBuildRunner() };
			await expect(resolveNodeExeBackend(compiler, process.cwd())).rejects.toThrow(
				`Node 24.21.0 (${nodePath}) cannot build standalone executables: tsdown 0.23.0's executable builder requires Node 25.7.0 or later.`,
			);
			await expect(
				resolveNodeExeBackend({ ...compiler, version: "25.9.0" }, process.cwd()),
			).rejects.toThrow('its package requires Node "^22.18.0 || ^24.11.0 || >=26.0.0"');
			const backendInstalled = await resolveNodeExeBackend(
				{ ...compiler, version: "26.10.0" },
				process.cwd(),
			);
			expect(backendInstalled).toMatchObject({ ...backend, seaMinVersion: "25.7.0" });
			expect(await realpath(backendInstalled.packageJsonPath)).toBe(
				await realpath(fileURLToPath(import.meta.resolve("tsdown/package.json"))),
			);
		},
	);

	it("never resolves the backend from outside crust's installation, even through NODE_PATH", async () => {
		const elsewhere = await mkdtemp(join(tmpdir(), "crust-no-backend-"));
		const nodePathEnv = process.env.NODE_PATH;
		// Where the repository's tsdown really lives; Node's require would fall back to it.
		process.env.NODE_PATH = resolve(
			fileURLToPath(import.meta.resolve("tsdown/package.json")),
			"..",
			"..",
		);
		try {
			const installPath = join(elsewhere, "bin", "crust");
			await expect(
				resolveNodeExeBackend(nodeCompiler("26.10.0"), process.cwd(), installPath),
			).rejects.toThrow(
				`tsdown, which builds node standalone binaries, is not installed with crust (${installPath}).\n  @crustjs/crust ships tsdown and @tsdown/exe as optional dependencies, which package managers skip when optional dependencies are disabled or the installing node does not satisfy tsdown's engines.\n  Reinstall @crustjs/crust with optional dependencies enabled`,
			);
		} finally {
			process.env.NODE_PATH = nodePathEnv;
			await rm(elsewhere, { recursive: true, force: true });
		}
	});

	it.skipIf(nodePath === null)(
		"uses only crust's pinned backend, never a consumer's, across npm and pnpm layouts",
		async () => {
			const pins = crustPackage.optionalDependencies;
			const dir = await realpath(await mkdtemp(join(tmpdir(), "crust-backend-layouts-")));
			// A loadable stand-in for a tsdown or @tsdown/exe package at `version`.
			const fakePackage = async (at: string, name: string, version: string) => {
				await mkdir(at, { recursive: true });
				await writeFile(
					join(at, "package.json"),
					JSON.stringify({
						name,
						version,
						type: "module",
						engines: { node: backend.engines },
						exports: { "./package.json": "./package.json", "./internal": "./internal.js" },
					}),
				);
				await writeFile(join(at, "internal.js"), 'export const NODE_SEA_MIN_VERSION = "25.7.0";\n');
			};
			const backendAt = async (modules: string, versions: Record<string, string> = pins) => {
				for (const name of NODE_EXE_BACKEND_PACKAGES) {
					await fakePackage(join(modules, name), name, versions[name]!);
				}
			};
			const compiler = { ...nodeCompiler("26.10.0"), runner: resolveNodeBuildRunner() };
			const resolveFrom = (installPath: string) =>
				resolveNodeExeBackend(compiler, process.cwd(), installPath);
			const consumer = { tsdown: "0.22.0", "@tsdown/exe": "0.22.0" };
			try {
				// npm, crust's optional backend omitted: only the project's own tsdown is reachable.
				const npm = join(dir, "npm", "node_modules");
				const npmCrust = join(npm, "@crustjs", "crust-linux-x64", "bin", "crust");
				await backendAt(npm, consumer);
				await expect(resolveFrom(npmCrust)).rejects.toThrow(
					`tsdown 0.22.0 (${join(npm, "tsdown", "package.json")}) is not the tsdown ${pins.tsdown} that crust builds node standalone binaries with.\n  @crustjs/crust ships tsdown and @tsdown/exe as optional dependencies`,
				);
				// npm nests crust's copy under a conflicting project tsdown.
				await backendAt(join(npm, "@crustjs", "crust-linux-x64", "node_modules"));
				await expect(resolveFrom(npmCrust)).resolves.toHaveProperty(
					"packageJsonPath",
					join(npm, "@crustjs", "crust-linux-x64", "node_modules", "tsdown", "package.json"),
				);
				// npm hoists crust's copy to the project's node_modules.
				const hoisted = join(dir, "npm-hoisted", "node_modules");
				await backendAt(hoisted);
				await expect(
					resolveFrom(join(hoisted, "@crustjs", "crust", "dist", "index.js")),
				).resolves.toHaveProperty("packageJsonPath", join(hoisted, "tsdown", "package.json"));

				// pnpm: crust's tsdown is a symlink beside it, @tsdown/exe beside tsdown's real directory;
				// a project tsdown is hoisted into .pnpm/node_modules and the project's node_modules.
				const pnpm = join(dir, "pnpm", "node_modules");
				const store = join(pnpm, ".pnpm");
				const crustModules = join(store, "@crustjs+crust@0.4.1", "node_modules");
				const pnpmCrust = join(crustModules, "@crustjs", "crust", "dist", "index.js");
				await backendAt(join(store, "node_modules"), consumer);
				await backendAt(pnpm, consumer);
				await mkdir(dirname(pnpmCrust), { recursive: true });
				await expect(resolveFrom(pnpmCrust)).rejects.toThrow("is not the tsdown");
				const tsdownModules = join(store, `tsdown@${pins.tsdown}`, "node_modules");
				await fakePackage(join(tsdownModules, "tsdown"), "tsdown", pins.tsdown);
				await symlink(join(tsdownModules, "tsdown"), join(crustModules, "tsdown"), "junction");
				// @tsdown/exe resolves from tsdown's real directory, here to the project's copy.
				await expect(resolveFrom(pnpmCrust)).rejects.toThrow(
					`@tsdown/exe 0.22.0 (${join(store, "node_modules", "@tsdown", "exe", "package.json")}) is not the @tsdown/exe ${pins["@tsdown/exe"]} that crust builds node standalone binaries with.`,
				);
				await fakePackage(
					join(tsdownModules, "@tsdown", "exe"),
					"@tsdown/exe",
					pins["@tsdown/exe"],
				);
				await expect(resolveFrom(pnpmCrust)).resolves.toMatchObject({
					packageJsonPath: join(crustModules, "tsdown", "package.json"),
					version: pins.tsdown,
				});
			} finally {
				await rm(dir, { recursive: true, force: true });
			}
		},
	);

	it.skipIf(nodePath === null)("checks engines.node before loading the backend", async () => {
		await expect(
			resolveNodeBinaryCompiler({ engines: { node: "0.0.1" } }, process.cwd()),
		).rejects.toThrow(/^Node \S+ \(.+\) does not satisfy package\.json engines\.node "0\.0\.1"\./);
	});

	it("reports a missing node instead of falling back to another runtime", async () => {
		await expect(
			withoutBunOnPath(() => resolveNodeBinaryCompiler({}, process.cwd())),
		).rejects.toThrow("Node is required for node standalone binaries but was not found on PATH.");
	});
});
