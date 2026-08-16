import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
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
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { Crust } from "@crustjs/core";
import * as prompts from "@crustjs/prompts";

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

async function writeSource(name: string, content = name): Promise<string> {
	const root = join(tempRoot, "package", "skills");
	const dir = join(root, name);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${name}\n---\n`);
	await writeFile(join(dir, "content.md"), `${content}\n`);
	return root;
}

function createApp(source: string | URL, autoUpdate = true) {
	return new Crust("demo", { description: "Demo" })
		.extend(skill({ source, defaultScope: "project", autoUpdate }))
		.action(() => {});
}

function target(name = "demo") {
	return join(tempRoot, ".agents", "skills", name);
}

describe("skill extension package sources", () => {
	it("installs every packaged skill as a link", async () => {
		const source = await writeSource("demo");
		await writeSource("guide");
		await withCwd(tempRoot, () => createApp(source).execute({ argv: ["skill", "--all"] }));

		expect((await lstat(target("demo"))).isSymbolicLink()).toBe(true);
		expect((await lstat(target("guide"))).isSymbolicLink()).toBe(true);
		expect(await readFile(join(target("demo"), "content.md"), "utf8")).toBe("demo\n");
	});

	it("does not let --all overwrite an unowned agent directory", async () => {
		const source = await writeSource("demo");
		await mkdir(target(), { recursive: true });
		await writeFile(join(target(), "manual.md"), "keep\n");

		await withCwd(tempRoot, () => createApp(source).execute({ argv: ["skill", "--all"] }));
		expect(await readFile(join(target(), "manual.md"), "utf8")).toBe("keep\n");
	});

	it("does not rewrite a resolving wrong-target link before ordinary commands", async () => {
		const source = await writeSource("demo", "current");
		const foreign = join(tempRoot, "other-package", "skills", "demo");
		await mkdir(foreign, { recursive: true });
		await writeFile(join(foreign, "content.md"), "foreign\n");
		const installed = join(tempRoot, ".claude", "skills", "demo");
		await mkdir(dirname(installed), { recursive: true });
		await symlink(foreign, installed);

		await withCwd(tempRoot, () => createApp(source).execute({ argv: [] }));
		expect(resolve(dirname(installed), await readlink(installed))).toBe(foreign);
		expect(await readFile(join(installed, "content.md"), "utf8")).toBe("foreign\n");
	});

	it("never creates links that were not installed", async () => {
		const source = await writeSource("demo");
		await withCwd(tempRoot, () => createApp(source).execute({ argv: [] }));
		await expect(lstat(target())).rejects.toThrow();
	});

	it("repairs links via the skill update command", async () => {
		const source = await writeSource("demo");
		const installed = join(tempRoot, ".claude", "skills", "demo");
		await mkdir(dirname(installed), { recursive: true });
		await symlink(join(tempRoot, "missing", "skills", "demo"), installed);

		await withCwd(tempRoot, () =>
			createApp(source).execute({ argv: ["skill", "update", "--scope", "project"] }),
		);
		expect(resolve(dirname(installed), await readlink(installed))).toBe(join(source, "demo"));
	});

	it("warns and continues when automatic repair lacks filesystem permission", async () => {
		if (process.platform === "win32") return;
		const source = await writeSource("demo");
		const installed = join(tempRoot, ".claude", "skills", "demo");
		const parent = dirname(installed);
		await mkdir(parent, { recursive: true });
		await symlink(join(tempRoot, "missing", "skills", "demo"), installed);
		await chmod(parent, 0o555);

		let ran = false;
		const app = new Crust("demo", { description: "Demo" })
			.extend(skill({ source, defaultScope: "project" }))
			.action(() => {
				ran = true;
			});
		try {
			await withCwd(tempRoot, () => app.execute({ argv: [] }));
			expect(ran).toBe(true);
			expect(await readlink(installed)).toContain("missing/skills/demo");

			await withCwd(tempRoot, () =>
				app.execute({ argv: ["skill", "update", "--scope", "project"] }),
			);
			expect(process.exitCode).toBe(1);
		} finally {
			process.exitCode = 0;
			await chmod(parent, 0o755);
		}
	});

	it("skips repair when autoUpdate is false", async () => {
		const source = await writeSource("demo");
		const installed = join(tempRoot, ".claude", "skills", "demo");
		const stale = join(tempRoot, "missing", "skills", "demo");
		await mkdir(dirname(installed), { recursive: true });
		await symlink(stale, installed);

		await withCwd(tempRoot, () => createApp(source, false).execute({ argv: [] }));
		expect(await readlink(installed)).toBe(stale);
	});

	it("leaves conflicts untouched during preRun repair", async () => {
		const source = await writeSource("demo");
		const installed = join(tempRoot, ".claude", "skills", "demo");
		await mkdir(installed, { recursive: true });
		await writeFile(join(installed, "manual.md"), "keep\n");

		await withCwd(tempRoot, () => createApp(source).execute({ argv: [] }));
		expect(await readFile(join(installed, "manual.md"), "utf8")).toBe("keep\n");
	});

	it("rejects an invalid --scope value", async () => {
		const source = await writeSource("demo");
		await withCwd(tempRoot, () =>
			createApp(source).execute({ argv: ["skill", "update", "--scope", "bogus"] }),
		);
		expect(process.exitCode).toBe(1);
		process.exitCode = 0;
	});

	it("does not break unrelated commands when the source contains an invalid skill directory", async () => {
		const source = await writeSource("demo");
		await mkdir(join(source, "__MACOSX"), { recursive: true });

		let ran = false;
		const app = new Crust("demo", { description: "Demo" })
			.extend(skill({ source, defaultScope: "project" }))
			.action(() => {
				ran = true;
			});
		await withCwd(tempRoot, () => app.execute({ argv: [] }));
		expect(ran).toBe(true);
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

	it("keeps a shared output when one selected agent still needs it", async () => {
		const source = await writeSource("demo");
		await withCwd(tempRoot, () =>
			installSkill({
				sourceDir: join(source, "demo"),
				agents: ["trae", "trae-cn"],
				scope: "project",
			}),
		);
		const multiselect = spyOn(prompts, "multiselect").mockResolvedValue(["trae-cn"]);
		try {
			await withCwd(tempRoot, () => createApp(source).execute({ argv: ["skill"] }));
		} finally {
			multiselect.mockRestore();
		}
		expect((await lstat(join(tempRoot, ".trae", "skills", "demo"))).isSymbolicLink()).toBe(true);
	});

	it("continues installs after a conflict in another agent directory", async () => {
		const source = await writeSource("demo");
		await withCwd(tempRoot, () =>
			installSkill({
				sourceDir: join(source, "demo"),
				agents: ["claude-code"],
				scope: "project",
			}),
		);
		await mkdir(target(), { recursive: true });
		await withCwd(tempRoot, () => createApp(source).execute({ argv: ["skill", "--all"] }));
		expect((await lstat(join(tempRoot, ".claude", "skills", "demo"))).isSymbolicLink()).toBe(true);
	});
});
