import { afterEach, describe, expect, it } from "bun:test";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
	assertTargetsBuildableWithoutBun,
	BUN_TARGETS,
	buildEntrypoint,
	bunBaselineAlias,
	bunCompileTarget,
	createBunCompileArgs,
} from "./build-helpers.ts";

const coreUrl = import.meta.resolve("@crustjs/core");
const io = { stdout: () => {}, stderr: () => {} };

async function withoutBunOnPath<T>(run: () => T): Promise<T> {
	const path = process.env.PATH;
	process.env.PATH = "";
	try {
		return await run();
	} finally {
		process.env.PATH = path;
	}
}

const fallbackRunner = { command: process.execPath, env: { BUN_BE_BUN: "1" } };
const realBunRunner = { command: "/usr/local/bin/bun", env: {} };

describe("bunBaselineAlias", () => {
	it("maps every x64 target to its -baseline spelling and arm64 to nothing", () => {
		expect(bunBaselineAlias("bun-linux-x64")).toBe("bun-linux-x64-baseline");
		expect(bunBaselineAlias("bun-linux-x64-musl")).toBe("bun-linux-x64-musl-baseline");
		expect(bunBaselineAlias("bun-darwin-x64")).toBe("bun-darwin-x64-baseline");
		expect(bunBaselineAlias("bun-windows-x64")).toBe("bun-windows-x64-baseline");
		expect(bunBaselineAlias("bun-linux-arm64")).toBeNull();
		expect(bunBaselineAlias("bun-linux-arm64-musl")).toBeNull();
		expect(bunBaselineAlias("bun-darwin-arm64")).toBeNull();
		expect(bunBaselineAlias("bun-windows-arm64")).toBeNull();
	});
});

describe("bunCompileTarget", () => {
	it("substitutes the -baseline alias only for the self-copy target under the fallback runner", () => {
		expect(bunCompileTarget("bun-linux-x64", fallbackRunner, "bun-linux-x64")).toBe(
			"bun-linux-x64-baseline",
		);
		expect(bunCompileTarget("bun-windows-x64", fallbackRunner, "bun-windows-x64")).toBe(
			"bun-windows-x64-baseline",
		);
		expect(bunCompileTarget("bun-darwin-arm64", fallbackRunner, "bun-linux-x64")).toBe(
			"bun-darwin-arm64",
		);
		expect(bunCompileTarget("bun-linux-x64", fallbackRunner, null)).toBe("bun-linux-x64");
		expect(bunCompileTarget(undefined, fallbackRunner, "bun-linux-x64")).toBeUndefined();
	});

	it("passes the canonical target to a real bun", () => {
		expect(bunCompileTarget("bun-linux-x64", realBunRunner, "bun-linux-x64")).toBe("bun-linux-x64");
	});

	it("leaves an arm64 self-copy target alone; the guard refuses it earlier", () => {
		expect(bunCompileTarget("bun-darwin-arm64", fallbackRunner, "bun-darwin-arm64")).toBe(
			"bun-darwin-arm64",
		);
	});
});

describe("assertTargetsBuildableWithoutBun", () => {
	it("refuses the self-copying target and lists the remaining targets when bun is absent", async () => {
		await withoutBunOnPath(() => {
			expect(() =>
				assertTargetsBuildableWithoutBun(BUN_TARGETS.targets, "bun-darwin-arm64"),
			).toThrow(
				"Cannot build bun-darwin-arm64 without a separate bun executable on PATH.\n" +
					"  Bun reuses the running crust executable as the base for its own platform, which yields a binary that crashes on start.\n" +
					"  Install Bun (https://bun.sh), or pass --target with the other targets (e.g. --target bun-linux-x64 --target bun-linux-arm64 --target bun-linux-x64-musl --target bun-linux-arm64-musl --target bun-darwin-x64 --target bun-windows-x64 --target bun-windows-arm64).",
			);
			expect(() =>
				assertTargetsBuildableWithoutBun(["bun-linux-arm64-musl"], "bun-linux-arm64-musl"),
			).toThrow("Install Bun (https://bun.sh), or build a different target.");
		});
	});

	it("keeps every other target buildable without bun", async () => {
		await withoutBunOnPath(() => {
			expect(() =>
				assertTargetsBuildableWithoutBun(
					["bun-linux-x64", "bun-darwin-x64", "bun-windows-arm64"],
					"bun-darwin-arm64",
				),
			).not.toThrow();
			expect(() => assertTargetsBuildableWithoutBun(BUN_TARGETS.targets, null)).not.toThrow();
		});
	});

	it("allows an x64 self-copy target without bun because its -baseline alias is downloaded clean", async () => {
		await withoutBunOnPath(() => {
			for (const host of [
				"bun-linux-x64",
				"bun-linux-x64-musl",
				"bun-darwin-x64",
				"bun-windows-x64",
			] as const) {
				expect(() => assertTargetsBuildableWithoutBun(BUN_TARGETS.targets, host)).not.toThrow();
			}
		});
	});

	it("allows the self-copying target when bun is on PATH", () => {
		expect(Bun.which("bun")).not.toBeNull();
		expect(() =>
			assertTargetsBuildableWithoutBun(BUN_TARGETS.targets, "bun-darwin-arm64"),
		).not.toThrow();
	});
});

describe("createBunCompileArgs", () => {
	it("compiles without cwd bunfig autoloading and keeps env, outfile, minify, target order", () => {
		expect(
			createBunCompileArgs("/p/src/cli.ts", "/p/dist/cli", true, "bun-darwin-arm64", ["/p/.env"]),
		).toEqual([
			"build",
			"--compile",
			"--no-compile-autoload-bunfig",
			"--env-file",
			"/p/.env",
			"--env=PUBLIC_*",
			"--outfile",
			"/p/dist/cli",
			"--minify",
			"--target",
			"bun-darwin-arm64",
			"/p/src/cli.ts",
		]);
		expect(createBunCompileArgs("/p/src/cli.ts", "/p/dist/cli", false, undefined, [])).toEqual([
			"build",
			"--compile",
			"--no-compile-autoload-bunfig",
			"--env=PUBLIC_*",
			"--outfile",
			"/p/dist/cli",
			"/p/src/cli.ts",
		]);
	});
});

describe("buildEntrypoint", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
	});

	it("returns the entry snapshot and exits before trailing code", async () => {
		const directory = await mkdtemp(join(tmpdir(), "crust-entry-snapshot-test-"));
		tempDirs.push(directory);
		const entry = join(directory, "cli.ts");
		const trailingMarker = join(directory, "trailing-code-ran");
		await writeFile(
			entry,
			`import { Crust } from ${JSON.stringify(coreUrl)};\n` +
				`const app = new Crust("fixture", { description: "Fixture CLI" }).action(() => {});\n` +
				`await app.execute();\n` +
				`await Bun.write(${JSON.stringify(trailingMarker)}, "ran");\n`,
		);

		const { snapshot, build } = await buildEntrypoint(
			entry,
			join(directory, "dist"),
			[],
			io,
			directory,
		);

		expect(snapshot.meta).toMatchObject({ name: "fixture", description: "Fixture CLI" });
		expect(snapshot.hasAction).toBe(true);
		expect(build).toEqual({ extensions: [] });
		await expect(access(trailingMarker)).rejects.toThrow();
	});

	it("runs Extension build hooks and returns their artifact report", async () => {
		const directory = await mkdtemp(join(tmpdir(), "crust-entry-build-test-"));
		tempDirs.push(directory);
		const entry = join(directory, "cli.ts");
		const outDir = join(directory, "dist");
		await writeFile(
			entry,
			`import { Crust, defineExtension, defineExtensionId } from ${JSON.stringify(coreUrl)};\n` +
				`const artifact = defineExtension(defineExtensionId("artifact"), { build: async ({ outDir }) => { await Bun.write(outDir + "/artifact.txt", "built"); return ["artifact.txt"]; } });\n` +
				`const app = new Crust("fixture").extend(artifact).action(() => {});\n` +
				`await app.execute();\n`,
		);

		const result = await buildEntrypoint(entry, outDir, [], io, directory);

		expect(result.snapshot.meta.name).toBe("fixture");
		expect(result.build.extensions).toHaveLength(1);
		expect(String(result.build.extensions[0]?.id)).toBe("artifact");
		expect(result.build.extensions[0]?.files).toEqual(["artifact.txt"]);
		expect(await Bun.file(join(outDir, "artifact.txt")).text()).toBe("built");
	});

	it("builds skill and man artifacts without absolute source paths", async () => {
		const directory = await mkdtemp(join(tmpdir(), "crust-entry-artifacts-test-"));
		tempDirs.push(directory);
		const entry = join(directory, "cli.ts");
		const source = join(directory, "package", "skills");
		const outDir = join(directory, "dist");
		await Bun.write(
			join(source, "demo", "SKILL.md"),
			"---\nname: demo\ndescription: Demo workflows\n---\n",
		);
		const skillsUrl = pathToFileURL(resolve(import.meta.dir, "../../../skills/src/index.ts")).href;
		const manUrl = pathToFileURL(resolve(import.meta.dir, "../../../man/src/index.ts")).href;
		await writeFile(
			entry,
			`import { Crust } from ${JSON.stringify(coreUrl)};\n` +
				`import { skill } from ${JSON.stringify(skillsUrl)};\n` +
				`import { man } from ${JSON.stringify(manUrl)};\n` +
				`await new Crust("demo", { description: "Demo" }).extend(skill({ distDir: ${JSON.stringify(source)} }), man()).execute();\n`,
		);

		// Run the entry subprocess from the fixture project root so advertised
		// sources are relative to that project.
		await buildEntrypoint(entry, outDir, [], io, directory);

		const manual = await Bun.file(join(outDir, "man", "demo.1")).text();
		const packagedSkill = await Bun.file(join(outDir, "skills", "demo", "SKILL.md")).text();
		expect(manual).toContain("Demo workflows");
		expect(manual).not.toContain(source);
		expect(packagedSkill).not.toContain(source);
	});

	it("attributes Extension build failures", async () => {
		const directory = await mkdtemp(join(tmpdir(), "crust-entry-build-test-"));
		tempDirs.push(directory);
		const entry = join(directory, "cli.ts");
		await writeFile(
			entry,
			`import { Crust, defineExtension, defineExtensionId } from ${JSON.stringify(coreUrl)};\n` +
				`const broken = defineExtension(defineExtensionId("broken"), { build: () => { throw new Error("disk full"); } });\n` +
				`await new Crust("fixture").extend(broken).execute();\n`,
		);

		await expect(
			buildEntrypoint(entry, join(directory, "dist"), [], io, directory),
		).rejects.toThrow('Extension "broken" build failed: disk full');
	});

	it("explains when an entry exits without producing a snapshot", async () => {
		const directory = await mkdtemp(join(tmpdir(), "crust-entry-snapshot-test-"));
		tempDirs.push(directory);
		const entry = join(directory, "cli.ts");
		await writeFile(entry, "export {};\n");

		await expect(
			buildEntrypoint(entry, join(directory, "dist"), [], io, directory),
		).rejects.toThrow("Entry exited without producing a Command Snapshot");
	});

	it("explains when core produces a snapshot without a build report", async () => {
		const directory = await mkdtemp(join(tmpdir(), "crust-entry-report-test-"));
		tempDirs.push(directory);
		const entry = join(directory, "cli.ts");
		await writeFile(
			entry,
			`await Bun.write(process.env.CRUST_INTERNAL_SNAPSHOT_PATH!, JSON.stringify({ meta: { name: "old-core" } }));\n`,
		);

		await expect(
			buildEntrypoint(entry, join(directory, "dist"), [], io, directory),
		).rejects.toThrow("Command Snapshot without a Build Report");
	});

	it("rethrows the entry's error when the subprocess exits non-zero", async () => {
		const directory = await mkdtemp(join(tmpdir(), "crust-entry-snapshot-test-"));
		tempDirs.push(directory);
		const entry = join(directory, "cli.ts");
		await writeFile(entry, `throw new Error("entry blew up before execute");\n`);

		await expect(
			buildEntrypoint(entry, join(directory, "dist"), [], io, directory),
		).rejects.toThrow("entry blew up before execute");
	});

	it("explains when the snapshot file contains invalid JSON", async () => {
		const directory = await mkdtemp(join(tmpdir(), "crust-entry-snapshot-test-"));
		tempDirs.push(directory);
		const entry = join(directory, "cli.ts");
		await writeFile(
			entry,
			`await Bun.write(process.env.CRUST_INTERNAL_SNAPSHOT_PATH!, "not json");\n`,
		);

		await expect(
			buildEntrypoint(entry, join(directory, "dist"), [], io, directory),
		).rejects.toThrow("Entry produced an invalid Command Snapshot");
	});
});
