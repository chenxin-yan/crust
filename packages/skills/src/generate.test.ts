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

	it("skips the copy when the installed version is current", async () => {
		const sourceDir = await createSource("1.0.0");
		await withCwd(tempRoot, () =>
			installSkill({ sourceDir, agents: ["claude-code"], scope: "project" }),
		);
		const outputDir = join(tempRoot, ".claude", "skills", "demo");
		// A marker the copy would remove proves the second install did not rewrite the dir.
		await writeFile(join(outputDir, "marker.md"), "untouched");

		const result = await withCwd(tempRoot, () =>
			installSkill({ sourceDir, agents: ["claude-code"], scope: "project" }),
		);
		expect(result.agents[0]).toMatchObject({ status: "up-to-date", files: [] });
		expect(await readFile(join(outputDir, "marker.md"), "utf8")).toBe("untouched");
	});

	it("force-overwrites an unowned directory", async () => {
		const sourceDir = await createSource("1.0.0");
		const outputDir = join(tempRoot, ".claude", "skills", "demo");
		await mkdir(outputDir, { recursive: true });
		await writeFile(join(outputDir, "manual.md"), "clobbered");

		const result = await withCwd(tempRoot, () =>
			installSkill({ sourceDir, agents: ["claude-code"], scope: "project", force: true }),
		);
		expect(result.agents[0]?.status).toBe("updated");
		expect(await readFile(join(outputDir, "SKILL.md"), "utf8")).toContain("name: demo");
		await expect(stat(join(outputDir, "manual.md"))).rejects.toThrow();
	});

	it("force-reinstalls an up-to-date copy as updated", async () => {
		const sourceDir = await createSource("1.0.0");
		await withCwd(tempRoot, () =>
			installSkill({ sourceDir, agents: ["claude-code"], scope: "project" }),
		);

		const result = await withCwd(tempRoot, () =>
			installSkill({ sourceDir, agents: ["claude-code"], scope: "project", force: true }),
		);
		expect(result.agents[0]?.status).toBe("updated");
	});

	it("reports a kind mismatch as a conflict", async () => {
		const sourceDir = await createSource("1.0.0");
		const outputDir = join(tempRoot, ".claude", "skills", "demo");
		await mkdir(outputDir, { recursive: true });
		await writeFile(
			join(outputDir, "crust.json"),
			JSON.stringify({ name: "demo", description: "Demo", version: "1.0.0", kind: "bundle" }),
		);

		const error = await withCwd(tempRoot, () =>
			installSkill({ sourceDir, agents: ["claude-code"], scope: "project" }),
		).then(
			() => null,
			(caught: unknown) => caught,
		);
		expect(error).toBeInstanceOf(SkillConflictError);
		expect((error as SkillConflictError).details.kindMismatch).toEqual({
			existing: "bundle",
			attempted: "generated",
		});
	});

	it("reports a malformed target manifest as a conflict, not an overwrite", async () => {
		const sourceDir = await createSource("1.0.0");
		const outputDir = join(tempRoot, ".claude", "skills", "demo");
		await mkdir(outputDir, { recursive: true });
		await writeFile(join(outputDir, "crust.json"), "not json");

		const error = await withCwd(tempRoot, () =>
			installSkill({ sourceDir, agents: ["claude-code"], scope: "project" }),
		).then(
			() => null,
			(caught: unknown) => caught,
		);
		expect(error).toBeInstanceOf(SkillConflictError);
		expect((error as SkillConflictError).details.manifestMalformed).toBeDefined();
		expect(await readFile(join(outputDir, "crust.json"), "utf8")).toBe("not json");
	});

	it("copies once for agents sharing an output directory", async () => {
		const sourceDir = await createSource("1.0.0");
		const result = await withCwd(tempRoot, () =>
			installSkill({ sourceDir, agents: ["codex", "opencode"], scope: "project" }),
		);
		expect(result.agents).toHaveLength(2);
		expect(result.agents[0]?.outputDir).toBe(result.agents[1]?.outputDir);
		expect(result.agents.map((entry) => entry.status)).toEqual(["installed", "installed"]);
	});

	it("rejects a source without a valid crust.json", async () => {
		const sourceDir = join(tempRoot, "source", "bare");
		await mkdir(sourceDir, { recursive: true });
		await writeFile(join(sourceDir, "SKILL.md"), "---\nname: bare\n---\n");

		await expect(
			installSkill({ sourceDir, agents: ["claude-code"], scope: "project" }),
		).rejects.toThrow("no valid crust.json");
	});

	it("rejects a source declaring an invalid skill name", async () => {
		const sourceDir = join(tempRoot, "source", "bad-name");
		await mkdir(sourceDir, { recursive: true });
		await writeFile(join(sourceDir, "SKILL.md"), "---\nname: Bad Name\n---\n");
		await writeFile(
			join(sourceDir, "crust.json"),
			JSON.stringify({ name: "Bad Name", description: "x", version: "1.0.0", kind: "generated" }),
		);

		await expect(
			installSkill({ sourceDir, agents: ["claude-code"], scope: "project" }),
		).rejects.toThrow('invalid name "Bad Name"');
	});

	it("rejects a source missing SKILL.md", async () => {
		const sourceDir = join(tempRoot, "source", "no-entry");
		await mkdir(sourceDir, { recursive: true });
		await writeFile(
			join(sourceDir, "crust.json"),
			JSON.stringify({ name: "no-entry", description: "x", version: "1.0.0", kind: "generated" }),
		);

		await expect(
			installSkill({ sourceDir, agents: ["claude-code"], scope: "project" }),
		).rejects.toThrow("missing SKILL.md");
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
