import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
	BUILD_OUT_DIR_ENV,
	isPackagedBuild,
	PACKAGED_BUILD_KEY,
	resolveArtifactDir,
} from "./artifacts.ts";

let tmpDir: string;
let originalArgv1: string | undefined;
let originalMarker: string | undefined;
let originalBuildOutDir: string | undefined;

beforeEach(async () => {
	tmpDir = await mkdtemp(join(tmpdir(), "crust-artifacts-"));
	originalArgv1 = process.argv[1];
	originalMarker = process.env.CRUST_INTERNAL_BUILD;
	originalBuildOutDir = process.env[BUILD_OUT_DIR_ENV];
	delete process.env.CRUST_INTERNAL_BUILD;
	delete process.env[BUILD_OUT_DIR_ENV];
});

afterEach(async () => {
	if (originalArgv1 === undefined) process.argv.length = 1;
	else process.argv[1] = originalArgv1;
	if (originalMarker === undefined) delete process.env.CRUST_INTERNAL_BUILD;
	else process.env.CRUST_INTERNAL_BUILD = originalMarker;
	if (originalBuildOutDir === undefined) delete process.env[BUILD_OUT_DIR_ENV];
	else process.env[BUILD_OUT_DIR_ENV] = originalBuildOutDir;
	await rm(tmpDir, { recursive: true, force: true });
});

function withDenoGlobal<T>(value: { build: { standalone: boolean } }, run: () => T): T {
	Object.defineProperty(globalThis, "Deno", { value, configurable: true, writable: true });
	try {
		return run();
	} finally {
		delete (globalThis as { Deno?: unknown }).Deno;
	}
}

// Tests run on Node, which has no Bun global; stand one in the way withDenoGlobal does.
function withBunMain<T>(value: string, run: () => T): T {
	Object.defineProperty(globalThis, "Bun", {
		value: { main: value },
		configurable: true,
		writable: true,
	});
	try {
		return run();
	} finally {
		delete (globalThis as { Bun?: unknown }).Bun;
	}
}

/** Sets the packaged marker and makes every `process.env` read throw, like Deno without --allow-env. */
function asPackagedBuildWithoutEnv<T>(run: () => T): T {
	const marker = Symbol.for(PACKAGED_BUILD_KEY);
	const envDescriptor = Object.getOwnPropertyDescriptor(process, "env")!;
	const deniedEnv = new Proxy(process.env, {
		get: (_target, key) => {
			throw new Error(`env read: ${String(key)}`);
		},
	});
	Object.defineProperty(globalThis, marker, { value: true, configurable: true });
	Object.defineProperty(process, "env", { ...envDescriptor, value: deniedEnv });
	try {
		return run();
	} finally {
		Object.defineProperty(process, "env", envDescriptor);
		Reflect.deleteProperty(globalThis, marker);
	}
}

function withExecPath<T>(value: string, run: () => T): T {
	const descriptor = Object.getOwnPropertyDescriptor(process, "execPath")!;
	Object.defineProperty(process, "execPath", { ...descriptor, value });
	try {
		return run();
	} finally {
		Object.defineProperty(process, "execPath", descriptor);
	}
}

// Reports a Node single executable application; the real one is in tests/artifacts-runtimes.test.ts.
function withNodeSea<T>(run: () => T): T {
	const original = process.getBuiltinModule;
	process.getBuiltinModule = (id: string) =>
		id === "node:sea" ? { isSea: () => true } : original(id);
	try {
		return run();
	} finally {
		process.getBuiltinModule = original;
	}
}

describe("resolveArtifactDir", () => {
	it("rejects anything but a single directory name", () => {
		for (const name of ["", ".", "..", "skills/demo", "a\\b", "/skills"]) {
			expect(() => resolveArtifactDir(name)).toThrow("single directory name");
		}
	});

	it("resolves next to the executable inside a Bun compiled binary", () => {
		process.argv[1] = join(tmpDir, "elsewhere", "cli.ts");
		const result = withExecPath(join(tmpDir, "bin", "cli"), () =>
			withBunMain("/$bunfs/root/cli", () => resolveArtifactDir("skills")),
		);
		expect(result).toBe(join(tmpDir, "bin", "skills"));
	});

	it("detects a Windows Bun compiled binary even when the crust build marker is set", () => {
		// Windows standalone Bun mounts the embedded entry at B:/~BUN/, not /$bunfs/.
		process.argv[1] = join(tmpDir, "elsewhere", "cli.ts");
		process.env.CRUST_INTERNAL_BUILD = "1";
		const result = withExecPath(join(tmpDir, "bin", "cli.exe"), () =>
			withBunMain("B:/~BUN/root/cli.exe", () => resolveArtifactDir("skills")),
		);
		expect(result).toBe(join(tmpDir, "bin", "skills"));
	});

	it("resolves next to the executable inside a Node SEA over build-only markers", () => {
		process.argv[1] = join(tmpDir, "bin", "cli");
		process.env.CRUST_INTERNAL_BUILD = "1";
		process.env[BUILD_OUT_DIR_ENV] = join(tmpDir, ".crust", "artifacts");
		const result = withExecPath(join(tmpDir, "bin", "cli"), () =>
			withNodeSea(() => resolveArtifactDir("skills")),
		);
		expect(result).toBe(join(tmpDir, "bin", "skills"));
	});

	it("resolves next to the executable inside a Deno compiled binary", () => {
		process.argv[1] = join(tmpDir, "bin", "cli");
		const result = withExecPath(join(tmpDir, "bin", "cli"), () =>
			withDenoGlobal({ build: { standalone: true } }, () => resolveArtifactDir("templates")),
		);
		expect(result).toBe(join(tmpDir, "bin", "templates"));
	});

	it("resolves next to the bundle's bin/ in a packaged build, ignoring build-only env", async () => {
		await writeFile(join(tmpDir, "package.json"), "{}");
		process.argv[1] = join(tmpDir, "src", "cli.ts");
		process.env[BUILD_OUT_DIR_ENV] = join(tmpDir, "stale-build-output");
		const result = asPackagedBuildWithoutEnv(() => resolveArtifactDir("skills"));
		// Same layout as the Bun/Node define: `<artifacts.ts dir>/../skills`.
		expect(result).toBe(resolve(import.meta.dirname, "..", "skills"));
	});

	it("treats only a true packaged marker as packaged", () => {
		const marker = Symbol.for(PACKAGED_BUILD_KEY);
		expect(isPackagedBuild()).toBe(false);
		Object.defineProperty(globalThis, marker, { value: "1", configurable: true });
		try {
			expect(isPackagedBuild()).toBe(false);
		} finally {
			Reflect.deleteProperty(globalThis, marker);
		}
	});

	it("resolves .crust/root under the nearest package root of argv[1] when running from source", async () => {
		await writeFile(join(tmpDir, "package.json"), "{}");
		await mkdir(join(tmpDir, "src"));
		process.argv[1] = join(tmpDir, "src", "cli.ts");
		await writeFile(process.argv[1], "");
		expect(resolveArtifactDir("skills")).toBe(join(tmpDir, ".crust", "root", "skills"));
	});

	it("resolves source-linked artifacts from the real entrypoint's package, not the consumer", async () => {
		const source = join(tmpDir, "source");
		const consumer = join(tmpDir, "consumer");
		await mkdir(join(source, "src"), { recursive: true });
		await mkdir(join(consumer, "node_modules", ".bin"), { recursive: true });
		await writeFile(join(source, "package.json"), "{}");
		await writeFile(join(consumer, "package.json"), "{}");
		await writeFile(join(source, "src", "cli.ts"), "");
		process.argv[1] = join(consumer, "node_modules", ".bin", "cli");
		await symlink(join(source, "src", "cli.ts"), process.argv[1], "file");
		expect(resolveArtifactDir("templates")).toBe(join(source, ".crust", "root", "templates"));
	});

	it("resolves the build output directory while crust build prepares the snapshot", async () => {
		// .crust/root is wiped at this point; sections must read what earlier hooks wrote.
		await writeFile(join(tmpDir, "package.json"), "{}");
		process.argv[1] = join(tmpDir, "src", "cli.ts");
		process.env[BUILD_OUT_DIR_ENV] = join(tmpDir, ".crust", "artifacts");
		expect(resolveArtifactDir("skills")).toBe(join(tmpDir, ".crust", "artifacts", "skills"));
	});

	it("reports artifact context for missing or broken source entrypoints", async () => {
		const missing = join(tmpDir, "missing.ts");
		const broken = join(tmpDir, "broken.ts");
		await symlink(missing, broken, "file");
		for (const entrypoint of [missing, broken]) {
			process.argv[1] = entrypoint;
			expect(() => resolveArtifactDir("skills")).toThrow(
				`Could not resolve artifact "skills": could not resolve source entrypoint "${entrypoint}".`,
			);
		}
	});

	it("names the entrypoint when no package root is found from source", async () => {
		process.argv[1] = join(tmpDir, "cli.ts");
		await writeFile(process.argv[1], "");
		expect(() => resolveArtifactDir("skills")).toThrow(
			`Could not resolve artifact "skills": no package.json was found above entrypoint "${process.argv[1]}".`,
		);
		process.argv.length = 1;
		expect(() => resolveArtifactDir("skills")).toThrow("process.argv[1] (unset)");
	});
});
