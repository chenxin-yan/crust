// ────────────────────────────────────────────────────────────────────────────
// Bundle install — installs a hand-authored skill directory as a Crust skill
// ────────────────────────────────────────────────────────────────────────────

import { existsSync, statSync } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
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

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

/** Filename of the entrypoint markdown file required at the bundle root. */
const SKILL_MD = "SKILL.md";

/**
 * Names excluded at the bundle root only.
 *
 * Subdirectory dotfiles **are** copied — only the immediate children of the
 * bundle root are filtered. The `crust.json` exclusion guarantees Crust never
 * copies a stale manifest; the install pipeline regenerates it.
 *
 * Note: any root entry whose name starts with `.` is also excluded by a
 * separate rule (see {@link isRootDotfile}). This list covers the explicit
 * non-dotfile cases.
 */
const ROOT_EXCLUDED_NAMES = new Set<string>([
	"node_modules",
	"crust.json",
	".DS_Store", // listed for clarity; .DS_Store is also caught by the dotfile rule
]);

/** Returns true for any root entry whose name starts with `.`. */
function isRootDotfile(name: string): boolean {
	return name.startsWith(".");
}

// ────────────────────────────────────────────────────────────────────────────
// Internal — sourceDir resolution
// (mirrors @crustjs/create's resolveTemplateDir / findNearestPackageRoot;
// see packages/create/src/scaffold.ts. Tracked as tech debt to extract into
// a shared util — TP-003 deliberately copies rather than introduces a new
// runtime dependency on @crustjs/skills.)
// ────────────────────────────────────────────────────────────────────────────

function findNearestPackageRoot(startPath: string): string | null {
	let current = resolve(startPath);

	if (existsSync(current) && !statSync(current).isDirectory()) {
		current = dirname(current);
	}

	while (true) {
		if (existsSync(join(current, "package.json"))) {
			return current;
		}

		const parent = dirname(current);
		if (parent === current) {
			return null;
		}

		current = parent;
	}
}

/**
 * Resolves an absolute filesystem path from the caller-supplied `sourceDir`.
 *
 * Three modes (mirroring `@crustjs/create`'s template resolution):
 * - `URL` — must use `file:` protocol; resolved via `fileURLToPath()`.
 * - Absolute string path — resolved via `path.resolve()`.
 * - Relative string path — resolved against the nearest `package.json`
 *   directory walking up from `process.argv[1]`.
 *
 * Throws with an actionable error if the URL is non-`file:`, if
 * `process.argv[1]` is missing, or if no `package.json` is found while
 * walking up.
 *
 * @internal Exported for unit testing.
 */
export function resolveBundleSourceDir(sourceDir: string | URL): string {
	if (sourceDir instanceof URL) {
		if (sourceDir.protocol !== "file:") {
			throw new Error(
				`Bundle URL must use file: protocol, got "${sourceDir.protocol}".`,
			);
		}
		return fileURLToPath(sourceDir);
	}

	if (isAbsolute(sourceDir)) {
		return resolve(sourceDir);
	}

	const entrypoint = process.argv[1];
	if (!entrypoint) {
		throw new Error(
			`Could not resolve relative bundle path "${sourceDir}" because process.argv[1] is not set. ` +
				`Pass an absolute path or a file: URL sourceDir.`,
		);
	}

	const packageRoot = findNearestPackageRoot(resolve(entrypoint));
	if (!packageRoot) {
		throw new Error(
			`Could not resolve relative bundle path "${sourceDir}" from entrypoint "${entrypoint}" ` +
				`because no package.json was found in its parent directories. ` +
				`Pass an absolute path or a file: URL sourceDir.`,
		);
	}

	return resolve(packageRoot, sourceDir);
}

// ────────────────────────────────────────────────────────────────────────────
// Internal — frontmatter probe
// ────────────────────────────────────────────────────────────────────────────

/**
 * Lightweight scan of a SKILL.md head for a top-level `name:` key inside the
 * leading YAML frontmatter block (between the first two `---` lines).
 *
 * Returns the first matched value, or `null` if absent (no frontmatter,
 * malformed frontmatter, or `name` not present in the first 50 lines of the
 * frontmatter block). The scan is deliberately tolerant: missing frontmatter
 * is treated as "no declared name" rather than an error.
 *
 * Strictness rules (chosen to avoid false positives from nested keys):
 * - Only **unindented** top-level lines (`/^name\s*:\s*.../`) are matched, so
 *   a nested block like `metadata:\n  name: other` is ignored.
 * - The opening fence must be `---` (after stripping a UTF-8 BOM and skipping
 *   blank lines); the closing fence is `---` with optional trailing whitespace.
 * - An unquoted value's trailing `# comment` is stripped (a quoted value keeps
 *   `#` verbatim).
 * - Quoted values (`"..."` or `'...'`) have a single matching pair of quotes
 *   stripped; everything else is taken verbatim and trimmed. Multi-line
 *   scalars, arrays, anchors, etc. are not parsed — bundle authors who
 *   declare `name` via complex YAML must keep it as a simple scalar.
 */
function probeFrontmatterName(content: string): string | null {
	// Strip a leading UTF-8 BOM so the opening fence still matches.
	const normalized = content.startsWith("\uFEFF") ? content.slice(1) : content;
	const lines = normalized.split(/\r?\n/, 51);

	// Find the opening `---` (skipping blank lines).
	let cursor = 0;
	while (cursor < lines.length && lines[cursor]?.trim() === "") cursor++;
	if (cursor >= lines.length || lines[cursor] !== "---") return null;

	cursor++; // step past the opening fence

	const limit = Math.min(50, lines.length);
	for (let i = cursor; i < limit; i++) {
		const line = lines[i];
		if (line === undefined) break;
		// Closing fence is `---` with optional trailing whitespace.
		if (/^---\s*$/.test(line)) return null;

		// Top-level only: no leading whitespace, so nested `  name:` is ignored.
		const m = line.match(/^name\s*:\s*(.*?)\s*$/);
		if (!m) continue;

		let value = m[1] ?? "";
		const quoted =
			(value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
			(value.startsWith("'") && value.endsWith("'") && value.length >= 2);
		if (quoted) {
			value = value.slice(1, -1);
		} else {
			// Strip an unquoted trailing `# comment`. YAML requires whitespace
			// before `#` for it to start a comment; treat `#` at column 0 of the
			// remainder (i.e. the value is empty) the same way.
			const commentIdx = value.search(/(^|\s)#/);
			if (commentIdx !== -1) {
				value = value.slice(0, commentIdx).trimEnd();
			}
		}
		return value;
	}

	return null;
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
 * Recursively collects file paths under `dir`, applying root-only exclusions
 * and rejecting any entry that escapes `canonicalRoot` via symlink.
 *
 * Excluded directories at the root are never recursed into. Subdirectory
 * dotfiles are included.
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
	const isRoot = relPrefix === "";
	const collected: CollectedFile[] = [];

	for (const entry of entries) {
		const name = entry.name;
		if (isRoot && (ROOT_EXCLUDED_NAMES.has(name) || isRootDotfile(name))) {
			continue;
		}

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

/**
 * Loads the contents of a hand-authored skill bundle into a {@link RenderedFile}
 * array suitable for the shared install pipeline.
 *
 * Steps:
 * 1. Resolve `sourceDir` (URL / absolute / relative-from-package-root).
 * 2. `realpath` the resolved path; reject if not a directory.
 * 3. Recursively walk, applying root-only exclusions and a per-entry
 *    path-traversal guard against the canonical root.
 * 4. Verify `SKILL.md` exists at the bundle root.
 * 5. Run a lightweight frontmatter `name:` probe; reject on mismatch with
 *    `meta.name`.
 *
 * @internal Exported for unit testing.
 */
export async function loadBundleFiles(
	sourceDir: string | URL,
	meta: SkillMeta,
): Promise<RenderedFile[]> {
	const resolved = resolveBundleSourceDir(sourceDir);

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

	// Verify SKILL.md presence at the root.
	const skillMd = collected.find((f) => f.relPath === SKILL_MD);
	if (!skillMd) {
		throw new Error(
			`Bundle is missing SKILL.md at the bundle root "${canonicalRoot}". ` +
				`Every skill bundle must contain a top-level SKILL.md file.`,
		);
	}

	// Read all files concurrently into RenderedFile records.
	const files = await Promise.all(
		collected.map(async (entry) => ({
			path: entry.relPath,
			content: await readFile(entry.absPath, "utf-8"),
		})),
	);

	// Run the lightweight frontmatter `name:` probe on SKILL.md.
	const skillContent = files.find((f) => f.path === SKILL_MD)?.content ?? "";
	const declaredName = probeFrontmatterName(skillContent);
	if (declaredName !== null && declaredName !== meta.name) {
		throw new Error(
			`Bundle SKILL.md frontmatter name "${declaredName}" does not match meta.name "${meta.name}". ` +
				`Update one of them so they agree, or remove the \`name:\` field from the frontmatter.`,
		);
	}

	return files;
}

// ────────────────────────────────────────────────────────────────────────────
// Public API — installSkillBundle
// ────────────────────────────────────────────────────────────────────────────

/**
 * Installs a hand-authored skill bundle through the same canonical-store and
 * agent-fan-out pipeline used by {@link generateSkill}.
 *
 * Unlike `generateSkill`, this entrypoint does not render any markdown — it
 * copies the directory at `sourceDir` (after applying root-only exclusions
 * and a path-traversal guard) and writes a fresh `crust.json` recording
 * `kind: "bundle"`.
 *
 * Bundles and generated skills cannot share a name unless the existing
 * install is removed first. To overwrite a kind-mismatched install, pass
 * `force: true`.
 *
 * @param options - Bundle install options (see {@link InstallSkillBundleOptions})
 * @returns Per-agent install results
 * @throws {SkillConflictError} If the canonical store exists with a different
 *   kind or with no `crust.json` (and `force` is not set).
 * @throws {Error} If `meta.name` is invalid, `SKILL.md` is missing, the
 *   frontmatter `name:` mismatches `meta.name`, the source directory escapes
 *   itself via symlink, or `sourceDir` cannot be resolved.
 *
 * @example
 * ```ts
 * import { installSkillBundle } from "@crustjs/skills";
 *
 * await installSkillBundle({
 *   meta: {
 *     name: "funnel-builder",
 *     description: "Build a sales funnel",
 *     version: "1.0.0",
 *   },
 *   sourceDir: "skills/funnel-builder",
 *   agents: ["claude-code"],
 * });
 * ```
 */
export async function installSkillBundle(
	options: InstallSkillBundleOptions,
): Promise<InstallSkillBundleResult> {
	const {
		meta,
		sourceDir,
		agents,
		scope = "global",
		clean = true,
		force = false,
		installMode = "auto",
	} = options;

	// Resolve the canonical current name — do not mutate the caller's meta object.
	const resolvedName = resolveSkillName(meta.name);
	if (!isValidSkillName(resolvedName)) {
		throw new Error(
			`Invalid skill name "${resolvedName}": must be 1–64 lowercase ` +
				`alphanumeric characters and hyphens, no leading/trailing/consecutive hyphens.`,
		);
	}

	if (agents.length === 0) {
		return { agents: [] };
	}

	const resolvedMeta: SkillMeta = { ...meta, name: resolvedName };
	const files = await loadBundleFiles(sourceDir, resolvedMeta);

	return installRenderedSkill({
		files,
		meta: resolvedMeta,
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
