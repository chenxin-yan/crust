import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SkillConflictError } from "./errors.ts";
import { getSkillStatus, installSkill, uninstallSkill } from "./generate.ts";

let tempRoot: string;

beforeEach(async () => {
	tempRoot = await mkdtemp(join(tmpdir(), "crust-copy-skill-"));
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

async function createSource(version: string): Promise<string> {
	const sourceDir = join(tempRoot, "source", "demo");
	await mkdir(join(sourceDir, "commands"), { recursive: true });
	await writeFile(join(sourceDir, "SKILL.md"), "---\nname: demo\ndescription: Demo\n---\n");
	await writeFile(join(sourceDir, "commands", "run.md"), `version ${version}\n`);
	await writeFile(
		join(sourceDir, "crust.json"),
		JSON.stringify({ name: "demo", description: "Demo", version, kind: "generated" }),
	);
	return sourceDir;
}

describe("copy-only skill installation", () => {
	it("copies a packaged source directly into agent directories", async () => {
		const sourceDir = await createSource("1.0.0");
		const result = await withCwd(tempRoot, () =>
			installSkill({ sourceDir, agents: ["claude-code"], scope: "project" }),
		);
		const outputDir = join(tempRoot, ".claude", "skills", "demo");

		expect(result.agents[0]).toMatchObject({ outputDir, status: "installed" });
		expect(await readFile(join(outputDir, "commands", "run.md"), "utf8")).toBe("version 1.0.0\n");
		await expect(stat(join(tempRoot, ".crust"))).rejects.toThrow();
	});

	it("refreshes a stale copy after the source version changes", async () => {
		const sourceDir = await createSource("1.0.0");
		await withCwd(tempRoot, () =>
			installSkill({ sourceDir, agents: ["claude-code"], scope: "project" }),
		);
		await writeFile(join(join(tempRoot, ".claude", "skills", "demo"), "stale.md"), "remove");
		await createSource("2.0.0");

		const result = await withCwd(tempRoot, () =>
			installSkill({ sourceDir, agents: ["claude-code"], scope: "project" }),
		);
		const outputDir = join(tempRoot, ".claude", "skills", "demo");
		expect(result.agents[0]).toMatchObject({ status: "updated", previousVersion: "1.0.0" });
		expect(await readFile(join(outputDir, "commands", "run.md"), "utf8")).toBe("version 2.0.0\n");
		await expect(stat(join(outputDir, "stale.md"))).rejects.toThrow();
	});

	it("does not clobber or uninstall an unowned directory", async () => {
		const sourceDir = await createSource("1.0.0");
		const outputDir = join(tempRoot, ".claude", "skills", "demo");
		await mkdir(outputDir, { recursive: true });
		await writeFile(join(outputDir, "manual.md"), "keep");

		await expect(
			withCwd(tempRoot, () =>
				installSkill({ sourceDir, agents: ["claude-code"], scope: "project" }),
			),
		).rejects.toBeInstanceOf(SkillConflictError);
		const removed = await withCwd(tempRoot, () =>
			uninstallSkill({ name: "demo", agents: ["claude-code"], scope: "project" }),
		);
		expect(removed.agents[0]?.status).toBe("not-found");
		expect(await readFile(join(outputDir, "manual.md"), "utf8")).toBe("keep");
	});

	it("reports and removes an owned copy", async () => {
		const sourceDir = await createSource("1.0.0");
		await withCwd(tempRoot, () =>
			installSkill({ sourceDir, agents: ["claude-code"], scope: "project" }),
		);
		const status = await withCwd(tempRoot, () =>
			getSkillStatus({ name: "demo", agents: ["claude-code"], scope: "project" }),
		);
		expect(status.agents[0]).toMatchObject({ installed: true, version: "1.0.0" });
		const removed = await withCwd(tempRoot, () =>
			uninstallSkill({ name: "demo", agents: ["claude-code"], scope: "project" }),
		);
		expect(removed.agents[0]?.status).toBe("removed");
	});
});
