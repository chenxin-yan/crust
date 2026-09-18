import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Crust } from "@crustjs/core";
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

		const artifacts = await extension.build?.({ snapshot, outDir });

		expect(artifacts).toEqual([join("man", "demo.5")]);
		const output = await readFile(join(outDir, "man", "demo.5"), "utf8");
		expect(output).toContain(".Dt DEMO 5");
		expect(output).not.toContain(outDir);
	});

	it("renders the skill the skills build hook wrote in the same build", async () => {
		const root = await mkdtemp(join(tmpdir(), "crust-man-extension-"));
		directories.push(root);
		await writeFile(join(root, "package.json"), '{"name":"demo"}');
		const originalArgv1 = process.argv[1];
		process.argv[1] = join(root, "cli.ts");
		const outDir = join(root, "dist");
		const snapshotPath = join(root, "snapshot.json");
		const originalExit = process.exit;
		process.env[SNAPSHOT_PATH_ENV] = snapshotPath;
		// crust build has wiped .crust by now, so the skills extension must read the
		// build output directory or the man page reports its own skill as missing.
		process.env[BUILD_OUT_DIR_ENV] = outDir;
		process.exit = (code?: number) => {
			throw new Error(`process.exit(${code ?? "undefined"}) was called during snapshot`);
		};
		const app = new Crust("demo", { description: "Demo CLI" }).extend(skill({}), man());

		try {
			await expect(app.execute({ argv: [] })).rejects.toThrow("process.exit(0) was called");
		} finally {
			process.exit = originalExit;
			if (originalArgv1 === undefined) process.argv.length = 1;
			else process.argv[1] = originalArgv1;
			delete process.env[SNAPSHOT_PATH_ENV];
			delete process.env[BUILD_OUT_DIR_ENV];
		}

		const output = await readFile(join(outDir, "man", "demo.1"), "utf8");
		expect(output).toContain(`Source: ${join(outDir, "skills", "demo")}`);
		expect(output).not.toContain("not found");
	});

	it("honors a configured installed name", async () => {
		const outDir = await mkdtemp(join(tmpdir(), "crust-man-extension-"));
		directories.push(outDir);
		const extension = man({ name: "my-tool" });
		const snapshot = await new Crust("demo").extend(extension).snapshot();

		await extension.build?.({ snapshot, outDir });

		expect(await readFile(join(outDir, "man", "my-tool.1"), "utf8")).toContain(".Nm my-tool");
	});

	it("rejects names containing path separators", async () => {
		const outDir = await mkdtemp(join(tmpdir(), "crust-man-extension-"));
		directories.push(outDir);
		const extension = man({ name: "foo\\bar" });
		const snapshot = await new Crust("demo").extend(extension).snapshot();

		await expect(extension.build?.({ snapshot, outDir })).rejects.toThrow(
			"must not contain path separators",
		);
	});
});
