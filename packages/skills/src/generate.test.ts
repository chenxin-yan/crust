import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	chmod,
	lstat,
	mkdir,
	readdir,
	mkdtemp,
	readFile,
	readlink,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { SkillConflictError } from "./errors.ts";
import { getSkillStatus, installSkill, uninstallSkill } from "./generate.ts";

let tempRoot: string;

beforeEach(async () => {
	tempRoot = await mkdtemp(join(tmpdir(), "crust-link-skill-"));
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

async function createSource(name = "demo"): Promise<string> {
	const sourceDir = join(tempRoot, "package", "skills", name);
	await mkdir(join(sourceDir, "commands"), { recursive: true });
	await writeFile(
		join(sourceDir, "SKILL.md"),
		`---\nname: ${name}\ndescription: Demo skill\n---\n`,
	);
	await writeFile(join(sourceDir, "commands", "run.md"), "run\n");
	return sourceDir;
}

function outputDir(name = "demo"): string {
	return join(tempRoot, ".claude", "skills", name);
}

async function projectInstall(sourceDir: string, force?: boolean) {
	return withCwd(tempRoot, () =>
		installSkill({ sourceDir, agents: ["claude-code"], scope: "project", force }),
	);
}

describe("symlink-only skill installation", () => {
	it("installs a relative project link", async () => {
		const sourceDir = await createSource();
		const installed = await projectInstall(sourceDir);

		expect(installed.agents[0]).toMatchObject({ outputDir: outputDir(), status: "installed" });
		expect(resolve(dirname(outputDir()), await readlink(outputDir()))).toBe(sourceDir);
		expect(await readFile(join(outputDir(), "commands", "run.md"), "utf8")).toBe("run\n");
	});

	it("leaves a healthy correct link up to date", async () => {
		const sourceDir = await createSource();
		await projectInstall(sourceDir);
		const result = await projectInstall(sourceDir);
		expect(result.agents[0]?.status).toBe("up-to-date");
	});

	it("repairs dangling owned links but conflicts on resolving wrong-target links", async () => {
		const sourceDir = await createSource();
		await mkdir(dirname(outputDir()), { recursive: true });
		await symlink(join(tempRoot, "missing", "skills", "demo"), outputDir());

		const result = await projectInstall(sourceDir);
		expect(result.agents[0]?.status).toBe("repaired");
		expect(resolve(dirname(outputDir()), await readlink(outputDir()))).toBe(sourceDir);

		await rm(outputDir());
		const foreignSource = join(tempRoot, "other-package", "skills", "demo");
		await mkdir(foreignSource, { recursive: true });
		await symlink(foreignSource, outputDir());
		const foreignStatus = await withCwd(tempRoot, () =>
			getSkillStatus({
				name: "demo",
				sourceDir,
				agents: ["claude-code"],
				scope: "project",
			}),
		);
		expect(foreignStatus.agents[0]?.status).toBe("conflict");
		await expect(projectInstall(sourceDir)).rejects.toBeInstanceOf(SkillConflictError);
	});

	it("preserves a real directory and cleans staging entries when link staging fails", async () => {
		if (process.platform === "win32") return;
		const sourceDir = await createSource();
		await mkdir(outputDir(), { recursive: true });
		await writeFile(join(outputDir(), "manual.md"), "keep");
		const parent = dirname(outputDir());
		await chmod(parent, 0o555);
		try {
			await expect(projectInstall(sourceDir, true)).rejects.toThrow(
				"Could not create skill symlink",
			);
			expect(await readFile(join(outputDir(), "manual.md"), "utf8")).toBe("keep");
		} finally {
			await chmod(parent, 0o755);
		}
		expect(await readdir(parent)).toEqual(["demo"]);
	});

	it("conflicts on real directories and foreign links unless forced", async () => {
		const sourceDir = await createSource();
		await mkdir(outputDir(), { recursive: true });
		await writeFile(join(outputDir(), "manual.md"), "keep");
		await expect(projectInstall(sourceDir)).rejects.toBeInstanceOf(SkillConflictError);
		expect(await readFile(join(outputDir(), "manual.md"), "utf8")).toBe("keep");

		const forced = await projectInstall(sourceDir, true);
		expect(forced.agents[0]?.status).toBe("repaired");
		expect((await lstat(outputDir())).isSymbolicLink()).toBe(true);

		await rm(outputDir());
		await symlink(join(tempRoot, "foreign", "demo"), outputDir());
		await expect(projectInstall(sourceDir)).rejects.toBeInstanceOf(SkillConflictError);
	});

	it("reports linked, dangling, conflict, and absent states", async () => {
		const sourceDir = await createSource();
		const status = () =>
			withCwd(tempRoot, () =>
				getSkillStatus({
					name: "demo",
					sourceDir,
					agents: ["claude-code"],
					scope: "project",
				}),
			);

		expect((await status()).agents[0]?.status).toBe("absent");
		await projectInstall(sourceDir);
		expect((await status()).agents[0]?.status).toBe("linked");
		await rm(sourceDir, { recursive: true });
		expect((await status()).agents[0]?.status).toBe("dangling");
		await rm(outputDir());
		await mkdir(outputDir(), { recursive: true });
		expect((await status()).agents[0]?.status).toBe("conflict");
	});

	it("unlinks exact and dangling owned links but skips resolving wrong-target links", async () => {
		const sourceDir = await createSource();
		await projectInstall(sourceDir);
		let result = await withCwd(tempRoot, () =>
			uninstallSkill({
				name: "demo",
				sourceDir,
				agents: ["claude-code"],
				scope: "project",
			}),
		);
		expect(result.agents[0]?.status).toBe("removed");

		await symlink(join(tempRoot, "missing", "skills", "demo"), outputDir());
		result = await withCwd(tempRoot, () =>
			uninstallSkill({
				name: "demo",
				sourceDir,
				agents: ["claude-code"],
				scope: "project",
			}),
		);
		expect(result.agents[0]?.status).toBe("removed");

		const foreignSource = join(tempRoot, "foreign", "skills", "demo");
		await mkdir(foreignSource, { recursive: true });
		await symlink(foreignSource, outputDir());
		result = await withCwd(tempRoot, () =>
			uninstallSkill({
				name: "demo",
				sourceDir,
				agents: ["claude-code"],
				scope: "project",
			}),
		);
		expect(result.agents[0]?.status).toBe("not-found");
		expect(resolve(dirname(outputDir()), await readlink(outputDir()))).toBe(foreignSource);
	});

	it("rejects an output that contains its source without deleting the source", async () => {
		const sourceDir = join(tempRoot, "skills", "demo");
		await mkdir(sourceDir, { recursive: true });
		await writeFile(join(sourceDir, "SKILL.md"), "---\nname: demo\ndescription: Demo skill\n---\n");

		await expect(
			withCwd(tempRoot, () =>
				installSkill({
					sourceDir,
					agents: ["openclaw"],
					scope: "project",
					force: true,
				}),
			),
		).rejects.toThrow("contains packaged source");
		expect(await readFile(join(sourceDir, "SKILL.md"), "utf8")).toContain("name: demo");
	});

	it("links once for agents sharing an output directory", async () => {
		const sourceDir = await createSource();
		const result = await withCwd(tempRoot, () =>
			installSkill({ sourceDir, agents: ["codex", "opencode"], scope: "project" }),
		);
		expect(result.agents).toHaveLength(2);
		expect(result.agents[0]?.outputDir).toBe(result.agents[1]?.outputDir);
		expect(result.agents.map((entry) => entry.status)).toEqual(["installed", "installed"]);
	});

	it("keeps a package-manager logical node_modules path as the link target", async () => {
		const realPackage = join(tempRoot, ".store", "pkg");
		const sourceDir = join(realPackage, "skills", "demo");
		await mkdir(join(sourceDir, "commands"), { recursive: true });
		await writeFile(join(sourceDir, "SKILL.md"), "---\nname: demo\ndescription: Demo skill\n---\n");
		const logicalPackage = join(tempRoot, "node_modules", "pkg");
		await mkdir(dirname(logicalPackage), { recursive: true });
		await symlink(realPackage, logicalPackage, "dir");
		const logicalSource = join(logicalPackage, "skills", "demo");

		await projectInstall(logicalSource);
		expect(resolve(dirname(outputDir()), await readlink(outputDir()))).toBe(logicalSource);
	});

	it("requires valid SKILL.md frontmatter and the package skills/<name> layout", async () => {
		const missing = join(tempRoot, "package", "skills", "missing");
		await mkdir(missing, { recursive: true });
		await expect(projectInstall(missing)).rejects.toThrow("missing SKILL.md");

		const invalid = await createSource("Bad Name");
		await expect(projectInstall(invalid)).rejects.toThrow('invalid name "Bad Name"');

		const wrongLayout = join(tempRoot, "source", "demo");
		await mkdir(wrongLayout, { recursive: true });
		await writeFile(join(wrongLayout, "SKILL.md"), "---\nname: demo\ndescription: Demo\n---\n");
		await expect(projectInstall(wrongLayout)).rejects.toThrow("must be named");
	});
});
