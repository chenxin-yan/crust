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

import { type AnyCrust, Crust } from "@crustjs/core";
import { renderHelp } from "@crustjs/extensions";
import { withTerminalIO } from "@crustjs/prompts";
import { createPromptIO } from "@crustjs/prompts/testing";
import { captureExecute } from "@crustjs/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { reapBoundedProcesses, runBoundedProcess } from "../../crust/tests/bounded-process.ts";
import { runBuildHooks } from "../../crust/tests/build-hooks.ts";
import { withCwd } from "../tests/fixtures.ts";
import { skill } from "./extension.ts";
import { installSkill } from "./install.ts";

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
	// Agents are detected by folders in the home directory; an empty one keeps detection deterministic.
	const home = join(tempRoot, "home");
	await mkdir(home);
	vi.stubEnv("HOME", home);
	vi.stubEnv("USERPROFILE", home);
});

afterEach(async () => {
	vi.unstubAllEnvs();
	await reapBoundedProcesses();
	process.exitCode = originalExitCode ?? 0;
	if (originalArgv1 === undefined) process.argv.length = 1;
	else process.argv[1] = originalArgv1;
	await rm(tempRoot, { recursive: true, force: true });
});

/** Writes a skill into the staged skills directory the resolver points at. */
async function writeSource(name: string, content = name, description = name): Promise<string> {
	const root = join(packageRoot, ".crust", "root", "skills");
	const dir = join(root, name);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n`);
	await writeFile(join(dir, "content.md"), `${content}\n`);
	return root;
}

/**
 * Runs as an installed CLI: a Node single executable application beside the staged skills
 * directory `writeSource` fills, since only an installed CLI repairs links before commands.
 */
async function asInstalled<T>(run: () => Promise<T>): Promise<T> {
	const execPath = Object.getOwnPropertyDescriptor(process, "execPath")!;
	const getBuiltinModule = process.getBuiltinModule;
	Object.defineProperty(process, "execPath", {
		...execPath,
		value: join(packageRoot, ".crust", "root", "demo"),
	});
	process.getBuiltinModule = (id: string) =>
		id === "node:sea" ? { isSea: () => true } : getBuiltinModule(id);
	try {
		return await run();
	} finally {
		process.getBuiltinModule = getBuiltinModule;
		Object.defineProperty(process, "execPath", execPath);
	}
}

function createApp(autoUpdate = true) {
	return new Crust("demo", { description: "Demo" })
		.extend(skill({ defaultScope: "project", autoUpdate }))
		.action(() => {});
}

function target(name = "demo") {
	return join(tempRoot, ".agents", "skills", name);
}

/** Absolute directory the symlink at `path` points to. */
async function linkTarget(path: string): Promise<string> {
	return resolve(dirname(path), await readlink(path));
}

const stderrIsTTY = Object.getOwnPropertyDescriptor(process.stderr, "isTTY");

/** Runs with an interactive, non-CI stderr, where the other-copy link notice shows; the runner may be neither. */
async function onTerminal<T>(run: () => Promise<T>): Promise<T> {
	vi.stubEnv("CI", undefined);
	vi.stubEnv("NO_UPDATE_NOTIFIER", undefined);
	Object.defineProperty(process.stderr, "isTTY", { configurable: true, value: true });
	try {
		return await run();
	} finally {
		if (stderrIsTTY) Object.defineProperty(process.stderr, "isTTY", stderrIsTTY);
		else Reflect.deleteProperty(process.stderr, "isTTY");
	}
}

/** Runs `demo <argv>` on a fake terminal from `tempRoot`. */
function executeWithPrompts(argv: string[]) {
	const harness = createPromptIO();
	const run = withCwd(tempRoot, () =>
		withTerminalIO(harness.io, () => createApp().execute({ argv })),
	);
	return { harness, run };
}

describe("skill extension packaged directory", () => {
	it("registers skills as the canonical command with skill as an alias", async () => {
		const snapshot = await createApp().snapshot();

		expect(snapshot.subCommands.skills?.meta.name).toBe("skills");
		expect(snapshot.subCommands.skills?.meta.aliases).toEqual(["skill"]);
		expect(snapshot.subCommands.skill).toBeUndefined();
		expect(await renderHelp(snapshot)).toContain("Then run `demo skills`");
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

		const output = await renderHelp(snapshot);
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
		const output = await renderHelp(await app.snapshot());

		expect(output).toContain("Agent skills:");
		expect(output).toContain(
			`Packaged skills not found at "${join(packageRoot, ".crust", "root", "skills")}".`,
		);
		expect(output).toContain("Run `crust build` first.");
		expect(output).toContain("Then run `demo agents`");
	});

	/** Build hook output, keyed by artifact path with text content. */
	async function buildArtifacts(app: AnyCrust): Promise<Map<string, string>> {
		const { files, error } = await runBuildHooks(app);
		if (error !== undefined) throw new Error(error);
		return files;
	}

	it("omits the generated skill when generated is false", async () => {
		const authored = join(tempRoot, "authored", "guide");
		await mkdir(authored, { recursive: true });
		await writeFile(join(authored, "SKILL.md"), "---\nname: guide\ndescription: Guide\n---\n");
		const extension = skill({ generated: false, extras: [authored] });
		const app = new Crust("demo", { description: "Demo" }).extend(extension);

		const artifacts = await buildArtifacts(app);

		expect([...artifacts.keys()]).toEqual([join("skills", "guide", "SKILL.md")]);
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
		const app = new Crust("demo", {
			description: "Demo",
			version: "9.9.9",
			sections: [{ title: "Agent skills", body: "Application-authored agent guidance." }],
		}).extend(extension);

		const artifacts = await withCwd(tempRoot, () => buildArtifacts(app));

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
		const app = new Crust("gyst", { description: "Gyst" }).extend(extension);

		const artifacts = await buildArtifacts(app);

		expect(artifacts.has(join("skills", "gyst", "SKILL.md"))).toBe(true);
		expect(artifacts.get(join("skills", "gyst-reference", "SKILL.md"))).toContain(
			"description: Generated command reference",
		);
	});

	it.each(["skills", "skills install"])("installs every packaged skill via %s", async (command) => {
		await writeSource("demo");
		await writeSource("guide");
		await withCwd(tempRoot, () => createApp().execute({ argv: [...command.split(" "), "--all"] }));

		expect((await lstat(target("demo"))).isSymbolicLink()).toBe(true);
		expect((await lstat(target("guide"))).isSymbolicLink()).toBe(true);
		expect(await readFile(join(target("demo"), "content.md"), "utf8")).toBe("demo\n");
	});

	/** Blocks until the named prompt is on screen; earlier prompts drain buffered keys. */
	async function waitForPrompt(harness: ReturnType<typeof createPromptIO>, message: string) {
		while (!harness.screen().includes(message)) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	}

	it("prompts once for skills and once for agents, leaving unselected skills untouched", async () => {
		await writeSource("demo");
		await writeSource("guide");

		// Universal is the only agent choice.
		const { harness, run } = executeWithPrompts(["skill"]);
		await waitForPrompt(harness, "Select skills to install");
		// Nothing is installed, so both skills start selected; drop "guide".
		harness.keys("down", "space", "enter");
		await waitForPrompt(harness, "Select agents to install for");
		harness.keys("space", "enter");
		await run;
		expect(harness.screen().split("Select agents to install for")).toHaveLength(2);

		expect((await lstat(target("demo"))).isSymbolicLink()).toBe(true);
		await expect(lstat(target("guide"))).rejects.toThrow();
	});

	it("installs a newly selected skill without touching an installed, unselected one", async () => {
		const source = await writeSource("demo");
		await writeSource("guide");
		await withCwd(tempRoot, () =>
			installSkill({ sourceDir: join(source, "guide"), agents: ["amp"], scope: "project" }),
		);

		// The `.agents/skills` link preselects Universal and the additional agents sharing it at project scope.
		const { harness, run } = executeWithPrompts(["skill"]);
		await waitForPrompt(harness, "Select skills to install");
		// Only the installed "guide" starts selected; swap it for "demo".
		harness.keys("space", "down", "space", "enter");
		await waitForPrompt(harness, "Select agents to install for");
		harness.keys("space", "enter");
		await run;
		expect(harness.screen().split("Select agents to install for")).toHaveLength(2);

		expect(await linkTarget(target("demo"))).toBe(join(source, "demo"));
		expect(await linkTarget(target("guide"))).toBe(join(source, "guide"));
	});

	it("skills install installs newly selected agents without removing a deselected agent's link", async () => {
		const source = await writeSource("demo");
		const cortexTarget = join(tempRoot, ".cortex", "skills", "demo");
		await withCwd(tempRoot, () =>
			installSkill({ sourceDir: join(source, "demo"), agents: ["cortex"], scope: "project" }),
		);

		// Universal plus the already-installed Cortex Code are the only agent choices.
		const { harness, run } = executeWithPrompts(["skills", "install"]);
		await waitForPrompt(harness, "Select agents to install for");
		// Only the installed Cortex Code starts selected; swap it for Universal.
		harness.keys("space", "down", "space", "enter");
		await run;

		expect(await linkTarget(target("demo"))).toBe(join(source, "demo"));
		expect(await linkTarget(cortexTarget)).toBe(join(source, "demo"));
	});

	it("uninstalls selected skills and leaves the rest linked", async () => {
		const source = await writeSource("demo");
		await writeSource("guide");
		await withCwd(tempRoot, () => createApp().execute({ argv: ["skill", "--all"] }));

		const harness = createPromptIO();
		const run = withCwd(tempRoot, () =>
			withTerminalIO(harness.io, () => captureExecute(createApp(), ["skill", "uninstall"])),
		);
		await waitForPrompt(harness, "Select skills to uninstall");
		// Nothing is preselected; pick "demo" (first choice) so only it is removed.
		harness.keys("space", "enter");
		const captured = await run;

		expect(captured.stdout).toContain('Removed "demo"');
		// Antigravity shares `.agents/skills` with Universal at project scope; one line per directory.
		const sharedLine = captured.stdout
			.split("\n")
			.find((line) => line.endsWith(` → ${target("demo")}`));
		expect(sharedLine).toMatch(/^ {2}Universal, .*Antigravity/);
		const reportedDirs = captured.stdout
			.split("\n")
			.flatMap((line) => (line.includes(" → ") ? [line.split(" → ")[1]] : []));
		expect(new Set(reportedDirs).size).toBe(reportedDirs.length);
		await expect(lstat(target("demo"))).rejects.toThrow();
		expect(await linkTarget(target("guide"))).toBe(join(source, "guide"));
	});

	it("reports when nothing is installed to uninstall", async () => {
		await writeSource("demo");
		const captured = await withCwd(tempRoot, () =>
			captureExecute(createApp(), ["skill", "uninstall", "--all"]),
		);
		expect(captured.stdout).toContain("No installed skills (project).");
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
		// Trae and Trae CN are detected by `~/.trae` and `~/.trae-cn`; `~/.trae` holds the conflict.
		await mkdir(join(tempRoot, ".trae-cn"));

		// Inside the fake package so the subprocess resolves the same staged skills.
		const script = join(packageRoot, "home-scope.ts");
		await writeFile(
			script,
			`import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { Crust } from ${JSON.stringify(import.meta.resolve("@crustjs/core"))};
import { skill } from ${JSON.stringify(new URL("./extension.ts", import.meta.url).href)};

// An installed CLI: a Node single executable application beside the staged skills.
const getBuiltinModule = process.getBuiltinModule;
process.getBuiltinModule = (id: string) =>
  id === "node:sea" ? { isSea: () => true } : getBuiltinModule(id);
Object.defineProperty(process, "execPath", {
  value: ${JSON.stringify(join(packageRoot, ".crust", "root", "demo"))},
});

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
		const { stdout, stderr, exitCode } = await runBoundedProcess(process.execPath, [script], {
			cwd: tempRoot,
			env: {
				...process.env,
				HOME: tempRoot,
				CLAUDE_CONFIG_DIR: join(tempRoot, ".claude"),
			},
			timeout: 4_000,
		});
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

	it("repairs an owned broken link before ordinary commands", async () => {
		const source = await writeSource("demo", "current");
		const installed = join(tempRoot, ".claude", "skills", "demo");
		await mkdir(dirname(installed), { recursive: true });
		await symlink(join(tempRoot, "missing", "skills", "demo"), installed);
		const run = () =>
			onTerminal(() => asInstalled(() => withCwd(tempRoot, () => captureExecute(createApp(), []))));

		expect((await run()).stderr).toBe("");
		expect(await linkTarget(installed)).toBe(join(source, "demo"));
		expect(await readFile(join(installed, "content.md"), "utf8")).toBe("current\n");
		// The repaired link is healthy, so the next run stays quiet as well.
		expect((await run()).stderr).toBe("");
	});

	// Two installed copies (global + project-local, npx) would otherwise take the link from each other on every run.
	it("leaves an owned link to another live copy alone before ordinary commands", async () => {
		await writeSource("demo", "current");
		const other = join(tempRoot, "other", "skills", "demo");
		await mkdir(other, { recursive: true });
		await writeFile(join(other, "content.md"), "other\n");
		const installed = join(tempRoot, ".claude", "skills", "demo");
		await mkdir(dirname(installed), { recursive: true });
		await symlink(other, installed);

		const captured = await onTerminal(() =>
			asInstalled(() => withCwd(tempRoot, () => captureExecute(createApp(), []))),
		);
		expect(captured.exitCode).toBe(0);
		expect(captured.stderr).toBe(
			`Skill link [demo]: "${installed}" points at another installed copy of this CLI. Run "demo skills repair --scope project" to link this copy.`,
		);
		expect(await readlink(installed)).toBe(other);
	});

	// The layout `npx skills` writes: the agent's link reaches this copy through `.agents/skills`.
	it("treats a link that reaches this copy through another link as linked", async () => {
		const source = await writeSource("demo", "current");
		const shared = join(tempRoot, ".agents", "skills", "demo");
		await mkdir(dirname(shared), { recursive: true });
		await symlink(join(source, "demo"), shared);
		const installed = join(tempRoot, ".claude", "skills", "demo");
		await mkdir(dirname(installed), { recursive: true });
		await symlink(join("..", "..", ".agents", "skills", "demo"), installed);

		const captured = await onTerminal(() =>
			asInstalled(() => withCwd(tempRoot, () => captureExecute(createApp(), []))),
		);
		expect(captured.stderr).toBe("");
		const repaired = await withCwd(tempRoot, () =>
			captureExecute(createApp(), ["skills", "repair", "--scope", "project"]),
		);
		expect(repaired.stdout).toContain("No repairs needed [demo] (project).");
		expect(await readlink(installed)).toBe(join("..", "..", ".agents", "skills", "demo"));
	});

	it("notices a link to another live copy once when both scopes resolve to it", async () => {
		vi.stubEnv("CLAUDE_CONFIG_DIR", join(tempRoot, ".claude"));
		await writeSource("demo");
		const other = join(tempRoot, "other", "skills", "demo");
		await mkdir(other, { recursive: true });
		const installed = join(tempRoot, ".claude", "skills", "demo");
		await mkdir(dirname(installed), { recursive: true });
		await symlink(other, installed);

		// Without a defaultScope, ordinary commands check both scopes.
		const app = new Crust("demo", { description: "Demo" }).extend(skill({})).action(() => {});

		const captured = await onTerminal(() =>
			asInstalled(() => withCwd(tempRoot, () => captureExecute(app, []))),
		);
		expect(captured.stderr).toBe(
			`Skill link [demo]: "${installed}" points at another installed copy of this CLI. Run "demo skills repair --scope project" to link this copy.`,
		);
	});

	it.each([
		["under CI", () => vi.stubEnv("CI", "true")],
		["when NO_UPDATE_NOTIFIER is set", () => vi.stubEnv("NO_UPDATE_NOTIFIER", "1")],
		[
			"when stderr is not a terminal",
			() => Object.defineProperty(process.stderr, "isTTY", { configurable: true, value: false }),
		],
	])("does not notice a link to another live copy %s", async (_case, suppress) => {
		await writeSource("demo");
		const other = join(tempRoot, "other", "skills", "demo");
		await mkdir(other, { recursive: true });
		const installed = join(tempRoot, ".claude", "skills", "demo");
		await mkdir(dirname(installed), { recursive: true });
		await symlink(other, installed);

		const captured = await onTerminal(() => {
			suppress();
			return asInstalled(() => withCwd(tempRoot, () => captureExecute(createApp(), [])));
		});
		expect(captured.stderr).toBe("");
		expect(await readlink(installed)).toBe(other);
	});

	it("re-points an owned link to another live copy via skills repair", async () => {
		const source = await writeSource("demo", "current");
		const other = join(tempRoot, "other", "skills", "demo");
		await mkdir(other, { recursive: true });
		const installed = join(tempRoot, ".claude", "skills", "demo");
		await mkdir(dirname(installed), { recursive: true });
		await symlink(other, installed);

		await withCwd(tempRoot, () =>
			createApp().execute({ argv: ["skills", "repair", "--scope", "project"] }),
		);
		expect(await linkTarget(installed)).toBe(join(source, "demo"));
	});

	it("leaves an installed CLI's links alone when running from source", async () => {
		await writeSource("demo", "checkout");
		const release = join(tempRoot, "release", "skills", "demo");
		await mkdir(release, { recursive: true });
		await writeFile(join(release, "content.md"), "release\n");
		const installed = join(tempRoot, ".claude", "skills", "demo");
		await mkdir(dirname(installed), { recursive: true });
		await symlink(release, installed);

		await withCwd(tempRoot, () => createApp().execute({ argv: [] }));
		expect(await readlink(installed)).toBe(release);
	});

	it("skips repair when autoUpdate is false", async () => {
		await writeSource("demo");
		const installed = join(tempRoot, ".claude", "skills", "demo");
		const stale = join(tempRoot, "missing", "skills", "demo");
		await mkdir(dirname(installed), { recursive: true });
		await symlink(stale, installed);

		await asInstalled(() => withCwd(tempRoot, () => createApp(false).execute({ argv: [] })));
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
			const captured = await asInstalled(() =>
				withCwd(tempRoot, () => captureExecute(createApp(), [])),
			);
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

		const captured = await asInstalled(() =>
			withCwd(tempRoot, () => captureExecute(createApp(), [])),
		);

		expect(captured).toEqual({ stdout: "", stderr: "", exitCode: 0 });
	});

	it("reports unreadable packaged skills without claiming the directory is unavailable", async () => {
		const source = await writeSource("demo");
		await writeFile(join(source, "demo", "SKILL.md"), "---\nname: demo\n---\n");

		const output = await renderHelp(await createApp().snapshot());
		expect(output).toContain("Agent skills:");
		expect(output).toContain("Packaged skills could not be read.");
		expect(output).not.toContain("Packaged skills not found");
	});

	it("keeps a shared output directory when deselecting one of its agents", async () => {
		const source = await writeSource("demo");
		// Amp, Antigravity, and other additional agents share `.agents/skills` with the
		// universal group at project scope; the pre-existing link marks them all installed.
		await withCwd(tempRoot, () =>
			installSkill({ sourceDir: join(source, "demo"), agents: ["amp"], scope: "project" }),
		);

		// Amp is the first additional choice (installed), listed right after Universal.
		const { harness, run } = executeWithPrompts(["skill"]);
		harness.keys("down", "space", "enter");
		await run;

		expect((await lstat(target())).isSymbolicLink()).toBe(true);
	});

	it("overwrites an unowned directory when the conflict confirm is accepted", async () => {
		await writeSource("demo");
		await mkdir(target(), { recursive: true });
		await writeFile(join(target(), "manual.md"), "unowned\n");

		// Universal is the only choice, so the queued keys select it and then accept the overwrite.
		const { harness, run } = executeWithPrompts(["skill"]);
		harness.keys("space", "enter");
		// The multiselect drains buffered input, so the confirm answer must
		// wait until the confirm prompt is attached and rendering. The message
		// holds a temp path, so join the rows the fake terminal wrapped it onto.
		while (!harness.screen().replaceAll("\n", "").includes("Overwrite?")) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		harness.keys("y", "enter");
		await run;

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
		expect(await linkTarget(claude)).toBe(join(source, "demo"));
	});

	/** Runs `demo <argv>` from `tempRoot` without a terminal, so any prompt fails the run. */
	function executeWithoutPrompts(argv: string[]) {
		return withCwd(tempRoot, () => captureExecute(createApp(), argv));
	}

	it("installs the --skill and --agent selection without prompting", async () => {
		const source = await writeSource("demo");
		await writeSource("guide");
		const claude = join(tempRoot, ".claude", "skills");

		const captured = await executeWithoutPrompts([
			"skills",
			"install",
			"--agent",
			"claude-code",
			"--agent",
			"universal",
			"--skill",
			"demo",
		]);

		// Without a terminal, any prompt would fail the run.
		expect(captured.exitCode, captured.stderr).toBe(0);
		expect(await linkTarget(join(claude, "demo"))).toBe(join(source, "demo"));
		expect(await linkTarget(target("demo"))).toBe(join(source, "demo"));
		await expect(lstat(join(claude, "guide"))).rejects.toThrow();
		await expect(lstat(target("guide"))).rejects.toThrow();
	});

	it("prompts only for agents when --skill is given", async () => {
		await writeSource("demo");
		await writeSource("guide");

		const { harness, run } = executeWithPrompts(["skills", "--skill", "guide"]);
		await waitForPrompt(harness, "Select agents to install for");
		harness.keys("space", "enter");
		await run;

		expect(harness.screen()).not.toContain("Select skills to install");
		expect((await lstat(target("guide"))).isSymbolicLink()).toBe(true);
		await expect(lstat(target("demo"))).rejects.toThrow();
	});

	it("prompts only for skills when --agent is given", async () => {
		await writeSource("demo");
		await writeSource("guide");

		const { harness, run } = executeWithPrompts(["skills", "--agent", "universal"]);
		await waitForPrompt(harness, "Select skills to install");
		// Both start selected; drop "guide".
		harness.keys("down", "space", "enter");
		await run;

		expect(harness.screen()).not.toContain("Select agents to install for");
		expect((await lstat(target("demo"))).isSymbolicLink()).toBe(true);
		await expect(lstat(target("guide"))).rejects.toThrow();
	});

	it("skips a conflict without prompting when agents come from --agent", async () => {
		await writeSource("demo");
		await mkdir(target(), { recursive: true });

		const captured = await executeWithoutPrompts(["skills", "--agent", "universal"]);

		expect(captured.exitCode).toBe(0);
		expect(captured.stderr).toContain(
			"Skipped Universal [demo]: directory is not owned by this skill.",
		);
		expect((await lstat(target())).isDirectory()).toBe(true);
	});

	it.each([
		[
			["skills", "--all", "--agent", "universal"],
			"--all cannot be combined with --agent or --skill.",
		],
		[
			["skills", "install", "--all", "--skill", "demo"],
			"--all cannot be combined with --agent or --skill.",
		],
		[["skills", "uninstall", "--all", "--skill", "demo"], "--all cannot be combined with --skill."],
		[
			["skills", "--agent", "nope"],
			'Unknown agent "nope" for --agent. Use "universal" for the Universal group or an agent id from https://crustjs.com/docs/modules/skills#supported-agents.',
		],
		[
			["skills", "--skill", "nope"],
			'Unknown skill "nope" for --skill. Packaged skills: demo, guide.',
		],
		[
			["skills", "uninstall", "--skill", "nope"],
			'Unknown skill "nope" for --skill. Packaged skills: demo, guide.',
		],
		[
			["skills", "--agent", "eve", "--scope", "global"],
			'Agent "eve" (Eve) has no global skills directory; use --scope project.',
		],
	])("rejects %j as a usage error", async (argv, message) => {
		await writeSource("demo");
		await writeSource("guide");

		const captured = await executeWithoutPrompts(argv);

		expect(captured.exitCode).not.toBe(0);
		expect(captured.stderr).toContain(message);
		await expect(lstat(target("demo"))).rejects.toThrow();
	});

	it("uninstalls the --skill selection without prompting", async () => {
		const source = await writeSource("demo");
		await writeSource("guide");
		await executeWithoutPrompts(["skills", "--all"]);

		const captured = await executeWithoutPrompts(["skills", "uninstall", "--skill", "demo"]);

		expect(captured.exitCode).toBe(0);
		expect(captured.stdout).toContain('Removed "demo"');
		await expect(lstat(target("demo"))).rejects.toThrow();
		expect(await linkTarget(target("guide"))).toBe(join(source, "guide"));
	});
});
