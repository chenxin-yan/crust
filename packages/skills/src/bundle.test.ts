import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	mkdir,
	readdir,
	readFile,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Crust } from "@crustjs/core";
import {
	installSkillBundle,
	loadBundleFiles,
	resolveBundleSourceDir,
} from "./bundle.ts";
import { SkillConflictError } from "./errors.ts";
import { generateSkill } from "./generate.ts";
import type { AgentResult, SkillMeta } from "./types.ts";
import { CRUST_MANIFEST, readInstalledManifest } from "./version.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test helpers
// ────────────────────────────────────────────────────────────────────────────

const FIXTURE_DIR = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"tests",
	"fixtures",
	"bundle",
);

let tmpDir: string;

beforeEach(async () => {
	const base = join(import.meta.dirname ?? ".", ".tmp-test");
	const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	tmpDir = join(base, id);
	await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
	try {
		await rm(tmpDir, { recursive: true });
	} catch {
		// Ignore cleanup errors
	}
});

async function withCwd<T>(dir: string, fn: () => Promise<T>): Promise<T> {
	const original = process.cwd;
	process.cwd = () => dir;
	try {
		return await fn();
	} finally {
		process.cwd = original;
	}
}

async function withArgv1<T>(value: string, fn: () => Promise<T>): Promise<T> {
	const original = process.argv[1];
	process.argv[1] = value;
	try {
		return await fn();
	} finally {
		if (original === undefined) {
			process.argv.length = 1;
		} else {
			process.argv[1] = original;
		}
	}
}

async function listFiles(dir: string, prefix = ""): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const out: string[] = [];
	for (const entry of entries) {
		const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			out.push(...(await listFiles(join(dir, entry.name), rel)));
		} else {
			out.push(rel);
		}
	}
	return out.sort();
}

const META: SkillMeta = {
	name: "funnel-builder",
	description: "Build a sales funnel",
	version: "1.0.0",
};

// ────────────────────────────────────────────────────────────────────────────
// resolveBundleSourceDir
// ────────────────────────────────────────────────────────────────────────────

describe("resolveBundleSourceDir", () => {
	it("resolves a file: URL", () => {
		const url = pathToFileURL(`${FIXTURE_DIR}/`);
		expect(resolveBundleSourceDir(url)).toBe(fileURLToPath(url));
	});

	it("rejects a non-file: URL with a clear error", () => {
		const url = new URL("https://example.com/skills/funnel-builder");
		expect(() => resolveBundleSourceDir(url)).toThrow(/file: protocol/);
	});

	it("returns absolute string paths verbatim (after resolve)", () => {
		expect(resolveBundleSourceDir(FIXTURE_DIR)).toBe(FIXTURE_DIR);
	});

	it("resolves relative string paths from the nearest package.json", async () => {
		// The test runs inside packages/skills/, which has a package.json.
		// Use src/ as the "entrypoint" so the walk lands on packages/skills/.
		const fakeEntry = join(dirname(fileURLToPath(import.meta.url)), "index.ts");
		await withArgv1(fakeEntry, async () => {
			const resolved = resolveBundleSourceDir("tests/fixtures/bundle");
			// The package root is packages/skills/
			expect(resolved.endsWith("/tests/fixtures/bundle")).toBe(true);
		});
	});

	it("throws when relative path is supplied with no process.argv[1]", async () => {
		const original = process.argv[1];
		process.argv.length = 1; // unset argv[1]
		try {
			expect(() => resolveBundleSourceDir("skills/x")).toThrow(
				/process\.argv\[1\] is not set/,
			);
		} finally {
			if (original !== undefined) process.argv[1] = original;
		}
	});

	it("throws when no walkable package.json is found", async () => {
		// /tmp typically has no package.json walking up from it.
		await withArgv1("/tmp/no-pkg-here.js", async () => {
			expect(() => resolveBundleSourceDir("rel/path")).toThrow(
				/no package\.json was found/,
			);
		});
	});
});

// ────────────────────────────────────────────────────────────────────────────
// loadBundleFiles
// ────────────────────────────────────────────────────────────────────────────

describe("loadBundleFiles", () => {
	it("loads SKILL.md, top-level supporting files, and nested files", async () => {
		const files = await loadBundleFiles(FIXTURE_DIR, META);
		const paths = files.map((f) => f.path).sort();
		expect(paths).toContain("SKILL.md");
		expect(paths).toContain("playbook.md");
		expect(paths).toContain("subdir/notes.md");
		// Nested dotfiles ARE copied.
		expect(paths).toContain("subdir/.config");
	});

	it("excludes node_modules/, .git/, root dotfiles, and stale crust.json", async () => {
		const files = await loadBundleFiles(FIXTURE_DIR, META);
		const paths = files.map((f) => f.path);
		expect(paths.some((p) => p.startsWith("node_modules/"))).toBe(false);
		expect(paths.some((p) => p.startsWith(".git"))).toBe(false);
		expect(paths.includes(".gitignore")).toBe(false);
		expect(paths.includes(CRUST_MANIFEST)).toBe(false);
	});

	it("throws a clear error when SKILL.md is missing", async () => {
		const dir = join(tmpDir, "no-skill-md");
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "playbook.md"), "# Playbook\n");
		await expect(loadBundleFiles(dir, META)).rejects.toThrow(/SKILL\.md/);
	});

	it("throws when frontmatter name does not match meta.name", async () => {
		const dir = join(tmpDir, "name-mismatch");
		await mkdir(dir, { recursive: true });
		await writeFile(
			join(dir, "SKILL.md"),
			"---\nname: other-name\ndescription: x\n---\n",
		);
		await expect(loadBundleFiles(dir, META)).rejects.toThrow(
			/does not match meta\.name/,
		);
	});

	it("accepts a quoted matching frontmatter name", async () => {
		const dir = join(tmpDir, "name-quoted");
		await mkdir(dir, { recursive: true });
		await writeFile(
			join(dir, "SKILL.md"),
			'---\nname: "funnel-builder"\ndescription: x\n---\n',
		);
		const files = await loadBundleFiles(dir, META);
		expect(files.find((f) => f.path === "SKILL.md")).toBeDefined();
	});

	it("accepts SKILL.md with no frontmatter (probe is silent)", async () => {
		const dir = join(tmpDir, "no-frontmatter");
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "SKILL.md"), "# Bundle\nNo frontmatter\n");
		const files = await loadBundleFiles(dir, META);
		expect(files).toHaveLength(1);
	});

	it("accepts SKILL.md with frontmatter but no name field", async () => {
		const dir = join(tmpDir, "no-name-key");
		await mkdir(dir, { recursive: true });
		await writeFile(
			join(dir, "SKILL.md"),
			"---\ndescription: x\n---\n# Bundle\n",
		);
		const files = await loadBundleFiles(dir, META);
		expect(files.find((f) => f.path === "SKILL.md")).toBeDefined();
	});

	it("rejects a path-traversal symlink that escapes the bundle root", async () => {
		const dir = join(tmpDir, "with-escape");
		const outside = join(tmpDir, "outside-target");
		await mkdir(dir, { recursive: true });
		await mkdir(outside, { recursive: true });
		await writeFile(join(outside, "secret.txt"), "should not be readable");
		await writeFile(
			join(dir, "SKILL.md"),
			"---\nname: funnel-builder\ndescription: x\n---\n",
		);
		await symlink(outside, join(dir, "escape"));

		await expect(loadBundleFiles(dir, META)).rejects.toThrow(/path traversal/i);
	});

	it("throws when the resolved path is not a directory", async () => {
		const filePath = join(tmpDir, "not-a-dir");
		await writeFile(filePath, "x");
		await expect(loadBundleFiles(filePath, META)).rejects.toThrow(
			/not a directory/i,
		);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// installSkillBundle — fresh / update / up-to-date
// ────────────────────────────────────────────────────────────────────────────

describe("installSkillBundle", () => {
	it("fresh install writes canonical bundle and fans out to agents", async () => {
		const result = await withCwd(tmpDir, () =>
			installSkillBundle({
				meta: META,
				sourceDir: FIXTURE_DIR,
				agents: ["claude-code"],
				scope: "project",
			}),
		);

		expect(result.agents).toHaveLength(1);
		const agent = result.agents[0] as AgentResult;
		expect(agent.status).toBe("installed");
		expect(agent.agent).toBe("claude-code");

		// Canonical bundle exists and contains expected files.
		const canonicalDir = join(tmpDir, ".crust", "skills", "funnel-builder");
		const files = await listFiles(canonicalDir);
		expect(files).toContain("SKILL.md");
		expect(files).toContain("playbook.md");
		expect(files).toContain("subdir/notes.md");
		expect(files).toContain("subdir/.config");
		expect(files).toContain(CRUST_MANIFEST);

		// Excluded files are NOT present.
		expect(files.some((p) => p.startsWith("node_modules/"))).toBe(false);
		expect(files.some((p) => p.startsWith(".git"))).toBe(false);
		expect(files.includes(".gitignore")).toBe(false);

		// crust.json carries kind: "bundle"
		const manifest = await readInstalledManifest(canonicalDir);
		expect(manifest).toEqual({ version: "1.0.0", kind: "bundle" });

		// Stale crust.json from the source fixture was NOT copied.
		const written = JSON.parse(
			await readFile(join(canonicalDir, CRUST_MANIFEST), "utf-8"),
		);
		expect(written.name).toBe("funnel-builder");
		expect(written.version).toBe("1.0.0");
	});

	it("update path: bumping version reports 'updated' with previousVersion", async () => {
		await withCwd(tmpDir, () =>
			installSkillBundle({
				meta: META,
				sourceDir: FIXTURE_DIR,
				agents: ["claude-code"],
				scope: "project",
			}),
		);
		const result = await withCwd(tmpDir, () =>
			installSkillBundle({
				meta: { ...META, version: "2.0.0" },
				sourceDir: FIXTURE_DIR,
				agents: ["claude-code"],
				scope: "project",
			}),
		);
		const agent = result.agents[0] as AgentResult;
		expect(agent.status).toBe("updated");
		expect(agent.previousVersion).toBe("1.0.0");
	});

	it("up-to-date path: same version reports 'up-to-date'", async () => {
		await withCwd(tmpDir, () =>
			installSkillBundle({
				meta: META,
				sourceDir: FIXTURE_DIR,
				agents: ["claude-code"],
				scope: "project",
			}),
		);
		const result = await withCwd(tmpDir, () =>
			installSkillBundle({
				meta: META,
				sourceDir: FIXTURE_DIR,
				agents: ["claude-code"],
				scope: "project",
			}),
		);
		const agent = result.agents[0] as AgentResult;
		expect(agent.status).toBe("up-to-date");
	});

	it("agents: [] is a no-op", async () => {
		const result = await withCwd(tmpDir, () =>
			installSkillBundle({
				meta: META,
				sourceDir: FIXTURE_DIR,
				agents: [],
				scope: "project",
			}),
		);
		expect(result.agents).toHaveLength(0);
		// No canonical directory created.
		const canonicalDir = join(tmpDir, ".crust", "skills", "funnel-builder");
		await expect(stat(canonicalDir)).rejects.toThrow();
	});

	// ────────────────────────────────────────────────────────────────────────
	// Kind-mismatch behavior
	// ────────────────────────────────────────────────────────────────────────

	it("kind mismatch: generated -> bundle without force throws SkillConflictError", async () => {
		const cmd = new Crust("funnel-builder")._node;
		Object.assign(cmd.meta, { name: "funnel-builder", description: "x" });
		await withCwd(tmpDir, () =>
			generateSkill({
				command: cmd,
				meta: META,
				agents: ["claude-code"],
				scope: "project",
			}),
		);

		let caught: SkillConflictError | undefined;
		try {
			await withCwd(tmpDir, () =>
				installSkillBundle({
					meta: META,
					sourceDir: FIXTURE_DIR,
					agents: ["claude-code"],
					scope: "project",
				}),
			);
		} catch (err) {
			if (err instanceof SkillConflictError) caught = err;
			else throw err;
		}
		expect(caught).toBeInstanceOf(SkillConflictError);
		expect(caught?.details.kindMismatch).toEqual({
			existing: "generated",
			attempted: "bundle",
		});
	});

	it("kind mismatch: generated -> bundle with force overwrites kind", async () => {
		const cmd = new Crust("funnel-builder")._node;
		Object.assign(cmd.meta, { name: "funnel-builder", description: "x" });
		await withCwd(tmpDir, () =>
			generateSkill({
				command: cmd,
				meta: META,
				agents: ["claude-code"],
				scope: "project",
			}),
		);

		const result = await withCwd(tmpDir, () =>
			installSkillBundle({
				meta: { ...META, version: "2.0.0" },
				sourceDir: FIXTURE_DIR,
				agents: ["claude-code"],
				scope: "project",
				force: true,
			}),
		);
		expect(result.agents).toHaveLength(1);

		const canonicalDir = join(tmpDir, ".crust", "skills", "funnel-builder");
		const manifest = await readInstalledManifest(canonicalDir);
		expect(manifest).toEqual({ version: "2.0.0", kind: "bundle" });
	});

	it("reverse mismatch: bundle -> generateSkill without force throws", async () => {
		await withCwd(tmpDir, () =>
			installSkillBundle({
				meta: META,
				sourceDir: FIXTURE_DIR,
				agents: ["claude-code"],
				scope: "project",
			}),
		);

		const cmd = new Crust("funnel-builder")._node;
		Object.assign(cmd.meta, { name: "funnel-builder", description: "x" });
		let caught: SkillConflictError | undefined;
		try {
			await withCwd(tmpDir, () =>
				generateSkill({
					command: cmd,
					meta: { ...META, version: "2.0.0" },
					agents: ["claude-code"],
					scope: "project",
				}),
			);
		} catch (err) {
			if (err instanceof SkillConflictError) caught = err;
			else throw err;
		}
		expect(caught?.details.kindMismatch).toEqual({
			existing: "bundle",
			attempted: "generated",
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Pre-flight error wiring (smoke tests; logic covered in loadBundleFiles)
	// ────────────────────────────────────────────────────────────────────────

	it("propagates SKILL.md missing error from loadBundleFiles", async () => {
		const dir = join(tmpDir, "empty");
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "playbook.md"), "x");
		await expect(
			withCwd(tmpDir, () =>
				installSkillBundle({
					meta: META,
					sourceDir: dir,
					agents: ["claude-code"],
					scope: "project",
				}),
			),
		).rejects.toThrow(/SKILL\.md/);
	});

	it("propagates frontmatter name mismatch from loadBundleFiles", async () => {
		const dir = join(tmpDir, "name-mismatch");
		await mkdir(dir, { recursive: true });
		await writeFile(
			join(dir, "SKILL.md"),
			"---\nname: other-name\ndescription: x\n---\n",
		);
		await expect(
			withCwd(tmpDir, () =>
				installSkillBundle({
					meta: META,
					sourceDir: dir,
					agents: ["claude-code"],
					scope: "project",
				}),
			),
		).rejects.toThrow(/does not match meta\.name/);
	});

	it("rejects an invalid meta.name", async () => {
		await expect(
			withCwd(tmpDir, () =>
				installSkillBundle({
					meta: { ...META, name: "Funnel-Builder" }, // uppercase invalid
					sourceDir: FIXTURE_DIR,
					agents: ["claude-code"],
					scope: "project",
				}),
			),
		).rejects.toThrow(/Invalid skill name/);
	});

	// ────────────────────────────────────────────────────────────────────────
	// installMode round-trips
	// ────────────────────────────────────────────────────────────────────────

	for (const installMode of ["auto", "symlink", "copy"] as const) {
		it(`installMode "${installMode}" round-trips`, async () => {
			const result = await withCwd(tmpDir, () =>
				installSkillBundle({
					meta: META,
					sourceDir: FIXTURE_DIR,
					agents: ["claude-code"],
					scope: "project",
					installMode,
				}),
			);
			expect(result.agents).toHaveLength(1);
			const agent = result.agents[0] as AgentResult;
			expect(agent.status).toBe("installed");

			const canonicalDir = join(tmpDir, ".crust", "skills", "funnel-builder");
			const manifest = await readInstalledManifest(canonicalDir);
			expect(manifest?.kind).toBe("bundle");

			// Agent path holds either a symlink (auto/symlink) or a copy.
			const agentDir = agent.outputDir;
			const agentSkillMd = join(agentDir, "SKILL.md");
			const content = await readFile(agentSkillMd, "utf-8");
			expect(content).toContain("Funnel Builder");
		});
	}
});
