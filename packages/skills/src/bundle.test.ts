import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { loadBundleFiles } from "./bundle.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test helpers
// ────────────────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
	tmpDir = await mkdtemp(join(tmpdir(), "crust-skill-bundle-"));
});

afterEach(async () => {
	await rm(tmpDir, { recursive: true, force: true });
});

/** Writes a bundle directory holding only `SKILL.md`. */
async function writeBundle(skillMd: string): Promise<string> {
	const dir = join(tmpDir, "skill");
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "SKILL.md"), skillMd);
	return dir;
}

// ────────────────────────────────────────────────────────────────────────────
// loadBundleFiles
// ────────────────────────────────────────────────────────────────────────────

describe("loadBundleFiles", () => {
	it("copies root-level authored content as-is (dotfiles, node_modules, etc. are NOT filtered)", async () => {
		// Bundle authors own `sourceDir` cleanliness. The walker copies what's
		// there — including root dotfiles like `.env.example` or `.tool-versions`
		// that may be intentional skill content.
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

	it("survives an internal directory symlink cycle without unbounded recursion", async () => {
		// `loop -> .` is a directory symlink that resolves inside the bundle
		// root, so the path-traversal guard accepts it. Without cycle detection
		// the walker would recurse into loop/loop/... until ELOOP/path-length.
		const dir = await writeBundle(
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

	it.each([
		["no frontmatter at all", "# Bundle\nNo frontmatter\n", /`name:`/],
		["empty frontmatter values", '---\nname: ""\ndescription: ""\n---\n', /`name:`/],
		[
			"whitespace-only frontmatter values",
			'---\nname: skill\ndescription: "   "\n---\n',
			/`description:`/,
		],
		// A nested key under `metadata:` must not be mistaken for the top-level name.
		[
			"only a nested `name:` key",
			"---\ndescription: Build a sales funnel\nmetadata:\n  name: other-name\n---\n",
			/`name:`/,
		],
	])("rejects SKILL.md with %s", async (_case, skillMd, error) => {
		await expect(loadBundleFiles(await writeBundle(skillMd))).rejects.toThrow(error);
	});

	it.each([
		[
			"strips a leading UTF-8 BOM before locating the opening fence",
			"\uFEFF---\nname: funnel-builder\ndescription: Build a sales funnel\n---\n",
			{ name: "funnel-builder", description: "Build a sales funnel" },
		],
		[
			"strips a trailing `# comment` after a quoted frontmatter value",
			'---\nname: "funnel-builder" # canonical name\ndescription: "Build a sales funnel" # one-liner\n---\n',
			{ name: "funnel-builder", description: "Build a sales funnel" },
		],
		[
			"keeps `#` verbatim when it appears inside a quoted scalar",
			'---\nname: funnel-builder\ndescription: "Tag #1 funnel builder"\n---\n',
			{ name: "funnel-builder", description: "Tag #1 funnel builder" },
		],
		[
			"strips a trailing `# comment` from an unquoted frontmatter value",
			"---\nname: funnel-builder # canonical name\ndescription: Build a sales funnel # one-liner\n---\n",
			{ name: "funnel-builder", description: "Build a sales funnel" },
		],
		[
			"tolerates a closing fence with trailing whitespace",
			"---\nname: funnel-builder\ndescription: Build a sales funnel\n--- \n# Bundle\n",
			{ name: "funnel-builder", description: "Build a sales funnel" },
		],
		[
			"keeps a quoted value that starts with a block scalar indicator",
			'---\nname: funnel-builder\ndescription: ">-"\n---\n',
			{ name: "funnel-builder", description: ">-" },
		],
		[
			"handles CRLF line endings",
			"---\r\nname: funnel-builder\r\ndescription: Build a sales funnel\r\n---\r\n",
			{ name: "funnel-builder", description: "Build a sales funnel" },
		],
	])("%s", async (_title, skillMd, expected) => {
		const { frontmatter } = await loadBundleFiles(await writeBundle(skillMd));
		expect(frontmatter).toEqual(expected);
	});

	it.each([">-", "|", ">", "|+", "!!str |-", "&desc >", "!!str &desc |"])(
		"rejects a `%s` YAML block scalar instead of reading the indicator as the value",
		async (indicator) => {
			const dir = await writeBundle(
				`---\nname: funnel-builder\ndescription: ${indicator}\n  Build a sales\n  funnel\n---\n`,
			);
			await expect(loadBundleFiles(dir)).rejects.toThrow(
				/SKILL\.md.*YAML block scalar for `description:`.*one line/,
			);
		},
	);

	it("rejects a path-traversal symlink that escapes the bundle root", async () => {
		const dir = await writeBundle(
			"---\nname: funnel-builder\ndescription: Build a sales funnel\n---\n",
		);
		const outside = join(tmpDir, "outside-target");
		await mkdir(outside, { recursive: true });
		await writeFile(join(outside, "secret.txt"), "should not be readable");
		await symlink(outside, join(dir, "escape"));

		await expect(loadBundleFiles(dir)).rejects.toThrow(/path traversal/i);
	});

	it("throws when the resolved path is not a directory", async () => {
		const filePath = join(tmpDir, "not-a-dir");
		await writeFile(filePath, "x");
		await expect(loadBundleFiles(filePath)).rejects.toThrow(/not a directory/i);
	});
});
