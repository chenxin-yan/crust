import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BUILD_OUT_DIR_ENV, resolveArtifactDir } from "./artifacts.ts";

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

// The Bun global is frozen, but Bun.main has a setter (typed readonly).
function withBunMain<T>(value: string, run: () => T): T {
	const bun = Bun as { main: string };
	const original = bun.main;
	bun.main = value;
	try {
		return run();
	} finally {
		bun.main = original;
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

	it("resolves next to the executable inside a Deno compiled binary", () => {
		process.argv[1] = join(tmpDir, "bin", "cli");
		const result = withExecPath(join(tmpDir, "bin", "cli"), () =>
			withDenoGlobal({ build: { standalone: true } }, () => resolveArtifactDir("templates")),
		);
		expect(result).toBe(join(tmpDir, "bin", "templates"));
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
