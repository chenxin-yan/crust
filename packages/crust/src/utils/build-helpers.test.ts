import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { buildEntrypoint } from "./build-helpers.ts";

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
		const coreUrl = pathToFileURL(resolve(import.meta.dir, "../../../core/src/index.ts")).href;
		await writeFile(
			entry,
			`import { Crust } from ${JSON.stringify(coreUrl)};\n` +
				`const app = new Crust("fixture", { description: "Fixture CLI" }).action(() => {});\n` +
				`await app.execute();\n` +
				`await Bun.write(${JSON.stringify(trailingMarker)}, "ran");\n`,
		);

		const root = await buildEntrypoint(entry, join(directory, "dist"));

		expect(root.meta).toMatchObject({ name: "fixture", description: "Fixture CLI" });
		expect(root.hasAction).toBe(true);
		await expect(access(trailingMarker)).rejects.toThrow();
	});

	it("runs Extension build hooks and returns their names", async () => {
		const directory = await mkdtemp(join(tmpdir(), "crust-entry-build-test-"));
		tempDirs.push(directory);
		const entry = join(directory, "cli.ts");
		const outDir = join(directory, "dist");
		const coreUrl = pathToFileURL(resolve(import.meta.dir, "../../../core/src/index.ts")).href;
		await writeFile(
			entry,
			`import { Crust, defineExtension, defineExtensionId } from ${JSON.stringify(coreUrl)};\n` +
				`const artifact = defineExtension(defineExtensionId("artifact"), { build: ({ outDir }) => Bun.write(outDir + "/artifact.txt", "built") });\n` +
				`const app = new Crust("fixture").extend(artifact).action(() => {});\n` +
				`await app.execute();\n`,
		);

		const snapshot = await buildEntrypoint(entry, outDir);

		expect(snapshot.meta.name).toBe("fixture");
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
		const coreUrl = pathToFileURL(resolve(import.meta.dir, "../../../core/src/index.ts")).href;
		const skillsUrl = pathToFileURL(resolve(import.meta.dir, "../../../skills/src/index.ts")).href;
		const manUrl = pathToFileURL(resolve(import.meta.dir, "../../../man/src/index.ts")).href;
		await writeFile(
			entry,
			`import { Crust } from ${JSON.stringify(coreUrl)};\n` +
				`import { skill } from ${JSON.stringify(skillsUrl)};\n` +
				`import { man } from ${JSON.stringify(manUrl)};\n` +
				`await new Crust("demo", { description: "Demo" }).extend(skill({ packagedDir: ${JSON.stringify(source)} }), man()).execute();\n`,
		);

		// crust build runs from the project root; the entry subprocess inherits
		// that cwd, so advertised sources relativize against the fixture project.
		const cwdSpy = spyOn(process, "cwd").mockReturnValue(directory);
		try {
			await buildEntrypoint(entry, outDir);
		} finally {
			cwdSpy.mockRestore();
		}

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
		const coreUrl = pathToFileURL(resolve(import.meta.dir, "../../../core/src/index.ts")).href;
		await writeFile(
			entry,
			`import { Crust, defineExtension, defineExtensionId } from ${JSON.stringify(coreUrl)};\n` +
				`const broken = defineExtension(defineExtensionId("broken"), { build: () => { throw new Error("disk full"); } });\n` +
				`await new Crust("fixture").extend(broken).execute();\n`,
		);

		await expect(buildEntrypoint(entry, join(directory, "dist"))).rejects.toThrow(
			'Extension "broken" build failed: disk full',
		);
	});

	it("explains when an entry exits without producing a snapshot", async () => {
		const directory = await mkdtemp(join(tmpdir(), "crust-entry-snapshot-test-"));
		tempDirs.push(directory);
		const entry = join(directory, "cli.ts");
		await writeFile(entry, "export {};\n");

		await expect(buildEntrypoint(entry, join(directory, "dist"))).rejects.toThrow(
			"Entry exited without producing a Command Snapshot",
		);
	});

	it("rethrows the entry's error when the subprocess exits non-zero", async () => {
		const directory = await mkdtemp(join(tmpdir(), "crust-entry-snapshot-test-"));
		tempDirs.push(directory);
		const entry = join(directory, "cli.ts");
		await writeFile(entry, `throw new Error("entry blew up before execute");\n`);

		await expect(buildEntrypoint(entry, join(directory, "dist"))).rejects.toThrow(
			"entry blew up before execute",
		);
	});

	it("explains when the snapshot file contains invalid JSON", async () => {
		const directory = await mkdtemp(join(tmpdir(), "crust-entry-snapshot-test-"));
		tempDirs.push(directory);
		const entry = join(directory, "cli.ts");
		await writeFile(
			entry,
			`await Bun.write(process.env.CRUST_INTERNAL_SNAPSHOT_PATH!, "not json");\n`,
		);

		await expect(buildEntrypoint(entry, join(directory, "dist"))).rejects.toThrow(
			"Entry produced an invalid Command Snapshot",
		);
	});
});
