import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Crust, defineCommand } from "@crustjs/core";

import { writeSkills } from "./build.ts";
import { SkillSourceConflictError } from "./errors.ts";

let tempRoot: string;

beforeEach(async () => {
	tempRoot = await mkdtemp(join(tmpdir(), "crust-write-skills-"));
});

afterEach(async () => {
	await rm(tempRoot, { recursive: true, force: true });
});

async function createBundle(name: string, description: string): Promise<string> {
	const sourceDir = join(tempRoot, name);
	await mkdir(join(sourceDir, "references"), { recursive: true });
	await writeFile(
		join(sourceDir, "SKILL.md"),
		`---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
	);
	await writeFile(join(sourceDir, "references", "guide.md"), "# Guide\n");
	return sourceDir;
}

function createApp() {
	return new Crust("demo", { description: "Demo CLI" })
		.action(() => {})
		.add(
			defineCommand(
				"serve",
				{
					description: "Start the server",
					sections: [{ title: "Deployment", body: "Check the target environment first." }],
				},
				(command) => command.action(() => {}),
			),
		);
}

describe("writeSkills", () => {
	it("writes generated and authored skills with source metadata", async () => {
		const bundleDir = await createBundle("deployment-guide", "Deployment guidance");
		const outDir = join(tempRoot, "output");

		await writeSkills(createApp(), {
			outDir,
			version: "1.2.3",
			bundles: [bundleDir],
		});

		expect((await readdir(tempRoot)).sort()).toEqual(["deployment-guide", "output"]);
		expect(await readFile(join(outDir, "demo", "SKILL.md"), "utf8")).toContain("name: demo");
		const serve = await readFile(join(outDir, "demo", "commands", "serve.md"), "utf8");
		expect(serve).toContain("# `demo serve`");
		expect(serve).toContain("## Deployment\nCheck the target environment first.");
		expect(JSON.parse(await readFile(join(outDir, "demo", "crust.json"), "utf8"))).toEqual({
			name: "demo",
			description: "Demo CLI",
			version: "1.2.3",
			kind: "generated",
		});
		expect(await readFile(join(outDir, "deployment-guide", "references", "guide.md"), "utf8")).toBe(
			"# Guide\n",
		);
		expect(
			JSON.parse(await readFile(join(outDir, "deployment-guide", "crust.json"), "utf8")),
		).toEqual({
			name: "deployment-guide",
			description: "Deployment guidance",
			version: "1.2.3",
			kind: "bundle",
		});
	});

	it("supports overrides and replaces stale output", async () => {
		const outDir = join(tempRoot, "output");
		await mkdir(join(outDir, "removed-skill"), { recursive: true });

		await writeSkills(createApp(), {
			outDir,
			version: "2.0.0",
			name: "demo-reference",
			description: "Complete demo reference",
		});

		expect(await readdir(outDir)).toEqual(["demo-reference"]);
		const metadata = JSON.parse(
			await readFile(join(outDir, "demo-reference", "crust.json"), "utf8"),
		);
		expect(metadata).toMatchObject({
			name: "demo-reference",
			description: "Complete demo reference",
			kind: "generated",
		});
	});

	it("rejects a generated and authored skill name collision before writing", async () => {
		const bundleDir = await createBundle("demo", "Authored demo guidance");
		const outDir = join(tempRoot, "output");

		const result = writeSkills(createApp(), {
			outDir,
			version: "1.0.0",
			bundles: [bundleDir],
		});
		await expect(result).rejects.toBeInstanceOf(SkillSourceConflictError);
		await expect(result).rejects.toMatchObject({ skillName: "demo" });
		await expect(readdir(outDir)).rejects.toThrow();
	});

	it("rejects an invalid skill name before writing", async () => {
		const outDir = join(tempRoot, "output");

		const result = writeSkills(createApp(), {
			outDir,
			version: "1.0.0",
			name: "Bad_Name",
		});
		await expect(result).rejects.toThrow('Invalid skill name "Bad_Name"');
		await expect(readdir(outDir)).rejects.toThrow();
	});
});
