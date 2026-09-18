import { afterEach, beforeEach, describe, expect, it } from "bun:test";
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
import { renderHelp } from "@crustjs/extensions";
import { withPromptIO } from "@crustjs/prompts";
import { createPromptIO } from "@crustjs/prompts/testing";
import { captureExecute } from "@crustjs/testing";

import { skill } from "./extension.ts";
import { installSkill } from "./generate.ts";

let tempRoot: string;
let packageRoot: string;
let originalExitCode: typeof process.exitCode;
let originalArgv1: string | undefined;

beforeEach(async () => {
	originalExitCode = process.exitCode;
	process.exitCode = 0;
	tempRoot = await mkdtemp(join(tmpdir(), "crust-skill-plugin-"));
	// Running from source, the extension reads `<package root>/.crust/root/skills`,
	// where the package root is found by walking up from process.argv[1].
	packageRoot = join(tempRoot, "package");
	await mkdir(join(packageRoot, "src"), { recursive: true });
	await writeFile(join(packageRoot, "package.json"), '{"name":"demo"}');
	originalArgv1 = process.argv[1];
	process.argv[1] = join(packageRoot, "src", "cli.ts");
	await writeFile(process.argv[1], "");
});

afterEach(async () => {
	process.exitCode = originalExitCode ?? 0;
	if (originalArgv1 === undefined) process.argv.length = 1;
	else process.argv[1] = originalArgv1;
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

/** Writes a skill into the staged skills directory the resolver points at. */
async function writeSource(name: string, content = name, description = name): Promise<string> {
	const root = join(packageRoot, ".crust", "root", "skills");
	const dir = join(root, name);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n`);
	await writeFile(join(dir, "content.md"), `${content}\n`);
	return root;
}

function createApp(autoUpdate = true) {
	return new Crust("demo", { description: "Demo" })
		.extend(skill({ defaultScope: "project", autoUpdate }))
		.action(() => {});
}

function target(name = "demo") {
	return join(tempRoot, ".agents", "skills", name);
}

describe("skill extension packaged directory", () => {
	it("exposes the reserved identity on the factory", () => {
		expect(String(skill.id)).toBe("crust:skills");
		expect(skill({}).id).toBe(skill.id);
	});

	it("registers skills as the canonical command with skill as an alias", async () => {
		const snapshot = await createApp().snapshot();

		expect(snapshot.subCommands.skills?.meta.name).toBe("skills");
		expect(snapshot.subCommands.skills?.meta.aliases).toEqual(["skill"]);
		expect(snapshot.subCommands.skill).toBeUndefined();
		expect(renderHelp(snapshot)).toContain("Then run `demo skills`");
	});

	it.each(["agents", "skill"])(
		"preserves the custom command name %s without aliases",
		async (command) => {
			const snapshot = await new Crust("demo").extend(skill({ command })).snapshot();

			expect(Object.keys(snapshot.subCommands)).toEqual([command]);
			expect(snapshot.subCommands[command]?.meta.aliases ?? []).toEqual([]);
		},
	);

	it("advertises every packaged skill in help with its resolved source path", async () => {
		const source = await writeSource("demo", "demo", "Run demo workflows");
		await writeSource("guide", "guide", "Explain deployment choices");
		const snapshot = await createApp().snapshot();

		const output = renderHelp(snapshot);
		expect(output).toContain("Agent skills:");
		// Sources outside the cwd advertise their absolute path; ../ chains would
		// still spell out the absolute location while being harder to use.
		expect(output).toContain(`demo — Run demo workflows\n    Source: ${join(source, "demo")}`);
		expect(output).toContain(
			`guide — Explain deployment choices\n    Source: ${join(source, "guide")}`,
		);
	});

	it("keeps help usable when the packaged skills directory has not been built", async () => {
		const app = new Crust("demo", { description: "Demo" })
			.extend(skill({ command: "agents" }))
			.action(() => {});
		const output = renderHelp(await app.snapshot());

		expect(output).toContain("Agent skills:");
		expect(output).toContain(
			`Packaged skills not found at "${join(packageRoot, ".crust", "root", "skills")}".`,
		);
		expect(output).toContain("Run `crust build` first.");
		expect(output).toContain("Then run `demo agents`");
	});

	/** Build hook output, keyed by artifact path with text content. */
	async function buildArtifacts(
		extension: ReturnType<typeof skill>,
		snapshot: Awaited<ReturnType<Crust["snapshot"]>>,
	): Promise<Map<string, string>> {
		const artifacts = await extension.build!({ snapshot, outDir: join(tempRoot, "dist") });
		return new Map(artifacts.map((file) => [file.path, Buffer.from(file.content).toString()]));
	}

	it("omits the generated skill when generated is false", async () => {
		const authored = join(tempRoot, "authored", "guide");
		await mkdir(authored, { recursive: true });
		await writeFile(join(authored, "SKILL.md"), "---\nname: guide\ndescription: Guide\n---\n");
		const extension = skill({ generated: false, extras: [authored] });
		const snapshot = await new Crust("demo", { description: "Demo" }).extend(extension).snapshot();

		const artifacts = await buildArtifacts(extension, snapshot);

		expect([...artifacts.keys()]).toEqual([join("skills", "guide", "SKILL.md")]);
	});

	it("generates from the snapshot even when a stale packaged directory exists", async () => {
		await writeSource("demo", "stale");
		const extension = skill({});
		const snapshot = await new Crust("demo", { description: "Demo" }).extend(extension).snapshot();

		const artifacts = await buildArtifacts(extension, snapshot);

		expect(artifacts.has(join("skills", "demo", "content.md"))).toBe(false);
		expect(artifacts.get(join("skills", "demo", "SKILL.md"))).toContain("description: Demo");
	});

	it("generates command and authored skills together when extras are configured", async () => {
		await writeSource("stale", "stale");
		const authored = join(tempRoot, "authored", "guide");
		await mkdir(authored, { recursive: true });
		await writeFile(
			join(authored, "SKILL.md"),
			"---\nname: guide\ndescription: Deployment guide\n---\n",
		);
		await writeFile(join(authored, "content.md"), "authored\n");
		const extension = skill({ extras: [authored] });
		const snapshot = await new Crust("demo", {
			description: "Demo",
			version: "9.9.9",
			sections: [{ title: "Agent skills", body: "Application-authored agent guidance." }],
		})
			.extend(extension)
			.snapshot();

		const artifacts = await withCwd(tempRoot, () => buildArtifacts(extension, snapshot));

		expect(artifacts.get(join("skills", "demo", "SKILL.md"))).toContain('version: "9.9.9"');
		const rootReference = artifacts.get(join("skills", "demo", "commands", "demo.md"));
		expect(rootReference).toContain("# `demo`");
		expect(rootReference).toContain("## Agent skills\nApplication-authored agent guidance.");
		// The extension's Agent skills section advertises the packaged directory; it
		// must not leak build-machine paths into the regenerated command reference.
		expect(rootReference).not.toContain(tempRoot);
		expect(artifacts.get(join("skills", "guide", "content.md"))).toBe("authored\n");
		expect([...artifacts.keys()].some((path) => path.includes("stale"))).toBe(false);
	});

	it("forwards generated skill overrides to the build", async () => {
		await writeSource("stale", "stale");
		const authored = join(tempRoot, "authored", "gyst");
		await mkdir(authored, { recursive: true });
		await writeFile(
			join(authored, "SKILL.md"),
			"---\nname: gyst\ndescription: Authored co-review workflow\n---\n",
		);
		const extension = skill({
			extras: [authored],
			name: "gyst-reference",
			description: "Generated command reference",
		});
		const snapshot = await new Crust("gyst", { description: "Gyst" }).extend(extension).snapshot();

		const artifacts = await buildArtifacts(extension, snapshot);

		expect(artifacts.has(join("skills", "gyst", "SKILL.md"))).toBe(true);
		expect(artifacts.get(join("skills", "gyst-reference", "SKILL.md"))).toContain(
			"description: Generated command reference",
		);
	});

	it("renders from the snapshot without requiring a package version", async () => {
		const extension = skill({});
		const snapshot = await new Crust("demo", { description: "Demo" }).extend(extension).snapshot();
		await writeFile(join(tempRoot, "package.json"), '{"version":"8.8.8"}');

		const artifacts = await withCwd(tempRoot, () => buildArtifacts(extension, snapshot));

		const generated = artifacts.get(join("skills", "demo", "SKILL.md"));
		expect(generated).toContain("name: demo");
		expect(generated).not.toContain("version:");
		expect(generated).not.toContain(tempRoot);
		// The snapshot was prepared while the packaged directory was missing; the
		// skill must not embed that stale warning in its command reference.
		expect(artifacts.get(join("skills", "demo", "commands", "demo.md"))).not.toContain(
			"unavailable",
		);
	});

	it.each(["skills", "skill"])("installs every packaged skill via %s", async (command) => {
		await writeSource("demo");
		await writeSource("guide");
		await withCwd(tempRoot, () => createApp().execute({ argv: [command, "--all"] }));

		expect((await lstat(target("demo"))).isSymbolicLink()).toBe(true);
		expect((await lstat(target("guide"))).isSymbolicLink()).toBe(true);
		expect(await readFile(join(target("demo"), "content.md"), "utf8")).toBe("demo\n");
	});

	it("normalizes home-directory scopes before repair and install grouping", async () => {
		await writeSource("demo");
		for (const conflict of [
			join(tempRoot, ".agents", "skills", "demo"),
			join(tempRoot, ".trae", "skills", "demo"),
		]) {
			await mkdir(conflict, { recursive: true });
			await writeFile(join(conflict, "manual.md"), "keep\n");
		}
		const binDir = join(tempRoot, "bin");
		const traeBin = join(binDir, "trae");
		await mkdir(binDir);
		await writeFile(traeBin, "#!/bin/sh\nexit 0\n");
		await chmod(traeBin, 0o755);

		// Inside the fake package so the subprocess resolves the same staged skills.
		const script = join(packageRoot, "home-scope.ts");
		await writeFile(
			script,
			`import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { Crust } from ${JSON.stringify(import.meta.resolve("@crustjs/core"))};
import { skill } from ${JSON.stringify(new URL("./extension.ts", import.meta.url).href)};

const repairErrors: string[] = [];
await new Crust("demo")
  .extend(skill({}))
  .action(() => {})
  .execute({ argv: [], io: { stderr: (text) => repairErrors.push(text) } });

await new Crust("demo")
  .extend(skill({ autoUpdate: false }))
  .action(() => {})
  .execute({
    argv: ["skill", "--all", "--scope", "project"],
    io: { stderr: () => {} },
  });

let traeCnInstalled = false;
try {
  traeCnInstalled = (await lstat(join(process.cwd(), ".trae-cn", "skills", "demo"))).isSymbolicLink();
} catch {}
console.log("RESULT " + JSON.stringify({ repairErrors, traeCnInstalled }));
`,
		);
		const proc = Bun.spawn([process.execPath, script], {
			cwd: tempRoot,
			env: {
				...process.env,
				HOME: tempRoot,
				PATH: binDir,
				XDG_CONFIG_HOME: join(tempRoot, ".config"),
				CLAUDE_CONFIG_DIR: join(tempRoot, ".claude"),
				VIBE_HOME: join(tempRoot, ".vibe"),
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		expect(exitCode, stderr).toBe(0);
		const resultLine = stdout.match(/^RESULT (.+)$/m)?.[1];
		expect(resultLine, stdout).toBeDefined();
		const result = JSON.parse(resultLine!) as {
			repairErrors: string[];
			traeCnInstalled: boolean;
		};
		expect(result.repairErrors).toHaveLength(2);
		expect(new Set(result.repairErrors).size).toBe(2);
		expect(result.traeCnInstalled).toBe(true);
	});

	it("does not let --all overwrite an unowned agent directory", async () => {
		await writeSource("demo");
		await mkdir(target(), { recursive: true });
		await writeFile(join(target(), "manual.md"), "keep\n");

		await withCwd(tempRoot, () => createApp().execute({ argv: ["skill", "--all"] }));
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

		await withCwd(tempRoot, () => createApp().execute({ argv: [] }));
		expect(resolve(dirname(installed), await readlink(installed))).toBe(join(source, "demo"));
		expect(await readFile(join(installed, "content.md"), "utf8")).toBe("current\n");
	});

	it("never creates links that were not installed", async () => {
		await writeSource("demo");
		await withCwd(tempRoot, () => createApp().execute({ argv: [] }));
		await expect(lstat(target())).rejects.toThrow();
	});

	it.each(["skills", "skill"])("repairs links via %s update", async (command) => {
		const source = await writeSource("demo");
		const installed = join(tempRoot, ".claude", "skills", "demo");
		await mkdir(dirname(installed), { recursive: true });
		await symlink(join(tempRoot, "missing", "skills", "demo"), installed);

		await withCwd(tempRoot, () =>
			createApp().execute({ argv: [command, "update", "--scope", "project"] }),
		);
		expect(resolve(dirname(installed), await readlink(installed))).toBe(join(source, "demo"));
	});

	it("skips repair when autoUpdate is false", async () => {
		await writeSource("demo");
		const installed = join(tempRoot, ".claude", "skills", "demo");
		const stale = join(tempRoot, "missing", "skills", "demo");
		await mkdir(dirname(installed), { recursive: true });
		await symlink(stale, installed);

		await withCwd(tempRoot, () => createApp(false).execute({ argv: [] }));
		expect(await readlink(installed)).toBe(stale);
	});

	it("reports preRun conflicts through injected stderr", async () => {
		await writeSource("demo");
		const installed = target();
		await mkdir(installed, { recursive: true });
		await writeFile(join(installed, "manual.md"), "keep\n");
		const originalWarn = console.warn;
		const ambientWarnings: unknown[] = [];
		console.warn = (...args) => ambientWarnings.push(...args);
		try {
			const captured = await withCwd(tempRoot, () => captureExecute(createApp(), []));
			expect(captured.exitCode).toBe(0);
			expect(captured.stderr).toContain("Skill conflict [demo]");
			expect(ambientWarnings).toEqual([]);
		} finally {
			console.warn = originalWarn;
		}
		expect(await readFile(join(installed, "manual.md"), "utf8")).toBe("keep\n");
	});

	it("quietly skips preRun repair for an empty packaged source", async () => {
		await mkdir(join(packageRoot, ".crust", "root", "skills"), { recursive: true });

		const captured = await withCwd(tempRoot, () => captureExecute(createApp(), []));

		expect(captured).toEqual({ stdout: "", stderr: "", exitCode: 0 });
	});

	it("rejects an invalid --scope value during parsing", async () => {
		await writeSource("demo");
		const captured = await withCwd(tempRoot, () =>
			captureExecute(createApp(), ["skill", "update", "--scope", "bogus"]),
		);

		expect(captured.exitCode).toBe(1);
		expect(captured.stderr).toContain("Expected one of");
		expect(captured.stderr).toContain("project");
		expect(captured.stderr).toContain("global");
	});

	it("still advertises and runs valid skills when the source contains a cruft directory", async () => {
		const source = await writeSource("demo", "demo", "Run demo workflows");
		await mkdir(join(source, "__MACOSX"), { recursive: true });

		let ran = false;
		const app = new Crust("demo", { description: "Demo" })
			.extend(skill({ defaultScope: "project" }))
			.action(() => {
				ran = true;
			});
		await withCwd(tempRoot, () => app.execute({ argv: [] }));
		expect(ran).toBe(true);

		const output = renderHelp(await app.snapshot());
		expect(output).toContain("demo — Run demo workflows");
	});

	it("reports unreadable packaged skills without claiming the directory is unavailable", async () => {
		const source = await writeSource("demo");
		await writeFile(join(source, "demo", "SKILL.md"), "---\nname: demo\n---\n");

		const output = renderHelp(await createApp().snapshot());
		expect(output).toContain("Agent skills:");
		expect(output).toContain("Packaged skills could not be read.");
		expect(output).not.toContain("Packaged skills not found");
	});

	it("does not break unrelated commands when the packaged directory is unavailable", async () => {
		let ran = false;
		const app = new Crust("demo").extend(skill({})).action(() => {
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
				withPromptIO(harness.io, () => createApp().execute({ argv: ["skill"] })),
			);
			harness.keys("down", "space", "enter");
			await run;
		} finally {
			process.env.PATH = path;
		}

		expect((await lstat(target())).isSymbolicLink()).toBe(true);
	});

	it("overwrites an unowned directory when the conflict confirm is accepted", async () => {
		await writeSource("demo");
		await mkdir(target(), { recursive: true });
		await writeFile(join(target(), "manual.md"), "unowned\n");

		// Empty PATH keeps agent detection deterministic: Universal is the only
		// choice, so the queued keys select it and then accept the overwrite.
		const path = process.env.PATH;
		process.env.PATH = "";
		try {
			const harness = createPromptIO();
			const run = withCwd(tempRoot, () =>
				withPromptIO(harness.io, () => createApp().execute({ argv: ["skill"] })),
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
		const claude = join(tempRoot, ".claude", "skills", "demo");
		await mkdir(dirname(claude), { recursive: true });
		// Owned but dangling: reconciliation must repair this after the Universal conflict.
		await symlink(join(tempRoot, "missing", "skills", "demo"), claude);
		await mkdir(target(), { recursive: true });
		const captured = await withCwd(tempRoot, () => captureExecute(createApp(), ["skill", "--all"]));
		expect(captured.stderr).toContain("Skipped Universal [demo]");
		expect(resolve(dirname(claude), await readlink(claude))).toBe(join(source, "demo"));
	});
});
