import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Crust } from "@crustjs/core";

import { skill } from "./extension.ts";
import { installSkill } from "./generate.ts";
import { SkillSourceUnavailableError, loadPackagedSkills } from "./source.ts";

let tempRoot: string;

beforeEach(async () => {
	tempRoot = await mkdtemp(join(tmpdir(), "crust-skill-plugin-"));
});

afterEach(async () => {
	await rm(tempRoot, { recursive: true, force: true });
});

async function withCwd<T>(dir: string, run: () => Promise<T>): Promise<T> {
	const cwd = process.cwd;
	process.cwd = () => dir;
	try {
		return await run();
	} finally {
		process.cwd = cwd;
	}
}

async function writeSource(name: string, version: string): Promise<string> {
	const root = join(tempRoot, "skills");
	const dir = join(root, name);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${name}\n---\n`);
	await writeFile(join(dir, "content.md"), `${version}\n`);
	await writeFile(
		join(dir, "crust.json"),
		JSON.stringify({ name, description: name, version, kind: "generated" }),
	);
	return root;
}

function createApp(source: string | URL) {
	return new Crust("demo", { description: "Demo" })
		.extend(skill({ source, defaultScope: "project" }))
		.action(() => {});
}

describe("skill extension package sources", () => {
	it("installs every packaged skill by copy", async () => {
		const source = await writeSource("demo", "1.0.0");
		await writeSource("guide", "1.0.0");
		await withCwd(tempRoot, () => createApp(source).execute({ argv: ["skill", "--all"] }));

		expect(await readFile(join(tempRoot, ".agents", "skills", "demo", "content.md"), "utf8")).toBe(
			"1.0.0\n",
		);
		expect(await readFile(join(tempRoot, ".agents", "skills", "guide", "content.md"), "utf8")).toBe(
			"1.0.0\n",
		);
	});

	it("does not let --all overwrite an unowned agent directory", async () => {
		const source = await writeSource("demo", "1.0.0");
		const target = join(tempRoot, ".agents", "skills", "demo");
		await mkdir(target, { recursive: true });
		await writeFile(join(target, "manual.md"), "keep\n");

		await withCwd(tempRoot, () => createApp(source).execute({ argv: ["skill", "--all"] }));
		expect(await readFile(join(target, "manual.md"), "utf8")).toBe("keep\n");
	});

	it("continues --all installs after an unowned agent directory", async () => {
		const source = await writeSource("demo", "1.0.0");
		await withCwd(tempRoot, () =>
			installSkill({
				sourceDir: join(source, "demo"),
				agents: ["claude-code"],
				scope: "project",
			}),
		);
		await writeSource("demo", "2.0.0");
		const conflict = join(tempRoot, ".agents", "skills", "demo");
		await mkdir(conflict, { recursive: true });
		await writeFile(join(conflict, "manual.md"), "keep\n");

		await withCwd(tempRoot, () => createApp(source).execute({ argv: ["skill", "--all"] }));

		expect(await readFile(join(conflict, "manual.md"), "utf8")).toBe("keep\n");
		expect(await readFile(join(tempRoot, ".claude", "skills", "demo", "content.md"), "utf8")).toBe(
			"2.0.0\n",
		);
	});

	it("auto-updates installed copies from a newer skill source", async () => {
		const source = await writeSource("demo", "1.0.0");
		await withCwd(tempRoot, () =>
			installSkill({
				sourceDir: join(source, "demo"),
				agents: ["claude-code"],
				scope: "project",
			}),
		);
		await writeSource("demo", "2.0.0");

		await withCwd(tempRoot, () => createApp(source).execute({ argv: [] }));
		expect(await readFile(join(tempRoot, ".claude", "skills", "demo", "content.md"), "utf8")).toBe(
			"2.0.0\n",
		);
	});

	it("fails clearly when its source cannot be resolved", async () => {
		await expect(loadPackagedSkills(join(tempRoot, "missing-skills"))).rejects.toBeInstanceOf(
			SkillSourceUnavailableError,
		);
	});

	it("does not break unrelated commands when the source is unavailable", async () => {
		let ran = false;
		const app = new Crust("demo")
			.extend(skill({ source: join(tempRoot, "missing-skills") }))
			.action(() => {
				ran = true;
			});
		await app.execute({ argv: [] });
		expect(ran).toBe(true);
	});
});
