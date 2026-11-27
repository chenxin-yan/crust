import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { BUILD_OUT_DIR_ENV, LAUNCHER_ENV, isSourceRun, artifactPath } from "./artifacts.ts";

let tmpDir: string;
let originalArgv1: string | undefined;

beforeEach(async () => {
	tmpDir = await mkdtemp(join(tmpdir(), "crust-artifacts-"));
	originalArgv1 = process.argv[1];
	vi.stubEnv("CRUST_INTERNAL_BUILD", undefined);
	vi.stubEnv(BUILD_OUT_DIR_ENV, undefined);
});

afterEach(async () => {
	if (originalArgv1 === undefined) process.argv.length = 1;
	else process.argv[1] = originalArgv1;
	vi.unstubAllEnvs();
	await rm(tmpDir, { recursive: true, force: true });
});

// Tests run on Node, which has no Bun global; stand one in.
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

describe("artifactPath", () => {
	it("rejects absolute and drive-qualified paths and empty, . or .. segments", () => {
		for (const path of [
			"",
			".",
			"..",
			"/skills",
			"skills/",
			"skills//demo",
			"skills/../x",
			"D:/templates",
			"templates/D:/x",
			"D:templates",
			"a\\..",
		]) {
			expect(() => artifactPath(path)).toThrow("Artifact path must be names separated by");
		}
	});

	it("resolves next to the executable inside a Bun compiled binary", () => {
		process.argv[1] = join(tmpDir, "elsewhere", "cli.ts");
		const result = withExecPath(join(tmpDir, "bin", "cli"), () =>
			withBunMain("/$bunfs/root/cli", () => artifactPath("skills")),
		);
		expect(result).toBe(join(tmpDir, "bin", "skills"));
	});

	it("resolves in the root package that launched a compiled binary, and only for that binary", async () => {
		process.argv[1] = join(tmpDir, "elsewhere", "cli.ts");
		const binary = join(tmpDir, "platform", "bin", "cli");
		await mkdir(join(tmpDir, "platform", "bin"), { recursive: true });
		await writeFile(binary, "");
		const rootPackage = join(tmpDir, "node_modules", "cli");
		const resolveSkills = () =>
			withExecPath(binary, () => withBunMain("/$bunfs/root/cli", () => artifactPath("skills")));
		const beside = join(tmpDir, "platform", "bin", "skills");

		vi.stubEnv(LAUNCHER_ENV, JSON.stringify([binary, rootPackage]));
		expect(resolveSkills()).toBe(join(rootPackage, "skills"));
		// Inherited from another program's launcher, or not what a launcher writes: beside the executable.
		for (const value of [
			JSON.stringify([join(tmpDir, "other", "bin", "tool"), rootPackage]),
			JSON.stringify([binary]),
			JSON.stringify({ binary, rootPackage }),
			"not json",
			"",
		]) {
			vi.stubEnv(LAUNCHER_ENV, value);
			expect(resolveSkills()).toBe(beside);
		}
	});

	it("detects a Windows Bun compiled binary even when the crust build marker is set", () => {
		// Windows standalone Bun mounts the embedded entry at B:/~BUN/, not /$bunfs/.
		process.argv[1] = join(tmpDir, "elsewhere", "cli.ts");
		vi.stubEnv("CRUST_INTERNAL_BUILD", "1");
		const result = withExecPath(join(tmpDir, "bin", "cli.exe"), () =>
			withBunMain("B:/~BUN/root/cli.exe", () => artifactPath("skills")),
		);
		expect(result).toBe(join(tmpDir, "bin", "skills"));
	});

	it("resolves next to the executable inside a Node SEA over build-only markers", () => {
		process.argv[1] = join(tmpDir, "bin", "cli");
		vi.stubEnv("CRUST_INTERNAL_BUILD", "1");
		vi.stubEnv(BUILD_OUT_DIR_ENV, join(tmpDir, ".crust", "artifacts"));
		const result = withExecPath(join(tmpDir, "bin", "cli"), () =>
			withNodeSea(() => artifactPath("skills")),
		);
		expect(result).toBe(join(tmpDir, "bin", "skills"));
	});

	it("resolves next to the bundle's bin/ in a Crust-built bundle, ignoring build-only env", async () => {
		await writeFile(join(tmpDir, "package.json"), "{}");
		process.argv[1] = join(tmpDir, "src", "cli.ts");
		vi.stubEnv("CRUST_INTERNAL_BUILD", "1");
		vi.stubEnv(BUILD_OUT_DIR_ENV, join(tmpDir, "stale-build-output"));
		// `<artifacts.ts dir>/../skills`, as `<bundle>/bin/cli.js` resolves `<bundle>/skills`.
		expect(artifactPath("skills")).toBe(resolve(import.meta.dirname, "..", "skills"));
	});

	it("resolves .crust/root under the nearest package root of argv[1] when running from source", async () => {
		await writeFile(join(tmpDir, "package.json"), "{}");
		await mkdir(join(tmpDir, "src"));
		process.argv[1] = join(tmpDir, "src", "cli.ts");
		await writeFile(process.argv[1], "");
		expect(artifactPath("skills")).toBe(join(tmpDir, ".crust", "root", "skills"));
		// A `:` after more than one letter is no drive: `crust.include` stages such a POSIX name.
		expect(artifactPath("assets:v1")).toBe(join(tmpDir, ".crust", "root", "assets:v1"));
		for (const path of ["templates/base/a.txt", "templates\\base\\a.txt"]) {
			expect(artifactPath(path)).toBe(join(tmpDir, ".crust", "root", "templates", "base", "a.txt"));
		}
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
		expect(artifactPath("templates")).toBe(join(source, ".crust", "root", "templates"));
	});

	it("resolves the build output directory while crust build prepares the snapshot", async () => {
		// .crust/root holds the previous build; sections must read what earlier hooks wrote.
		await writeFile(join(tmpDir, "package.json"), "{}");
		await mkdir(join(tmpDir, "src"));
		process.argv[1] = join(tmpDir, "src", "cli.ts");
		await writeFile(process.argv[1], "");
		vi.stubEnv(BUILD_OUT_DIR_ENV, join(tmpDir, ".crust", "artifacts"));
		expect(artifactPath("skills")).toBe(join(tmpDir, ".crust", "artifacts", "skills"));
	});

	it("resolves a path under a crust.include folder to that folder in the project from source", async () => {
		await writeFile(
			join(tmpDir, "package.json"),
			JSON.stringify({
				crust: { include: ["./templates", "assets/icons/", "assets/../docs", "../outside", 1] },
			}),
		);
		await mkdir(join(tmpDir, "src"));
		process.argv[1] = join(tmpDir, "src", "cli.ts");
		await writeFile(process.argv[1], "");
		expect(artifactPath("templates")).toBe(join(tmpDir, "templates"));
		expect(artifactPath("templates/base/a.txt")).toBe(join(tmpDir, "templates", "base", "a.txt"));
		expect(artifactPath("assets/icons/x.png")).toBe(join(tmpDir, "assets", "icons", "x.png"));
		// Normalized like crust build stages it: `assets/../docs` is `docs`, `../outside` is not shipped.
		expect(artifactPath("docs/a.md")).toBe(join(tmpDir, "docs", "a.md"));
		expect(artifactPath("outside")).toBe(join(tmpDir, ".crust", "root", "outside"));
		// Build-only artifacts, and a name that only starts like an include, still come from the last build.
		expect(artifactPath("skills")).toBe(join(tmpDir, ".crust", "root", "skills"));
		expect(artifactPath("assets")).toBe(join(tmpDir, ".crust", "root", "assets"));
		expect(artifactPath("templates-old")).toBe(join(tmpDir, ".crust", "root", "templates-old"));
		// Also while crust build prepares the snapshot, before the folder is staged.
		vi.stubEnv(BUILD_OUT_DIR_ENV, join(tmpDir, ".crust", "artifacts"));
		expect(artifactPath("templates/base")).toBe(join(tmpDir, "templates", "base"));
		expect(artifactPath("skills")).toBe(join(tmpDir, ".crust", "artifacts", "skills"));
	});

	it("reports artifact context for missing or broken source entrypoints", async () => {
		const missing = join(tmpDir, "missing.ts");
		const broken = join(tmpDir, "broken.ts");
		await symlink(missing, broken, "file");
		for (const entrypoint of [missing, broken]) {
			process.argv[1] = entrypoint;
			expect(() => artifactPath("skills")).toThrow(
				`Could not resolve artifact "skills": could not resolve source entrypoint "${entrypoint}".`,
			);
		}
	});

	it("names the entrypoint when no package root is found from source", async () => {
		process.argv[1] = join(tmpDir, "cli.ts");
		await writeFile(process.argv[1], "");
		expect(() => artifactPath("skills")).toThrow(
			`Could not resolve artifact "skills": no package.json was found above entrypoint "${process.argv[1]}".`,
		);
		process.argv.length = 1;
		expect(() => artifactPath("skills")).toThrow("process.argv[1] (unset)");
	});
});

describe("isSourceRun", () => {
	it("is true from source, including while crust build prepares the snapshot", () => {
		expect(isSourceRun()).toBe(true);
		process.env[BUILD_OUT_DIR_ENV] = join(tmpDir, ".crust", "artifacts");
		expect(isSourceRun()).toBe(true);
	});

	it("is false in Crust-built bundles and compiled executables", () => {
		expect(withNodeSea(isSourceRun)).toBe(false);
		expect(withBunMain("/$bunfs/root/cli", isSourceRun)).toBe(false);
		process.env.CRUST_INTERNAL_BUILD = "1";
		expect(isSourceRun()).toBe(false);
	});
});
