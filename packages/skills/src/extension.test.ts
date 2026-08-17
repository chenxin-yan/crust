import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
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
import { renderHelp } from "@crustjs/extensions";
import { withPromptIO } from "@crustjs/prompts";
import { createPromptIO } from "@crustjs/prompts/testing";

import { skill } from "./extension.ts";
import { installSkill } from "./generate.ts";

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

async function writeSource(name: string, content = name, description = name): Promise<string> {
	const root = join(tempRoot, "package", "skills");
	const dir = join(root, name);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n`);
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
	it("advertises every packaged skill in help with its resolved source path", async () => {
		const source = await writeSource("demo", "demo", "Run demo workflows");
		await writeSource("guide", "guide", "Explain deployment choices");
		const snapshot = await createApp(source).snapshot();

		const output = renderHelp(snapshot);
		expect(output).toContain("Agent skills:");
		// Sources outside the cwd advertise their absolute path; ../ chains would
		// still spell out the absolute location while being harder to use.
		expect(output).toContain(`demo — Run demo workflows\n    Source: ${join(source, "demo")}`);
		expect(output).toContain(
			`guide — Explain deployment choices\n    Source: ${join(source, "guide")}`,
		);
	});

	it("keeps help usable when the packaged skill source cannot be resolved", async () => {
		const source = join(tempRoot, "missing-skills");
		const app = new Crust("demo", { description: "Demo" })
			.extend(skill({ source, command: "agents" }))
			.action(() => {});
		const output = renderHelp(await app.snapshot());

		expect(output).toContain("Agent skills:");
		expect(output).toContain("The skill source path is unavailable.");
		expect(output).toContain("Run `demo agents`");
		expect(output).not.toContain(source);
	});

	it("copies packaged sources from its build hook", async () => {
		const source = await writeSource("demo", "packaged");
		const extension = skill({ source });
		const snapshot = await new Crust("demo", { description: "Demo" }).extend(extension).snapshot();
		const outDir = join(tempRoot, "dist");

		await extension.build?.({ snapshot, outDir });

		expect(await readFile(join(outDir, "skills", "demo", "content.md"), "utf8")).toBe("packaged\n");
	});

	it("renders from the snapshot without requiring a package version", async () => {
		const source = join(tempRoot, "missing-skills");
		const extension = skill({ source });
		const snapshot = await new Crust("demo", { description: "Demo" }).extend(extension).snapshot();
		const outDir = join(tempRoot, "dist");
		await writeFile(join(tempRoot, "package.json"), "{}");

		await withCwd(tempRoot, async () => {
			await extension.build!({ snapshot, outDir });
		});

		const generated = await readFile(join(outDir, "skills", "demo", "SKILL.md"), "utf8");
		expect(generated).toContain("name: demo");
		expect(generated).not.toContain("version:");
		expect(generated).not.toContain(tempRoot);
		// The snapshot was prepared while the source was missing; the emitted
		// skill must not embed that stale warning in its command reference.
		const rootReference = await readFile(
			join(outDir, "skills", "demo", "commands", "demo.md"),
			"utf8",
		);
		expect(rootReference).not.toContain("unavailable");
	});

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

	it("repairs an owned stale-target link before ordinary commands", async () => {
		const source = await writeSource("demo", "current");
		const stale = join(tempRoot, "old", "skills", "demo");
		await mkdir(stale, { recursive: true });
		await writeFile(join(stale, "content.md"), "stale\n");
		const installed = join(tempRoot, ".claude", "skills", "demo");
		await mkdir(dirname(installed), { recursive: true });
		await symlink(stale, installed);

		await withCwd(tempRoot, () => createApp(source).execute({ argv: [] }));
		expect(resolve(dirname(installed), await readlink(installed))).toBe(join(source, "demo"));
		expect(await readFile(join(installed, "content.md"), "utf8")).toBe("current\n");
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

	it("still advertises and runs valid skills when the source contains a cruft directory", async () => {
		const source = await writeSource("demo", "demo", "Run demo workflows");
		await mkdir(join(source, "__MACOSX"), { recursive: true });

		let ran = false;
		const app = new Crust("demo", { description: "Demo" })
			.extend(skill({ source, defaultScope: "project" }))
			.action(() => {
				ran = true;
			});
		await withCwd(tempRoot, () => app.execute({ argv: [] }));
		expect(ran).toBe(true);

		const output = renderHelp(await app.snapshot());
		expect(output).toContain("demo — Run demo workflows");
	});

	it("reports unreadable packaged skills without claiming the source path is unavailable", async () => {
		const source = await writeSource("demo");
		await writeFile(join(source, "demo", "SKILL.md"), "---\nname: demo\n---\n");

		const output = renderHelp(await createApp(source).snapshot());
		expect(output).toContain("Agent skills:");
		expect(output).toContain("Packaged skills could not be read.");
		expect(output).not.toContain("The skill source path is unavailable.");
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

	it("keeps a shared output directory when deselecting one of its agents", async () => {
		const source = await writeSource("demo");
		// Antigravity shares `.agents/skills` with the universal group at project
		// scope; the pre-existing link marks both choices installed.
		await withCwd(tempRoot, () =>
			installSkill({ sourceDir: join(source, "demo"), agents: ["amp"], scope: "project" }),
		);

		// Empty PATH keeps agent detection deterministic: Antigravity is the only
		// additional choice (installed), listed right after Universal.
		const path = process.env.PATH;
		process.env.PATH = "";
		try {
			const harness = createPromptIO();
			const run = withCwd(tempRoot, () =>
				withPromptIO(harness.io, () => createApp(source).execute({ argv: ["skill"] })),
			);
			harness.keys("down", "space", "enter");
			await run;
		} finally {
			process.env.PATH = path;
		}

		expect((await lstat(target())).isSymbolicLink()).toBe(true);
	});

	it("overwrites an unowned directory when the conflict confirm is accepted", async () => {
		const source = await writeSource("demo");
		await mkdir(target(), { recursive: true });
		await writeFile(join(target(), "manual.md"), "unowned\n");

		// Empty PATH keeps agent detection deterministic: Universal is the only
		// choice, so the queued keys select it and then accept the overwrite.
		const path = process.env.PATH;
		process.env.PATH = "";
		try {
			const harness = createPromptIO();
			const run = withCwd(tempRoot, () =>
				withPromptIO(harness.io, () => createApp(source).execute({ argv: ["skill"] })),
			);
			harness.keys("space", "enter");
			// The multiselect drains buffered input, so the confirm answer must
			// wait until the confirm prompt is attached and rendering.
			while (!harness.screen().includes("Overwrite?")) {
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
			harness.keys("y", "enter");
			await run;
		} finally {
			process.env.PATH = path;
		}

		expect((await lstat(target())).isSymbolicLink()).toBe(true);
		expect(await readFile(join(target(), "content.md"), "utf8")).toBe("demo\n");
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
