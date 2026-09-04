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
					sections: [
						{
							title: "Deployment",
							body: "Check the target environment first.",
						},
					],
				},
				(command) => command.action(() => {}),
			),
		);
}

describe("writeSkills", () => {
	it("writes generated and authored skills with source metadata", async () => {
		const bundleDir = await createBundle("deployment-guide", "Deployment guidance");
		const outDir = join(tempRoot, "skills");

		await writeSkills({ app: createApp(), outDir, version: "1.2.3", extras: [bundleDir] });

		expect((await readdir(tempRoot)).sort()).toEqual(["deployment-guide", "skills"]);
		expect(await readFile(join(outDir, "demo", "SKILL.md"), "utf8")).toContain("name: demo");
		const serve = await readFile(join(outDir, "demo", "commands", "serve.md"), "utf8");
		expect(serve).toContain("# `demo serve`");
		expect(serve).toContain("## Deployment\nCheck the target environment first.");
		expect(await readdir(join(outDir, "demo"))).toEqual(["SKILL.md", "commands"]);
		expect(await readFile(join(outDir, "deployment-guide", "references", "guide.md"), "utf8")).toBe(
			"# Guide\n",
		);
		expect(await readdir(join(outDir, "deployment-guide"))).toEqual(["SKILL.md", "references"]);
	});

	it("supports overrides and replaces stale output", async () => {
		const outDir = join(tempRoot, "skills");
		await mkdir(join(outDir, "removed-skill"), { recursive: true });

		await writeSkills({
			app: createApp(),
			outDir,
			version: "2.0.0",
			name: "demo-reference",
			description: "Complete demo reference",
		});

		expect(await readdir(outDir)).toEqual(["demo-reference"]);
		const skillMd = await readFile(join(outDir, "demo-reference", "SKILL.md"), "utf8");
		expect(skillMd).toContain("name: demo-reference");
		expect(skillMd).toContain("description: Complete demo reference");
	});

	it("lets an authored skill replace the same-named generated skill", async () => {
		const bundleDir = await createBundle("gyst", "Authored co-review workflow");
		const outDir = join(tempRoot, "skills");
		const app = new Crust("gyst", { description: "Generated command reference" }).action(() => {});

		await writeSkills({ app: app, outDir, version: "1.0.0", extras: [bundleDir] });

		const skill = await readFile(join(outDir, "gyst", "SKILL.md"), "utf8");
		expect(skill).toContain("description: Authored co-review workflow");
		expect(skill).not.toContain("Generated command reference");
	});

	it("does not validate a generated skill that an authored skill replaces", async () => {
		const bundleDir = await createBundle("gyst", "Authored co-review workflow");
		const outDir = join(tempRoot, "skills");
		// No root description: generating this skill would fail, but it is replaced.
		const app = new Crust("gyst").action(() => {});

		await writeSkills({ app: app, outDir, extras: [bundleDir] });

		const skill = await readFile(join(outDir, "gyst", "SKILL.md"), "utf8");
		expect(skill).toContain("description: Authored co-review workflow");
	});

	it("rejects duplicate authored skill names", async () => {
		const first = await createBundle("guide", "First guide");
		const second = join(tempRoot, "other", "guide");
		await mkdir(second, { recursive: true });
		await writeFile(join(second, "SKILL.md"), "---\nname: guide\ndescription: Second guide\n---\n");
		const result = writeSkills({
			app: createApp(),
			outDir: join(tempRoot, "skills"),
			extras: [first, second],
		});

		await expect(result).rejects.toBeInstanceOf(SkillSourceConflictError);
		await expect(result).rejects.toMatchObject({ skillName: "guide" });
	});

	it("refuses to write an empty skill source", async () => {
		const outDir = join(tempRoot, "skills");

		await expect(writeSkills({ outDir })).rejects.toThrow("Nothing to write");
		await expect(readdir(outDir)).rejects.toThrow();
	});

	it("writes only authored skills when no app is given", async () => {
		const bundleDir = await createBundle("guide", "Authored guidance");
		const outDir = join(tempRoot, "skills");

		await writeSkills({ outDir, extras: [bundleDir] });

		expect(await readdir(outDir)).toEqual(["guide"]);
	});

	it("rejects an extra skill directory nested inside outDir", async () => {
		const outDir = join(tempRoot, "skills");
		await mkdir(join(outDir, "nested"), { recursive: true });
		await writeFile(
			join(outDir, "nested", "SKILL.md"),
			"---\nname: nested\ndescription: Nested\n---\n",
		);

		const result = writeSkills({
			app: createApp(),
			outDir,
			version: "1.0.0",
			extras: [join(outDir, "nested")],
		});
		await expect(result).rejects.toThrow("is inside outDir");
		expect(await readdir(join(outDir, "nested"))).toEqual(["SKILL.md"]);
	});

	it("requires a generated skill description", async () => {
		const outDir = join(tempRoot, "skills");
		const app = new Crust("demo").action(() => {});

		await expect(writeSkills({ app: app, outDir, version: "1.0.0" })).rejects.toThrow(
			"requires a description",
		);
		await expect(readdir(outDir)).rejects.toThrow();
	});

	it("requires the package skills directory layout", async () => {
		const outDir = join(tempRoot, "agent-skills");

		await expect(writeSkills({ app: createApp(), outDir, version: "1.0.0" })).rejects.toThrow(
			'must be named "skills"',
		);
		await expect(readdir(outDir)).rejects.toThrow();
	});

	it("rejects an invalid skill name before writing", async () => {
		const outDir = join(tempRoot, "skills");

		const result = writeSkills({ app: createApp(), outDir, version: "1.0.0", name: "Bad_Name" });
		await expect(result).rejects.toThrow('Invalid skill name "Bad_Name"');
		await expect(readdir(outDir)).rejects.toThrow();
	});
});
