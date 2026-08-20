import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Crust, defineExtension, defineExtensionId } from "@crustjs/core";
import { BUILD_OUT_DIR_ENV, SNAPSHOT_PATH_ENV } from "@crustjs/core/tooling";
import { skill } from "@crustjs/skills";

import { man } from "./extension.ts";

const directories: string[] = [];

afterEach(async () => {
	await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("man Extension", () => {
	it("exposes the reserved identity on the factory", () => {
		expect(String(man.id)).toBe("crust:man");
		expect(man().id).toBe(man.id);
	});

	it("writes the root manual with a configurable section", async () => {
		const outDir = await mkdtemp(join(tmpdir(), "crust-man-extension-"));
		directories.push(outDir);
		const extension = man({ section: 5 });
		const snapshot = await new Crust("demo", { description: "Demo CLI" })
			.extend(extension)
			.snapshot();

		await extension.build?.({ snapshot, outDir });

		const output = await readFile(join(outDir, "man", "demo.5"), "utf8");
		expect(output).toContain(".Dt DEMO 5");
		expect(output).not.toContain(outDir);
	});

	it("renders skill sources created by an earlier build hook", async () => {
		const root = await mkdtemp(join(tmpdir(), "crust-man-extension-"));
		directories.push(root);
		const source = join(root, "generated-skills");
		const outDir = join(root, "dist");
		const snapshotPath = join(root, "snapshot.json");
		const originalExit = process.exit;
		process.env[SNAPSHOT_PATH_ENV] = snapshotPath;
		process.env[BUILD_OUT_DIR_ENV] = outDir;
		process.exit = ((code?: number) => {
			throw new Error(`process.exit(${code ?? "undefined"}) was called during snapshot`);
		}) as typeof process.exit;
		const producer = defineExtension(defineExtensionId("skill-producer"), {
			async build() {
				const directory = join(source, "generated");
				await mkdir(directory, { recursive: true });
				await writeFile(
					join(directory, "SKILL.md"),
					"---\nname: generated\ndescription: Generated during build\n---\n",
				);
			},
		});
		const app = new Crust("demo", { description: "Demo CLI" }).extend(
			producer,
			skill({ distDir: source }),
			man(),
		);

		try {
			await expect(app.execute({ argv: [] })).rejects.toThrow("process.exit(0) was called");
		} finally {
			process.exit = originalExit;
			delete process.env[SNAPSHOT_PATH_ENV];
			delete process.env[BUILD_OUT_DIR_ENV];
		}

		const output = await readFile(join(outDir, "man", "demo.1"), "utf8");
		expect(output).toContain("Generated during build");
		expect(output).not.toContain("unavailable");
	});

	it("honors a configured installed name", async () => {
		const outDir = await mkdtemp(join(tmpdir(), "crust-man-extension-"));
		directories.push(outDir);
		const extension = man({ name: "my-tool" });
		const snapshot = await new Crust("demo").extend(extension).snapshot();

		await extension.build?.({ snapshot, outDir });

		expect(await readFile(join(outDir, "man", "my-tool.1"), "utf8")).toContain(".Nm my-tool");
	});
});
