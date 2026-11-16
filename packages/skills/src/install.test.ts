import {
	chmod,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readlink,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { withCwd, withHome } from "../tests/fixtures.ts";
import { SkillConflictError } from "./errors.ts";
import { getSkillStatus, installSkill, uninstallSkill } from "./install.ts";

let tempRoot: string;

beforeEach(async () => {
	tempRoot = await mkdtemp(join(tmpdir(), "crust-link-skill-"));
	vi.stubEnv("CLAUDE_CONFIG_DIR", undefined);
});

afterEach(async () => {
	vi.unstubAllEnvs();
	await rm(tempRoot, { recursive: true, force: true });
});

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

function sharedDir(name = "demo"): string {
	return join(tempRoot, ".agents", "skills", name);
}

async function projectInstall(sourceDir: string, force?: boolean) {
	return withCwd(tempRoot, () =>
		installSkill({ sourceDir, agents: ["claude-code"], scope: "project", force }),
	);
}

describe("symlink-only skill installation", () => {
	it("reports the effective global scope when project scope is requested from home", async () => {
		const name = "crust-effective-scope-test";
		const sourceDir = await createSource(name);
		const result = await withCwd(homedir(), () =>
			getSkillStatus({ name, sourceDir, agents: ["codex"], scope: "project" }),
		);

		expect(result.agents[0]).toMatchObject({
			outputDir: join(homedir(), ".agents", "skills", name),
			scope: "global",
		});
	});

	it("links the shared folder to the source and the agent folder to the shared link", async () => {
		const sourceDir = await createSource();
		const installed = await projectInstall(sourceDir);

		expect(installed.shared).toEqual({
			outputDir: sharedDir(),
			scope: "project",
			status: "installed",
		});
		expect(installed.agents[0]).toMatchObject({
			outputDir: outputDir(),
			scope: "project",
			status: "installed",
		});
		expect(await readlink(sharedDir())).toBe(join("..", "..", "package", "skills", "demo"));
		expect(await readlink(outputDir())).toBe(join("..", "..", ".agents", "skills", "demo"));
		expect(await readFile(join(outputDir(), "commands", "run.md"), "utf8")).toBe("run\n");
	});

	it("uses absolute links at global scope", async () => {
		const sourceDir = await createSource();
		const home = join(tempRoot, "home");
		await mkdir(home);
		const installed = await withHome(home, () =>
			installSkill({ sourceDir, agents: ["claude-code"], scope: "global" }),
		);

		const shared = join(home, ".agents", "skills", "demo");
		expect(installed.shared.outputDir).toBe(shared);
		expect(await readlink(shared)).toBe(sourceDir);
		expect(await readlink(join(home, ".claude", "skills", "demo"))).toBe(shared);
	});

	it("links an agent that reads the shared folder only in the project at global scope", async () => {
		const sourceDir = await createSource();
		const home = join(tempRoot, "home");
		await mkdir(home);
		await withHome(home, async () => {
			const project = await withCwd(tempRoot, () =>
				installSkill({ sourceDir, agents: ["cursor"], scope: "project" }),
			);
			expect(project.agents).toEqual([
				{ agent: "cursor", outputDir: sharedDir(), scope: "project", status: "installed" },
			]);
			const global = await installSkill({ sourceDir, agents: ["cursor"], scope: "global" });
			expect(global.agents[0]?.outputDir).toBe(join(home, ".cursor", "skills", "demo"));
			expect(await readlink(join(home, ".cursor", "skills", "demo"))).toBe(
				join(home, ".agents", "skills", "demo"),
			);
		});
	});

	it("links the shared folder once from the home directory", async () => {
		const sourceDir = await createSource();
		const result = await withHome(tempRoot, () =>
			withCwd(tempRoot, () =>
				installSkill({ sourceDir, agents: ["codex", "claude-code"], scope: "project" }),
			),
		);
		expect(result.shared).toMatchObject({ outputDir: sharedDir(), scope: "global" });
		expect(result.agents.map((entry) => entry.outputDir)).toEqual([sharedDir(), outputDir()]);
		expect(await readlink(sharedDir())).toBe(sourceDir);
		expect(await readlink(outputDir())).toBe(sharedDir());
	});

	it("makes no agent link when the shared folder is a conflict", async () => {
		const sourceDir = await createSource();
		await mkdir(sharedDir(), { recursive: true });

		const error = await projectInstall(sourceDir).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(SkillConflictError);
		expect((error as SkillConflictError).details).toEqual({ outputDir: sharedDir() });
		await expect(lstat(outputDir())).rejects.toThrow();
	});

	it("keeps an older agent link that points straight at the source", async () => {
		const sourceDir = await createSource();
		await mkdir(dirname(outputDir()), { recursive: true });
		await symlink(join("..", "..", "package", "skills", "demo"), outputDir());

		const result = await projectInstall(sourceDir);
		expect(result.shared.status).toBe("installed");
		expect(result.agents[0]?.status).toBe("up-to-date");
		expect(await readlink(outputDir())).toBe(join("..", "..", "package", "skills", "demo"));
	});

	it("leaves a healthy correct link up to date", async () => {
		const sourceDir = await createSource();
		await projectInstall(sourceDir);
		const result = await projectInstall(sourceDir);
		expect(result.agents[0]?.status).toBe("up-to-date");
	});

	it("repairs dangling and stale-target owned links", async () => {
		const sourceDir = await createSource();
		await mkdir(dirname(outputDir()), { recursive: true });
		await symlink(join(tempRoot, "missing", "skills", "demo"), outputDir());

		let result = await projectInstall(sourceDir);
		expect(result.agents[0]?.status).toBe("repaired");
		expect(resolve(dirname(outputDir()), await readlink(outputDir()))).toBe(sharedDir());

		await rm(outputDir());
		const staleSource = join(tempRoot, "old-package", "skills", "demo");
		await mkdir(staleSource, { recursive: true });
		await symlink(staleSource, outputDir());
		const staleStatus = await withCwd(tempRoot, () =>
			getSkillStatus({
				name: "demo",
				sourceDir,
				agents: ["claude-code"],
				scope: "project",
			}),
		);
		expect(staleStatus.agents[0]?.status).toBe("dangling");
		result = await projectInstall(sourceDir);
		expect(result.agents[0]?.status).toBe("repaired");
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

		expect((await status()).agents[0]).toMatchObject({ scope: "project", status: "absent" });
		await projectInstall(sourceDir);
		expect((await status()).agents[0]?.status).toBe("linked");
		await rm(sourceDir, { recursive: true });
		expect((await status()).agents[0]?.status).toBe("dangling");
		await rm(outputDir());
		await mkdir(outputDir(), { recursive: true });
		expect((await status()).agents[0]?.status).toBe("conflict");
	});

	it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
		"rejects permission failures inspecting entries and targets instead of reporting missing",
		async () => {
			const sourceDir = await createSource();
			const options = {
				name: "demo",
				sourceDir,
				agents: ["claude-code" as const],
				scope: "project" as const,
			};
			await projectInstall(sourceDir);
			for (const denied of [join(tempRoot, ".claude"), join(tempRoot, "package")]) {
				await chmod(denied, 0o000);
				try {
					await withCwd(tempRoot, async () => {
						await expect(getSkillStatus(options)).rejects.toMatchObject({ code: "EACCES" });
						await expect(uninstallSkill(options)).rejects.toMatchObject({ code: "EACCES" });
					});
				} finally {
					await chmod(denied, 0o755);
				}
				expect((await lstat(outputDir())).isSymbolicLink()).toBe(true);
			}
			await rm(outputDir());
			const missing = await withCwd(tempRoot, () => uninstallSkill(options));
			expect(missing.agents[0]?.status).toBe("not-found");
		},
	);

	it("unlinks the shared and agent links but leaves conflicts", async () => {
		const sourceDir = await createSource();
		await projectInstall(sourceDir);
		const kiro = join(tempRoot, ".kiro", "skills", "demo");
		await mkdir(kiro, { recursive: true });

		const result = await withCwd(tempRoot, () =>
			uninstallSkill({ name: "demo", scope: "project" }),
		);

		const statuses = new Map(result.agents.map((entry) => [entry.outputDir, entry.status]));
		expect(statuses.get(sharedDir())).toBe("removed");
		expect(statuses.get(outputDir())).toBe("removed");
		expect(statuses.get(kiro)).toBe("not-found");
		await expect(lstat(sharedDir())).rejects.toThrow();
		await expect(lstat(outputDir())).rejects.toThrow();
		expect((await lstat(kiro)).isDirectory()).toBe(true);
	});

	it("unlinks owned healthy and dangling links but skips conflicts", async () => {
		const sourceDir = await createSource();
		await projectInstall(sourceDir);
		await rm(sourceDir, { recursive: true });
		let result = await withCwd(tempRoot, () =>
			uninstallSkill({ name: "demo", agents: ["claude-code"], scope: "project" }),
		);
		expect(result.agents[0]).toMatchObject({ scope: "project", status: "removed" });
		await expect(lstat(outputDir())).rejects.toThrow();

		await mkdir(outputDir(), { recursive: true });
		result = await withCwd(tempRoot, () =>
			uninstallSkill({ name: "demo", agents: ["claude-code"], scope: "project" }),
		);
		expect(result.agents[0]?.status).toBe("not-found");
		expect((await lstat(outputDir())).isDirectory()).toBe(true);
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
