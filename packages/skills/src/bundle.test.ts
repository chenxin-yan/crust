import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadBundleFiles } from "./bundle.ts";
import { CRUST_MANIFEST } from "./version.ts";

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
