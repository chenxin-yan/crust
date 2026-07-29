import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { lstat, mkdir, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Crust } from "@crustjs/core";
import { snapshotCommand } from "@crustjs/core/tooling";

import { installSkillBundle, loadBundleFiles } from "./bundle.ts";
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

/**
 * Static fixture meta. Bundle authors no longer pass this to
 * `installSkillBundle` (frontmatter + version supersede it), but it remains
 * useful for `generateSkill` calls in cross-kind tests.
 */
const META: SkillMeta = {
	name: "funnel-builder",
	description: "Build a sales funnel",
	version: "1.0.0",
};

const BUNDLE_VERSION = "1.0.0";

// Resolution-mode coverage (URL / absolute / relative / failure modes) is
// owned by `@crustjs/utils/source` (see packages/utils/src/source.test.ts). The
// bundle-install pipeline relies on `resolveSourceDir` from `@crustjs/utils/source`
// and is exercised end-to-end via `loadBundleFiles` and `installSkillBundle`
// below.

// ────────────────────────────────────────────────────────────────────────────
// loadBundleFiles
// ────────────────────────────────────────────────────────────────────────────

describe("loadBundleFiles", () => {
	it("loads SKILL.md, top-level supporting files, and nested files", async () => {
		const { files } = await loadBundleFiles(FIXTURE_DIR);
		const paths = files.map((f) => f.path).sort();
		expect(paths).toContain("SKILL.md");
		expect(paths).toContain("playbook.md");
		expect(paths).toContain("subdir/notes.md");
		// Nested dotfiles ARE copied.
		expect(paths).toContain("subdir/.config");
	});

	it("copies root-level authored content as-is (dotfiles, node_modules, etc. are NOT filtered)", async () => {
		// Bundle authors own `sourceDir` cleanliness. The walker copies what's
		// there — including root dotfiles like `.env.example` or `.tool-versions`
		// that may be intentional skill content. The only reserved root filename
		// is `crust.json`, covered by its own test below.
		const dir = join(tmpDir, "as-is");
		await mkdir(join(dir, "node_modules", "left-pad"), { recursive: true });
		await writeFile(
			join(dir, "node_modules", "left-pad", "index.js"),
			"module.exports = () => {};\n",
		);
		await writeFile(join(dir, ".env.example"), "FOO=bar\n");
		await writeFile(join(dir, ".tool-versions"), "node 22\n");
		await writeFile(join(dir, ".DS_Store"), "\0noise");
		await mkdir(join(dir, ".git", "objects"), { recursive: true });
		await writeFile(join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
		await writeFile(
			join(dir, "SKILL.md"),
			"---\nname: funnel-builder\ndescription: Build a sales funnel\n---\n",
		);

		const { files } = await loadBundleFiles(dir);
		const paths = files.map((f) => f.path).sort();
		expect(paths).toContain("SKILL.md");
		expect(paths).toContain("node_modules/left-pad/index.js");
		expect(paths).toContain(".env.example");
		expect(paths).toContain(".tool-versions");
		expect(paths).toContain(".DS_Store");
		expect(paths).toContain(".git/HEAD");
	});

	it("throws when the bundle source contains a reserved `crust.json` at the root", async () => {
		const dir = join(tmpDir, "with-source-crust-json");
		await mkdir(dir, { recursive: true });
		await writeFile(
			join(dir, "SKILL.md"),
			"---\nname: funnel-builder\ndescription: Build a sales funnel\n---\n",
		);
		await writeFile(
			join(dir, CRUST_MANIFEST),
			`${JSON.stringify({ name: "funnel-builder", version: "0.0.0" }, null, "\t")}\n`,
		);

		await expect(loadBundleFiles(dir)).rejects.toThrow(/reserved file "crust\.json"/);
	});

	it("survives an internal directory symlink cycle without unbounded recursion", async () => {
		// `loop -> .` is a directory symlink that resolves inside the bundle
		// root, so the path-traversal guard accepts it. Without cycle detection
		// the walker would recurse into loop/loop/... until ELOOP/path-length.
		const dir = join(tmpDir, "with-cycle");
		await mkdir(dir, { recursive: true });
		await writeFile(
			join(dir, "SKILL.md"),
			"---\nname: funnel-builder\ndescription: Build a sales funnel\n---\n",
		);
		await symlink(".", join(dir, "loop"));

		const { files } = await loadBundleFiles(dir);
		const paths = files.map((f) => f.path).sort();
		expect(paths).toEqual(["SKILL.md"]);
	});

	it("throws a clear error when SKILL.md is missing", async () => {
		const dir = join(tmpDir, "no-skill-md");
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "playbook.md"), "# Playbook\n");
		await expect(loadBundleFiles(dir)).rejects.toThrow(/SKILL\.md/);
	});

	it("returns the frontmatter name and description verbatim", async () => {
		const { frontmatter } = await loadBundleFiles(FIXTURE_DIR);
		expect(frontmatter).toEqual({
			name: "funnel-builder",
			description: "Build a sales funnel",
		});
	});

	it("rejects SKILL.md with no frontmatter at all", async () => {
		const dir = join(tmpDir, "no-frontmatter");
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "SKILL.md"), "# Bundle\nNo frontmatter\n");
		await expect(loadBundleFiles(dir)).rejects.toThrow(/`name:`/);
	});

	it("rejects frontmatter with no top-level name field", async () => {
		const dir = join(tmpDir, "no-name-key");
		await mkdir(dir, { recursive: true });
		await writeFile(
			join(dir, "SKILL.md"),
			"---\ndescription: Build a sales funnel\n---\n# Bundle\n",
		);
		await expect(loadBundleFiles(dir)).rejects.toThrow(/`name:`/);
	});

	it("rejects frontmatter with no top-level description field", async () => {
		const dir = join(tmpDir, "no-description-key");
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "SKILL.md"), "---\nname: funnel-builder\n---\n# Bundle\n");
		await expect(loadBundleFiles(dir)).rejects.toThrow(/`description:`/);
	});

	it("rejects empty frontmatter values", async () => {
		const dir = join(tmpDir, "empty-values");
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "SKILL.md"), '---\nname: ""\ndescription: ""\n---\n');
		await expect(loadBundleFiles(dir)).rejects.toThrow(/`name:`/);
	});

	it("accepts a quoted frontmatter name", async () => {
		const dir = join(tmpDir, "name-quoted");
		await mkdir(dir, { recursive: true });
		await writeFile(
			join(dir, "SKILL.md"),
			'---\nname: "funnel-builder"\ndescription: Build a sales funnel\n---\n',
		);
		const { frontmatter } = await loadBundleFiles(dir);
		expect(frontmatter.name).toBe("funnel-builder");
	});

	it("strips a leading UTF-8 BOM before locating the opening fence", async () => {
		const dir = join(tmpDir, "bom");
		await mkdir(dir, { recursive: true });
		await writeFile(
			join(dir, "SKILL.md"),
			"\uFEFF---\nname: funnel-builder\ndescription: Build a sales funnel\n---\n",
		);
		const { frontmatter } = await loadBundleFiles(dir);
		expect(frontmatter.name).toBe("funnel-builder");
	});

	it("strips a trailing `# comment` after a quoted frontmatter value", async () => {
		const dir = join(tmpDir, "name-quoted-with-comment");
		await mkdir(dir, { recursive: true });
		await writeFile(
			join(dir, "SKILL.md"),
			'---\nname: "funnel-builder" # canonical name\ndescription: "Build a sales funnel" # one-liner\n---\n',
		);
		const { frontmatter } = await loadBundleFiles(dir);
		expect(frontmatter).toEqual({
			name: "funnel-builder",
			description: "Build a sales funnel",
		});
	});

	it("keeps `#` verbatim when it appears inside a quoted scalar", async () => {
		const dir = join(tmpDir, "desc-with-hash");
		await mkdir(dir, { recursive: true });
		await writeFile(
			join(dir, "SKILL.md"),
			'---\nname: funnel-builder\ndescription: "Tag #1 funnel builder"\n---\n',
		);
		const { frontmatter } = await loadBundleFiles(dir);
		expect(frontmatter.description).toBe("Tag #1 funnel builder");
	});

	it("strips a trailing `# comment` from an unquoted frontmatter value", async () => {
		const dir = join(tmpDir, "name-with-comment");
		await mkdir(dir, { recursive: true });
		await writeFile(
			join(dir, "SKILL.md"),
			"---\nname: funnel-builder # canonical name\ndescription: Build a sales funnel # one-liner\n---\n",
		);
		const { frontmatter } = await loadBundleFiles(dir);
		expect(frontmatter).toEqual({
			name: "funnel-builder",
			description: "Build a sales funnel",
		});
	});

	it("ignores nested `name:` keys (only top-level / unindented matches)", async () => {
		// A nested key under `metadata:` must not be mistaken for the top-level
		// name — without a real top-level `name`, the load must fail rather
		// than silently picking up the indented value.
		const dir = join(tmpDir, "nested-name");
		await mkdir(dir, { recursive: true });
		await writeFile(
			join(dir, "SKILL.md"),
			"---\ndescription: Build a sales funnel\nmetadata:\n  name: other-name\n---\n",
		);
		await expect(loadBundleFiles(dir)).rejects.toThrow(/`name:`/);
	});

	it("tolerates a closing fence with trailing whitespace", async () => {
		const dir = join(tmpDir, "fence-trailing-ws");
		await mkdir(dir, { recursive: true });
		await writeFile(
			join(dir, "SKILL.md"),
			"---\nname: funnel-builder\ndescription: Build a sales funnel\n--- \n# Bundle\n",
		);
		const { frontmatter } = await loadBundleFiles(dir);
		expect(frontmatter.name).toBe("funnel-builder");
	});

	it("handles CRLF line endings", async () => {
		const dir = join(tmpDir, "crlf");
		await mkdir(dir, { recursive: true });
		await writeFile(
			join(dir, "SKILL.md"),
			"---\r\nname: funnel-builder\r\ndescription: Build a sales funnel\r\n---\r\n",
		);
		const { frontmatter } = await loadBundleFiles(dir);
		expect(frontmatter).toEqual({
			name: "funnel-builder",
			description: "Build a sales funnel",
		});
	});

	it("rejects a path-traversal symlink that escapes the bundle root", async () => {
		const dir = join(tmpDir, "with-escape");
		const outside = join(tmpDir, "outside-target");
		await mkdir(dir, { recursive: true });
		await mkdir(outside, { recursive: true });
		await writeFile(join(outside, "secret.txt"), "should not be readable");
		await writeFile(
			join(dir, "SKILL.md"),
			"---\nname: funnel-builder\ndescription: Build a sales funnel\n---\n",
		);
		await symlink(outside, join(dir, "escape"));

		await expect(loadBundleFiles(dir)).rejects.toThrow(/path traversal/i);
	});

	it("throws when the resolved path is not a directory", async () => {
		const filePath = join(tmpDir, "not-a-dir");
		await writeFile(filePath, "x");
		await expect(loadBundleFiles(filePath)).rejects.toThrow(/not a directory/i);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// installSkillBundle — fresh / update / up-to-date
// ────────────────────────────────────────────────────────────────────────────

describe("installSkillBundle", () => {
	it("fresh install writes canonical bundle and fans out to agents", async () => {
		const result = await withCwd(tmpDir, () =>
			installSkillBundle({
				sourceDir: FIXTURE_DIR,
				agents: ["claude-code"],
				scope: "project",
				version: BUNDLE_VERSION,
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

		// crust.json carries kind: "bundle" and is regenerated from SkillMeta.
		const manifest = await readInstalledManifest(canonicalDir);
		expect(manifest).toEqual({ version: "1.0.0", kind: "bundle" });

		const written = JSON.parse(await readFile(join(canonicalDir, CRUST_MANIFEST), "utf-8"));
		expect(written.name).toBe("funnel-builder");
		expect(written.description).toBe("Build a sales funnel");
		expect(written.version).toBe("1.0.0");
	});

	it("update path: bumping version reports 'updated' with previousVersion", async () => {
		await withCwd(tmpDir, () =>
			installSkillBundle({
				sourceDir: FIXTURE_DIR,
				agents: ["claude-code"],
				scope: "project",
				version: "1.0.0",
			}),
		);
		const result = await withCwd(tmpDir, () =>
			installSkillBundle({
				sourceDir: FIXTURE_DIR,
				agents: ["claude-code"],
				scope: "project",
				version: "2.0.0",
			}),
		);
		const agent = result.agents[0] as AgentResult;
		expect(agent.status).toBe("updated");
		expect(agent.previousVersion).toBe("1.0.0");
	});

	it("up-to-date path: same version reports 'up-to-date'", async () => {
		await withCwd(tmpDir, () =>
			installSkillBundle({
				sourceDir: FIXTURE_DIR,
				agents: ["claude-code"],
				scope: "project",
				version: BUNDLE_VERSION,
			}),
		);
		const result = await withCwd(tmpDir, () =>
			installSkillBundle({
				sourceDir: FIXTURE_DIR,
				agents: ["claude-code"],
				scope: "project",
				version: BUNDLE_VERSION,
			}),
		);
		const agent = result.agents[0] as AgentResult;
		expect(agent.status).toBe("up-to-date");
	});

	it("force: true rewrites same-version bundle content", async () => {
		const firstSource = join(tmpDir, "first-bundle");
		const secondSource = join(tmpDir, "second-bundle");
		await mkdir(firstSource, { recursive: true });
		await mkdir(secondSource, { recursive: true });
		await writeFile(
			join(firstSource, "SKILL.md"),
			"---\nname: funnel-builder\ndescription: Initial bundle\n---\n\nInitial content\n",
		);
		await writeFile(
			join(secondSource, "SKILL.md"),
			"---\nname: funnel-builder\ndescription: Forced bundle\n---\n\nForced content\n",
		);

		await withCwd(tmpDir, () =>
			installSkillBundle({
				sourceDir: firstSource,
				agents: ["claude-code"],
				scope: "project",
				version: BUNDLE_VERSION,
				installMode: "copy",
			}),
		);

		const skillPath = join(tmpDir, ".claude", "skills", "funnel-builder", "SKILL.md");
		const canonicalPath = join(tmpDir, ".crust", "skills", "funnel-builder", "SKILL.md");
		expect(await readFile(skillPath, "utf-8")).toContain("Initial content");

		const result = await withCwd(tmpDir, () =>
			installSkillBundle({
				sourceDir: secondSource,
				agents: ["claude-code"],
				scope: "project",
				version: BUNDLE_VERSION,
				force: true,
				installMode: "copy",
			}),
		);

		const agent = result.agents[0] as AgentResult;
		expect(agent.status).toBe("updated");
		expect(agent.previousVersion).toBe(BUNDLE_VERSION);

		const agentContent = await readFile(skillPath, "utf-8");
		expect(agentContent).toContain("Forced content");
		expect(agentContent).not.toContain("Initial content");

		const canonicalContent = await readFile(canonicalPath, "utf-8");
		expect(canonicalContent).toContain("Forced content");
		expect(canonicalContent).not.toContain("Initial content");
	});

	it("force: true rewrites same-version bundle content in symlink mode", async () => {
		if (process.platform === "win32") {
			return;
		}

		const firstSource = join(tmpDir, "first-symlink-bundle");
		const secondSource = join(tmpDir, "second-symlink-bundle");
		await mkdir(firstSource, { recursive: true });
		await mkdir(secondSource, { recursive: true });
		await writeFile(
			join(firstSource, "SKILL.md"),
			"---\nname: funnel-builder\ndescription: Initial bundle\n---\n\nInitial content\n",
		);
		await writeFile(
			join(secondSource, "SKILL.md"),
			"---\nname: funnel-builder\ndescription: Forced bundle\n---\n\nForced content\n",
		);

		const first = await withCwd(tmpDir, () =>
			installSkillBundle({
				sourceDir: firstSource,
				agents: ["claude-code"],
				scope: "project",
				version: BUNDLE_VERSION,
				installMode: "symlink",
			}),
		);
		const outputDir = (first.agents[0] as AgentResult).outputDir;
		expect((await lstat(outputDir)).isSymbolicLink()).toBe(true);

		const skillPath = join(outputDir, "SKILL.md");
		expect(await readFile(skillPath, "utf-8")).toContain("Initial content");

		const result = await withCwd(tmpDir, () =>
			installSkillBundle({
				sourceDir: secondSource,
				agents: ["claude-code"],
				scope: "project",
				version: BUNDLE_VERSION,
				force: true,
				installMode: "symlink",
			}),
		);

		const agent = result.agents[0] as AgentResult;
		expect(agent.status).toBe("updated");
		expect(agent.previousVersion).toBe(BUNDLE_VERSION);

		const forcedContent = await readFile(skillPath, "utf-8");
		expect(forcedContent).toContain("Forced content");
		expect(forcedContent).not.toContain("Initial content");
	});

	it("agents: [] validates the bundle before returning", async () => {
		const dir = join(tmpDir, "missing-skill-md");
		await mkdir(dir, { recursive: true });

		await expect(
			withCwd(tmpDir, () =>
				installSkillBundle({
					sourceDir: dir,
					agents: [],
					scope: "project",
					version: BUNDLE_VERSION,
				}),
			),
		).rejects.toThrow(/SKILL\.md/);
	});

	it("agents: [] validates the frontmatter skill name before returning", async () => {
		const dir = join(tmpDir, "invalid-empty-agent");
		await mkdir(dir, { recursive: true });
		await writeFile(
			join(dir, "SKILL.md"),
			"---\nname: Funnel-Builder\ndescription: Build a sales funnel\n---\n",
		);

		await expect(
			withCwd(tmpDir, () =>
				installSkillBundle({
					sourceDir: dir,
					agents: [],
					scope: "project",
					version: BUNDLE_VERSION,
				}),
			),
		).rejects.toThrow(/Invalid skill name/);
	});

	it("agents: [] is a validated no-op", async () => {
		const result = await withCwd(tmpDir, () =>
			installSkillBundle({
				sourceDir: FIXTURE_DIR,
				agents: [],
				scope: "project",
				version: BUNDLE_VERSION,
			}),
		);
		expect(result.agents).toHaveLength(0);
		// No canonical directory created.
		const canonicalDir = join(tmpDir, ".crust", "skills", "funnel-builder");
		await expect(stat(canonicalDir)).rejects.toThrow();
	});

	it("preserves binary bundle files exactly", async () => {
		const dir = join(tmpDir, "with-binary");
		await mkdir(dir, { recursive: true });
		const binary = new Uint8Array([0xff, 0xfe, 0x00, 0x61, 0xc3, 0x28]);
		await writeFile(join(dir, "asset.bin"), binary);
		await writeFile(
			join(dir, "SKILL.md"),
			"---\nname: funnel-builder\ndescription: Build a sales funnel\n---\n",
		);

		await withCwd(tmpDir, () =>
			installSkillBundle({
				sourceDir: dir,
				agents: ["claude-code"],
				scope: "project",
				version: BUNDLE_VERSION,
			}),
		);

		const canonicalAsset = await readFile(
			join(tmpDir, ".crust", "skills", "funnel-builder", "asset.bin"),
		);
		expect([...canonicalAsset]).toEqual([...binary]);
	});

	// ────────────────────────────────────────────────────────────────────────
	// Kind-mismatch behavior
	// ────────────────────────────────────────────────────────────────────────

	it("kind mismatch: generated -> bundle without force throws SkillConflictError", async () => {
		const cmd = new Crust("funnel-builder")._node;
		Object.assign(cmd.meta, { name: "funnel-builder", description: "x" });
		await withCwd(tmpDir, () =>
			generateSkill({
				command: snapshotCommand(cmd),
				meta: META,
				agents: ["claude-code"],
				scope: "project",
			}),
		);

		let caught: SkillConflictError | undefined;
		try {
			await withCwd(tmpDir, () =>
				installSkillBundle({
					sourceDir: FIXTURE_DIR,
					agents: ["claude-code"],
					scope: "project",
					version: BUNDLE_VERSION,
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
				command: snapshotCommand(cmd),
				meta: META,
				agents: ["claude-code"],
				scope: "project",
			}),
		);

		const result = await withCwd(tmpDir, () =>
			installSkillBundle({
				sourceDir: FIXTURE_DIR,
				agents: ["claude-code"],
				scope: "project",
				version: "2.0.0",
				force: true,
			}),
		);
		expect(result.agents).toHaveLength(1);

		const canonicalDir = join(tmpDir, ".crust", "skills", "funnel-builder");
		const manifest = await readInstalledManifest(canonicalDir);
		expect(manifest).toEqual({ version: "2.0.0", kind: "bundle" });
	});

	it("agent-path-only kind mismatch: throws even when canonical is absent", async () => {
		// Pre-seed only the agent path with a mismatched `crust.json`. The
		// canonical store does not exist, so the canonical-side guard cannot
		// fire — the agent-path guard must catch this.
		const agentDir = join(tmpDir, ".claude", "skills", "funnel-builder");
		await mkdir(agentDir, { recursive: true });
		await writeFile(
			join(agentDir, CRUST_MANIFEST),
			`${JSON.stringify({ name: "funnel-builder", description: "x", version: "1.0.0", kind: "generated" }, null, "\t")}\n`,
		);

		let caught: SkillConflictError | undefined;
		try {
			await withCwd(tmpDir, () =>
				installSkillBundle({
					sourceDir: FIXTURE_DIR,
					agents: ["claude-code"],
					scope: "project",
					version: BUNDLE_VERSION,
					installMode: "copy",
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

	it("agent-path-only kind mismatch: force overwrites the agent copy", async () => {
		const agentDir = join(tmpDir, ".claude", "skills", "funnel-builder");
		await mkdir(agentDir, { recursive: true });
		await writeFile(
			join(agentDir, CRUST_MANIFEST),
			`${JSON.stringify({ name: "funnel-builder", description: "x", version: "1.0.0", kind: "generated" }, null, "\t")}\n`,
		);

		const result = await withCwd(tmpDir, () =>
			installSkillBundle({
				sourceDir: FIXTURE_DIR,
				agents: ["claude-code"],
				scope: "project",
				version: "2.0.0",
				installMode: "copy",
				force: true,
			}),
		);
		expect(result.agents).toHaveLength(1);

		const manifest = await readInstalledManifest(agentDir);
		expect(manifest).toEqual({ version: "2.0.0", kind: "bundle" });
	});

	it("copy-mode force-kind-switch at same version rewrites per-agent crust.json", async () => {
		// Regression: previously `ensureCopyInstallPath` decided whether to
		// rewrite solely on version equality, so a `force` kind switch at the
		// same version updated the canonical store but left every per-agent
		// copy with the stale kind — trapping the next non-force install in a
		// `SkillConflictError`. Cover both the rewrite and the follow-up call.
		const cmd = new Crust("funnel-builder")._node;
		Object.assign(cmd.meta, { name: "funnel-builder", description: "x" });
		await withCwd(tmpDir, () =>
			generateSkill({
				command: snapshotCommand(cmd),
				meta: META,
				agents: ["claude-code"],
				scope: "project",
				installMode: "copy",
			}),
		);

		const agentDir = join(tmpDir, ".claude", "skills", "funnel-builder");
		expect(await readInstalledManifest(agentDir)).toEqual({
			version: BUNDLE_VERSION,
			kind: "generated",
		});

		await withCwd(tmpDir, () =>
			installSkillBundle({
				sourceDir: FIXTURE_DIR,
				agents: ["claude-code"],
				scope: "project",
				version: BUNDLE_VERSION,
				installMode: "copy",
				force: true,
			}),
		);

		expect(await readInstalledManifest(agentDir)).toEqual({
			version: BUNDLE_VERSION,
			kind: "bundle",
		});

		// A follow-up non-force install of the same kind/version must be a
		// no-op, not a `SkillConflictError`.
		const followUp = await withCwd(tmpDir, () =>
			installSkillBundle({
				sourceDir: FIXTURE_DIR,
				agents: ["claude-code"],
				scope: "project",
				version: BUNDLE_VERSION,
				installMode: "copy",
			}),
		);
		expect(followUp.agents).toHaveLength(1);
		expect(followUp.agents[0]?.status).toBe("up-to-date");
	});

	it("reverse mismatch: bundle -> generateSkill without force throws", async () => {
		await withCwd(tmpDir, () =>
			installSkillBundle({
				sourceDir: FIXTURE_DIR,
				agents: ["claude-code"],
				scope: "project",
				version: BUNDLE_VERSION,
			}),
		);

		const cmd = new Crust("funnel-builder")._node;
		Object.assign(cmd.meta, { name: "funnel-builder", description: "x" });
		let caught: SkillConflictError | undefined;
		try {
			await withCwd(tmpDir, () =>
				generateSkill({
					command: snapshotCommand(cmd),
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
					sourceDir: dir,
					agents: ["claude-code"],
					scope: "project",
					version: BUNDLE_VERSION,
				}),
			),
		).rejects.toThrow(/SKILL\.md/);
	});

	it("rejects an invalid skill name declared in frontmatter", async () => {
		const dir = join(tmpDir, "invalid-name");
		await mkdir(dir, { recursive: true });
		await writeFile(
			join(dir, "SKILL.md"),
			"---\nname: Funnel-Builder\ndescription: Build a sales funnel\n---\n",
		);
		await expect(
			withCwd(tmpDir, () =>
				installSkillBundle({
					sourceDir: dir,
					agents: ["claude-code"],
					scope: "project",
					version: BUNDLE_VERSION,
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
					sourceDir: FIXTURE_DIR,
					agents: ["claude-code"],
					scope: "project",
					version: BUNDLE_VERSION,
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
