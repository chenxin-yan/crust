// ────────────────────────────────────────────────────────────────────────────
// Authored bundle loading for package skill-source builds
// ────────────────────────────────────────────────────────────────────────────

import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { join, sep } from "node:path";

import { resolveSourceDir } from "@crustjs/utils/source";
import { parse } from "ultramatter";

import type { RenderedFile } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

/** Filename of the entrypoint markdown file required at the bundle root. */
const SKILL_MD = "SKILL.md";

// ────────────────────────────────────────────────────────────────────────────
// Internal — frontmatter probe
// ────────────────────────────────────────────────────────────────────────────

/** Top-level scalar fields the skill-source build needs. */
interface BundleFrontmatter {
	name: string | null;
	description: string | null;
}

type FrontmatterProbe = {
	readonly name?: unknown;
	readonly description?: unknown;
};

/**
 * Protects hashes inside quoted scalars from ultramatter's comment stripping.
 * The sentinel cannot collide because it is chosen to be absent from the input.
 */
function protectQuotedHashes(input: string): { input: string; sentinel: string } {
	let sentinel = "\uE000";
	while (input.includes(sentinel)) sentinel += "\uE000";

	let quote: "'" | '"' | null = null;
	let protectedInput = "";
	for (let index = 0; index < input.length; index++) {
		const char = input[index]!;
		if (quote === '"' && char === "\\") {
			protectedInput += char + (input[++index] ?? "");
			continue;
		}
		if (char === "'" || char === '"') quote = quote === char ? null : (quote ?? char);
		protectedInput += char === "#" && quote !== null ? sentinel : char;
	}
	return { input: protectedInput, sentinel };
}

/** Reads top-level `name` and `description` from leading YAML frontmatter. */
export function probeFrontmatter(content: string): BundleFrontmatter {
	const result: BundleFrontmatter = { name: null, description: null };
	const normalized = content.startsWith("\uFEFF") ? content.slice(1) : content;
	const lines = normalized.split(/\r?\n/);

	let opening = 0;
	while (lines[opening]?.trim() === "") opening++;
	if (lines[opening] !== "---") return result;

	const closing = lines.findIndex((line, index) => index > opening && /^---\s*$/.test(line));
	if (closing === -1) return result;

	try {
		const block = lines.slice(opening + 1, closing).join("\n");
		const protectedBlock = protectQuotedHashes(block);
		const parsed = parse(`---\n${protectedBlock.input}\n---`).frontmatter;
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return result;
		const frontmatter = parsed as FrontmatterProbe;
		return {
			name:
				frontmatter.name == null
					? null
					: String(frontmatter.name).replaceAll(protectedBlock.sentinel, "#"),
			description:
				frontmatter.description == null
					? null
					: String(frontmatter.description).replaceAll(protectedBlock.sentinel, "#"),
		};
	} catch {
		return result;
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Internal — recursive walk with path-traversal guard
// ────────────────────────────────────────────────────────────────────────────

/**
 * Asserts that `realPath` lies inside (or equals) `canonicalRoot`.
 *
 * The check is performed on canonicalized paths (after `realpath`) so
 * symlinks pointing outside the skill directory root are reliably rejected. Includes
 * a `sep` boundary check to prevent `/canonical-foo` from matching `/canonical`.
 */
function assertInsideRoot(realPath: string, canonicalRoot: string, originalPath: string): void {
	const rootWithSep = canonicalRoot.endsWith(sep) ? canonicalRoot : canonicalRoot + sep;
	if (realPath !== canonicalRoot && !realPath.startsWith(rootWithSep)) {
		throw new Error(
			`Extra skill path traversal rejected: "${originalPath}" resolves to "${realPath}", ` +
				`which is outside the skill directory root "${canonicalRoot}".`,
		);
	}
}

interface CollectedFile {
	readonly relPath: string;
	readonly absPath: string;
}

/**
 * Recursively collects file paths under `dir`, rejecting any entry that
 * escapes `canonicalRoot` via symlink.
 *
 * Bundle contents are copied as authored — no implicit name-based filtering.
 * Bundle authors are responsible for keeping `sourceDir` clean (no
 * `node_modules/`, `.git/`, editor cruft, etc.).
 *
 * Cycle protection: directories are tracked by their canonical realpath in
 * `visitedDirs` so symlinks like `loop -> .` or `a/back -> ..` (which all
 * pass the inside-root guard) cannot drive unbounded recursion. The first
 * occurrence is walked; further occurrences are silently skipped.
 */
async function collectBundleEntries(
	dir: string,
	canonicalRoot: string,
	relPrefix: string,
	visitedDirs: Set<string>,
): Promise<CollectedFile[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const collected: CollectedFile[] = [];

	for (const entry of entries) {
		const name = entry.name;
		const absPath = join(dir, name);
		const relPath = relPrefix === "" ? name : `${relPrefix}/${name}`;

		const realPath = await realpath(absPath);
		assertInsideRoot(realPath, canonicalRoot, absPath);

		// Use the realpath's stat so symlinks-to-files / symlinks-to-dirs are
		// followed correctly (after the inside-root guard above).
		const realStat = await stat(realPath);
		if (realStat.isDirectory()) {
			if (visitedDirs.has(realPath)) {
				// Already walked (cycle or a second symlink to the same target).
				continue;
			}
			visitedDirs.add(realPath);
			collected.push(...(await collectBundleEntries(absPath, canonicalRoot, relPath, visitedDirs)));
		} else if (realStat.isFile()) {
			collected.push({ relPath, absPath });
		}
		// Other entry types (sockets, FIFOs, etc.) are silently skipped.
	}

	return collected;
}

// ────────────────────────────────────────────────────────────────────────────
// loadBundleFiles
// ────────────────────────────────────────────────────────────────────────────

/** Result of loading a hand-authored bundle: files plus parsed frontmatter. */
export interface LoadedBundle {
	readonly files: readonly RenderedFile[];
	readonly frontmatter: {
		readonly name: string;
		readonly description: string;
	};
}

/**
 * Loads the contents of a hand-authored skill bundle and extracts the
 * `name`/`description` it declares in its `SKILL.md` frontmatter.
 *
 * Steps:
 * 1. Resolve `sourceDir` (URL / absolute / relative-from-package-root).
 * 2. `realpath` the resolved path; reject if not a directory.
 * 3. Recursively walk, applying a per-entry path-traversal guard against the
 *    canonical root and a directory-cycle guard.
 * 4. Verify `SKILL.md` exists at the bundle root.
 * 5. Probe the frontmatter for `name:` and `description:` — both are required.
 *
 * The returned `frontmatter` becomes the source of truth for the build
 * pipeline and output paths. Crust does not rewrite `SKILL.md`; the bundle
 * author owns it.
 *
 * @internal Exported for unit testing.
 */
export async function loadBundleFiles(sourceDir: string | URL): Promise<LoadedBundle> {
	const resolved = resolveSourceDir(sourceDir);

	let canonicalRoot: string;
	try {
		canonicalRoot = await realpath(resolved);
	} catch (err) {
		throw new Error(`Extra skill directory "${resolved}" does not exist or is not accessible.`, {
			cause: err,
		});
	}

	const rootStat = await stat(canonicalRoot);
	if (!rootStat.isDirectory()) {
		throw new Error(`Extra skill path "${canonicalRoot}" is not a directory.`);
	}

	// Seed the visited set with the canonical root itself so a child symlink
	// pointing back to root (e.g. `loop -> .`) is rejected on first descent.
	const visitedDirs = new Set<string>([canonicalRoot]);
	const collected = await collectBundleEntries(canonicalRoot, canonicalRoot, "", visitedDirs);

	const skillMd = collected.find((f) => f.relPath === SKILL_MD);
	if (!skillMd) {
		throw new Error(
			`Extra skill directory is missing SKILL.md at its root "${canonicalRoot}". ` +
				`Every extra skill directory must contain a top-level SKILL.md file.`,
		);
	}

	const files = await Promise.all(
		collected.map(async (entry) => ({
			path: entry.relPath,
			content: await readFile(entry.absPath),
		})),
	);

	const skillContent = await readFile(skillMd.absPath, "utf-8");
	const probed = probeFrontmatter(skillContent);

	if (probed.name === null || probed.name === "") {
		throw new Error(
			`Extra skill SKILL.md is missing a top-level \`name:\` field in its YAML frontmatter ` +
				`(at "${join(canonicalRoot, SKILL_MD)}"). ` +
				`Add \`name: <skill-name>\` to the frontmatter block.`,
		);
	}
	if (probed.description === null || probed.description === "") {
		throw new Error(
			`Extra skill SKILL.md is missing a top-level \`description:\` field in its YAML frontmatter ` +
				`(at "${join(canonicalRoot, SKILL_MD)}"). ` +
				`Add \`description: <one-line summary>\` to the frontmatter block.`,
		);
	}

	return {
		files,
		frontmatter: { name: probed.name, description: probed.description },
	};
}
