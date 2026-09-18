import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Crust, defineCommand } from "@crustjs/core";

import { renderSkills, writeSkills } from "./build.ts";
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

		const artifacts = await writeSkills({
			app: createApp(),
			outDir,
			version: "1.2.3",
			extras: [bundleDir],
		});

		expect(artifacts).toEqual([
			join("deployment-guide", "SKILL.md"),
			join("deployment-guide", "references", "guide.md"),
			join("demo", "SKILL.md"),
			join("demo", "commands", "demo.md"),
			join("demo", "commands", "serve.md"),
		]);
		expect((await readdir(tempRoot)).sort()).toEqual(["deployment-guide", "skills"]);
		expect(await readFile(join(outDir, "demo", "SKILL.md"), "utf8")).toContain("name: demo");
		const serve = await readFile(join(outDir, "demo", "commands", "serve.md"), "utf8");
		expect(serve).toContain("# `demo serve`");
		expect(serve).toContain("## Deployment\nCheck the target environment first.");
		expect((await readdir(join(outDir, "demo"))).sort()).toEqual(["SKILL.md", "commands"]);
		expect(await readFile(join(outDir, "deployment-guide", "references", "guide.md"), "utf8")).toBe(
			"# Guide\n",
		);
		expect((await readdir(join(outDir, "deployment-guide"))).sort()).toEqual([
			"SKILL.md",
			"references",
		]);
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

	it("replaces a symlinked skill directory instead of writing through it", async () => {
		const authored = await createBundle("demo", "Hand-written demo skill");
		const outDir = join(tempRoot, "skills");
		await mkdir(outDir, { recursive: true });
		await symlink(authored, join(outDir, "demo"));

		await writeSkills({ app: createApp(), outDir, version: "1.0.0" });

		expect(await readFile(join(authored, "SKILL.md"), "utf8")).toContain(
			"description: Hand-written demo skill",
		);
		expect((await readdir(authored)).sort()).toEqual(["SKILL.md", "references"]);
		expect((await lstat(join(outDir, "demo"))).isSymbolicLink()).toBe(false);
		expect(await readFile(join(outDir, "demo", "SKILL.md"), "utf8")).toContain(
			"description: Demo CLI",
		);
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

describe("renderSkills", () => {
	it("returns generated and authored skill files without touching disk", async () => {
		const bundleDir = await createBundle("deployment-guide", "Deployment guidance");
		const snapshot = await createApp().snapshot();

		const files = await renderSkills(snapshot, { version: "1.2.3", extras: [bundleDir] });

		expect(files.map((file) => file.path)).toEqual([
			join("deployment-guide", "SKILL.md"),
			join("deployment-guide", "references", "guide.md"),
			join("demo", "SKILL.md"),
			join("demo", "commands", "demo.md"),
			join("demo", "commands", "serve.md"),
		]);
		expect(files[1]?.content).toEqual(Buffer.from("# Guide\n"));
		expect(files[2]?.content).toContain("name: demo");
		expect(await readdir(tempRoot)).toEqual(["deployment-guide"]);
	});

	it("renders only authored skills without a snapshot", async () => {
		const bundleDir = await createBundle("guide", "Authored guidance");

		const files = await renderSkills(undefined, { extras: [bundleDir] });

		expect(files.map((file) => file.path)).toEqual([
			join("guide", "SKILL.md"),
			join("guide", "references", "guide.md"),
		]);
		await expect(renderSkills(undefined, {})).rejects.toThrow("Nothing to write");
	});
});
