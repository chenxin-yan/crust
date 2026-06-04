// ────────────────────────────────────────────────────────────────────────────
// Bundle install — installs a hand-authored skill directory as a Crust skill
// ────────────────────────────────────────────────────────────────────────────

import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { join, sep } from "node:path";
import { resolveSourceDir } from "@crustjs/utils";
import {
	installRenderedSkill,
	isValidSkillName,
	resolveSkillName,
} from "./generate.ts";
import type {
	InstallSkillBundleOptions,
	InstallSkillBundleResult,
	RenderedFile,
	SkillMeta,
} from "./types.ts";
import { CRUST_MANIFEST } from "./version.ts";

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

/** Filename of the entrypoint markdown file required at the bundle root. */
const SKILL_MD = "SKILL.md";

// ────────────────────────────────────────────────────────────────────────────
// Internal — frontmatter probe
// ────────────────────────────────────────────────────────────────────────────

/** Top-level scalar fields the bundle install pipeline cares about. */
interface BundleFrontmatter {
	name: string | null;
	description: string | null;
}

/**
 * Lightweight scan of a SKILL.md head for top-level `name:` and `description:`
 * keys inside the leading YAML frontmatter block (between the first two `---`
 * lines).
 *
 * Returns whichever fields were found; missing fields are reported as `null`.
 * Callers decide whether absence is fatal. Hand-authored bundles require both,
 * but `loadBundleFiles` is left agnostic so unit tests can exercise the parser
 * directly.
 *
 * **`metadata.version` is intentionally not read.** The Agent Skills spec
 * lets bundles declare a version under `metadata.version`, but Crust treats
 * the `version` option passed to `installSkillBundle()` as the sole source
 * of truth for `crust.json` and update detection. The unindented-only
 * matching rule below already excludes nested `metadata.*` keys; this is
 * deliberate, not an oversight.
 *
 * Strictness rules (chosen to avoid false positives from nested keys and to
 * keep the parser dependency-free):
 * - Only **unindented** top-level lines are matched, so a nested block like
 *   `metadata:\n  name: other` is ignored.
 * - The opening fence must be `---` (after stripping a UTF-8 BOM and skipping
 *   blank lines); the closing fence is `---` with optional trailing whitespace.
 * - An unquoted value's trailing `# comment` is stripped (a quoted value keeps
 *   `#` verbatim).
 * - Quoted values (`"..."` or `'...'`) have a single matching pair of quotes
 *   stripped; everything else is taken verbatim and trimmed. Multi-line
 *   scalars, arrays, anchors, etc. are not parsed — bundle authors must keep
 *   `name` and `description` as simple single-line scalars.
 * - First occurrence wins for each key.
 */
function probeFrontmatter(content: string): BundleFrontmatter {
	const result: BundleFrontmatter = { name: null, description: null };
	const normalized = content.startsWith("\uFEFF") ? content.slice(1) : content;
	const lines = normalized.split(/\r?\n/, 51);

	let cursor = 0;
	while (cursor < lines.length && lines[cursor]?.trim() === "") cursor++;
	if (cursor >= lines.length || lines[cursor] !== "---") return result;
	cursor++; // step past the opening fence

	const limit = Math.min(50, lines.length);
	for (let i = cursor; i < limit; i++) {
		const line = lines[i];
		if (line === undefined) break;
		if (/^---\s*$/.test(line)) break;

		const m = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*?)\s*$/);
		if (!m) continue;
		const key = m[1];
		if (key !== "name" && key !== "description") continue;
		if (result[key] !== null) continue; // first wins
		result[key] = parseFrontmatterScalar(m[2] ?? "");
	}

	return result;
}

/**
 * Strips quotes (or an unquoted trailing `# comment`) from a frontmatter
 * scalar value the parser captured. Mirrors the limited YAML rules called out
 * in {@link probeFrontmatter}'s docstring.
 */
function parseFrontmatterScalar(raw: string): string {
	// Quoted form: locate the matching closing quote, return its interior, and
	// discard anything after it (whitespace + optional `# comment`). This keeps
	// `#` verbatim when it appears *inside* the quotes, while still stripping
	// a trailing inline comment that follows the closing quote.
	const first = raw[0];
	if (first === '"' || first === "'") {
		const close = raw.indexOf(first, 1);
		if (close !== -1) return raw.slice(1, close);
		// Unbalanced quote — fall through and treat as an unquoted scalar.
	}

	// Unquoted form: YAML treats `#` as a comment only when preceded by
	// whitespace (or at the start of the remainder). Anything before such a
	// marker is the value.
	const commentIdx = raw.search(/(^|\s)#/);
	return commentIdx === -1 ? raw : raw.slice(0, commentIdx).trimEnd();
}

// ────────────────────────────────────────────────────────────────────────────
// Internal — recursive walk with path-traversal guard
// ────────────────────────────────────────────────────────────────────────────

/**
 * Asserts that `realPath` lies inside (or equals) `canonicalRoot`.
 *
 * The check is performed on canonicalized paths (after `realpath`) so
 * symlinks pointing outside the bundle root are reliably rejected. Includes
 * a `sep` boundary check to prevent `/canonical-foo` from matching `/canonical`.
 */
function assertInsideRoot(
	realPath: string,
	canonicalRoot: string,
	originalPath: string,
): void {
	const rootWithSep = canonicalRoot.endsWith(sep)
		? canonicalRoot
		: canonicalRoot + sep;
	if (realPath !== canonicalRoot && !realPath.startsWith(rootWithSep)) {
		throw new Error(
			`Bundle path traversal rejected: "${originalPath}" resolves to "${realPath}", ` +
				`which is outside the bundle root "${canonicalRoot}".`,
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
 * `node_modules/`, `.git/`, editor cruft, etc.). The single reserved
 * filename is `crust.json` at the bundle root, enforced separately by
 * {@link loadBundleFiles}.
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
			collected.push(
				...(await collectBundleEntries(
					absPath,
					canonicalRoot,
					relPath,
					visitedDirs,
				)),
			);
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
 * 5. Reject a source-root `crust.json` (reserved — Crust regenerates it).
 * 6. Probe the frontmatter for `name:` and `description:` — both are required.
 *
 * The returned `frontmatter` becomes the source of truth for the install
 * pipeline (written into `crust.json` and used to derive output paths). Crust
 * does not rewrite `SKILL.md`; the bundle author owns it.
 *
 * @internal Exported for unit testing.
 */
export async function loadBundleFiles(
	sourceDir: string | URL,
): Promise<LoadedBundle> {
	const resolved = resolveSourceDir(sourceDir);

	let canonicalRoot: string;
	try {
		canonicalRoot = await realpath(resolved);
	} catch (err) {
		throw new Error(
			`Bundle source directory "${resolved}" does not exist or is not accessible.`,
			{ cause: err },
		);
	}

	const rootStat = await stat(canonicalRoot);
	if (!rootStat.isDirectory()) {
		throw new Error(
			`Bundle source path "${canonicalRoot}" is not a directory.`,
		);
	}

	// Seed the visited set with the canonical root itself so a child symlink
	// pointing back to root (e.g. `loop -> .`) is rejected on first descent.
	const visitedDirs = new Set<string>([canonicalRoot]);
	const collected = await collectBundleEntries(
		canonicalRoot,
		canonicalRoot,
		"",
		visitedDirs,
	);

	const skillMd = collected.find((f) => f.relPath === SKILL_MD);
	if (!skillMd) {
		throw new Error(
			`Bundle is missing SKILL.md at the bundle root "${canonicalRoot}". ` +
				`Every skill bundle must contain a top-level SKILL.md file.`,
		);
	}

	if (collected.some((f) => f.relPath === CRUST_MANIFEST)) {
		throw new Error(
			`Bundle source at "${canonicalRoot}" contains a reserved file "${CRUST_MANIFEST}" at the root. ` +
				`Crust regenerates this file during installation; remove it from your bundle source.`,
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
			`Bundle SKILL.md is missing a top-level \`name:\` field in its YAML frontmatter ` +
				`(at "${join(canonicalRoot, SKILL_MD)}"). ` +
				`Add \`name: <skill-name>\` to the frontmatter block.`,
		);
	}
	if (probed.description === null || probed.description === "") {
		throw new Error(
			`Bundle SKILL.md is missing a top-level \`description:\` field in its YAML frontmatter ` +
				`(at "${join(canonicalRoot, SKILL_MD)}"). ` +
				`Add \`description: <one-line summary>\` to the frontmatter block.`,
		);
	}

	return {
		files,
		frontmatter: { name: probed.name, description: probed.description },
	};
}

// ────────────────────────────────────────────────────────────────────────────
// Public API — installSkillBundle
// ────────────────────────────────────────────────────────────────────────────

/**
 * Installs a hand-authored skill bundle through the same canonical-store and
 * agent-fan-out pipeline used by {@link generateSkill}.
 *
 * Unlike `generateSkill`, this entrypoint does not render any markdown — it
 * copies the directory at `sourceDir` as authored (subject to a
 * path-traversal guard against symlink escapes and a cycle guard) and
 * writes a fresh `crust.json` recording `kind: "bundle"`. Bundle authors
 * are responsible for keeping `sourceDir` clean — `crust.json` at the
 * bundle root is reserved and will throw if present in the source.
 *
 * The bundle's `SKILL.md` frontmatter is the source of truth for `name` and
 * `description`; both are required and read by Crust without rewriting the
 * file. The caller supplies `version` explicitly — typically wired to the
 * consuming package's `package.json` `version`.
 *
 * Bundles and generated skills cannot share a name unless the existing
 * install is removed first. `force: true` overwrites a conflicting install
 * (no `crust.json`, malformed `crust.json`, or kind mismatch) and also
 * rewrites a same-version bundle.
 *
 * @param options - Bundle install options (see {@link InstallSkillBundleOptions})
 * @returns Per-agent install results
 * @throws {SkillConflictError} If the canonical store exists with no
 *   `crust.json`, a malformed `crust.json`, or a different kind (and `force`
 *   is not set).
 * @throws {Error} If `SKILL.md` is missing, its frontmatter lacks `name:` or
 *   `description:`, the declared `name` is not a valid skill name, the
 *   declared `name` does not match `expectedName` when set, the source
 *   directory escapes itself via symlink, or `sourceDir` cannot be resolved.
 *
 * @example
 * ```ts
 * import { installSkillBundle } from "@crustjs/skills";
 * import pkg from "./package.json" with { type: "json" };
 *
 * await installSkillBundle({
 *   sourceDir: "skills/funnel-builder",
 *   agents: ["claude-code"],
 *   version: pkg.version,
 * });
 * ```
 */
export async function installSkillBundle(
	options: InstallSkillBundleOptions,
): Promise<InstallSkillBundleResult> {
	const {
		sourceDir,
		agents,
		version,
		scope = "global",
		clean = true,
		force = false,
		installMode = "auto",
		expectedName,
	} = options;

	const { files, frontmatter } = await loadBundleFiles(sourceDir);

	const resolvedName = resolveSkillName(frontmatter.name);
	if (!isValidSkillName(resolvedName)) {
		throw new Error(
			`Invalid skill name "${resolvedName}" in SKILL.md frontmatter: must be 1–64 lowercase ` +
				`alphanumeric characters and hyphens, no leading/trailing/consecutive hyphens.`,
		);
	}

	if (expectedName !== undefined && resolvedName !== expectedName) {
		throw new Error(
			`Bundle SKILL.md frontmatter name "${resolvedName}" does not match the expected name "${expectedName}". ` +
				`Update the bundle's SKILL.md frontmatter \`name:\` field, or change the configured \`name\` to match.`,
		);
	}

	if (agents.length === 0) {
		return { agents: [] };
	}

	const meta: SkillMeta = {
		name: resolvedName,
		description: frontmatter.description,
		version,
	};

	return installRenderedSkill({
		files: [...files],
		meta,
		agents,
		scope,
		clean,
		force,
		installMode,
		kind: "bundle",
		// Bundles do not carry the `use-*` legacy migration history, so the
		// legacy sweep is disabled by passing the same name.
		legacyResolvedName: resolvedName,
	});
}
