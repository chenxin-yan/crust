import { findNearestPackageRoot } from "./source.ts";

/**
 * Set by `crust build` while it prepares the Command Snapshot: the absolute
 * entry-isolated directory Extension build hooks write into. Core reads it
 * to run the hooks; `artifactPath` reads it so sections evaluated during
 * that run see the artifacts being built instead of the previous `.crust/root`.
 */
export const BUILD_OUT_DIR_ENV = "CRUST_INTERNAL_BUILD_OUT_DIR";

/**
 * Set by the npm launcher of a binary release to `[<binary it starts>, <its root package>]`
 * as JSON, so that binary reads its artifacts from the root package. A path it records, such
 * as a skill link, is then the same on every platform.
 */
export const LAUNCHER_ENV = "CRUST_INTERNAL_LAUNCHER";

type StandaloneGlobals = {
	Bun?: { main?: string };
};

type SeaProcess = {
	getBuiltinModule?: (id: "node:sea") => { isSea(): boolean } | undefined;
};

/**
 * True inside a `bun build --compile` executable or a Node single executable
 * application.
 */
export function isCompiledExecutable(): boolean {
	// SAFETY: the global is optional and every access below is optional-chained.
	const { Bun } = globalThis as StandaloneGlobals;
	// Bun serves the embedded entry from a virtual filesystem (`/$bunfs/` on POSIX,
	// `B:/~BUN/` on Windows), which leaves no real source path to walk from.
	const bunMain = Bun?.main ?? "";
	return (
		bunMain.startsWith("/$bunfs/") ||
		/^[A-Za-z]:[\\/]~BUN[\\/]/.test(bunMain) ||
		// A static `node:sea` import would fail to load on Bun. A SEA's
		// `import.meta.url` is the executable (or undefined after GC), never the
		// bundle layout below.
		// SAFETY: Node added getBuiltinModule in 22.3 and Bun returns undefined
		// for `node:sea`; both are optional-chained.
		(process as SeaProcess).getBuiltinModule?.("node:sea")?.isSea() === true
	);
}

/**
 * True inside a Bun/Node bundle produced by `crust build`. `crust build` defines
 * `process.env.CRUST_INTERNAL_BUILD` as a literal in every Bun/Node bundle so a staged
 * bundle can be told apart from source; it is kept as a literal property access so the
 * bundler can replace it.
 */
function isCrustBundle(): boolean {
	return process.env.CRUST_INTERNAL_BUILD === "1";
}

/**
 * True when the CLI runs from source (`bun run`, `node`), including the entry
 * `crust build` runs to prepare its snapshot: neither a compiled executable nor a Crust-built
 * bundle. Artifacts then come from a checkout's last build, not from an installed CLI.
 */
export function isSourceRun(): boolean {
	return !isCompiledExecutable() && !isCrustBundle();
}

/**
 * The root package whose launcher started this executable. The variable is inherited by
 * every program this one starts, so it counts only when it names this executable.
 */
function launcherRoot(): string | undefined {
	const value = process.env[LAUNCHER_ENV];
	if (!value) return undefined;
	try {
		const [binary, root] = JSON.parse(value) as unknown[];
		// A launcher writes an absolute root; any other would follow the working directory.
		const { isAbsolute } = process.getBuiltinModule("node:path");
		if (typeof binary !== "string" || typeof root !== "string" || !isAbsolute(root)) {
			return undefined;
		}
		// Real paths: a package manager may link the platform package into place.
		const { realpathSync } = process.getBuiltinModule("node:fs");
		return realpathSync.native(binary) === realpathSync.native(process.execPath) ? root : undefined;
	} catch {
		// Not JSON, or a binary that is gone: not this executable's launcher.
		return undefined;
	}
}

/**
 * Absolute path of a file or directory shipped with this CLI. `path` starts with
 * a build artifact or `crust.include` directory name and may continue below it,
 * such as `"skills"` or `"templates/base"`.
 *
 * The shipped root is computed from how the CLI is running — never probed:
 * - Compiled executable (Bun or Node SEA) started by its npm launcher: `<path>` in the
 *   launcher's root package, which {@link LAUNCHER_ENV} names.
 * - Compiled executable started on its own: `<dir of the executable>/<path>`, which is a
 *   release archive's folder or wherever the binary was placed.
 * - Crust-built Bun/Node bundle: `<path>` next to the bundle's `bin/` directory,
 *   i.e. `.crust/root/<path>` in place and `<installed root>/<path>` after install.
 *   Build-only environment is ignored.
 * - Source (`bun run`, `node`), from the nearest package root of the real
 *   `process.argv[1]` entrypoint (following source links): a path under one of
 *   that `package.json`'s `crust.include` folders is that folder in the project.
 *   Any other path is `<build output dir>/<path>` during snapshot preparation
 *   inside `crust build` (what earlier Extension build hooks wrote in this same
 *   build), and otherwise `.crust/root/<path>`, the output of the last `crust build`.
 *
 * @throws {Error} when `path` is absolute, or has an empty, `.` or `..` segment or one
 *   starting with a drive such as `D:`, or in source mode when the entrypoint cannot be resolved or has no
 *   enclosing `package.json`.
 */
export function artifactPath(path: string): string {
	const segments = path.split(/[\\/]/);
	// Every segment must name something, which also rejects absolute paths and escapes.
	// A Windows drive (`D:`, `D:file`) would replace the shipped root.
	const invalid = (segment: string) =>
		segment === "" || segment === "." || segment === ".." || /^[A-Za-z]:/.test(segment);
	if (segments.some(invalid)) {
		throw new Error(
			`Artifact path must be names separated by "/", such as "templates/base", got ${JSON.stringify(path)}.`,
		);
	}

	const { dirname, join, relative, resolve, sep } = process.getBuiltinModule("node:path");
	if (isCompiledExecutable()) {
		return join(launcherRoot() ?? dirname(process.execPath), ...segments);
	}

	if (isCrustBundle()) {
		// import.meta.url is the bundle or one of its chunks, all in `bin/`, and Node
		// realpaths it, unlike process.argv[1] through a node_modules/.bin symlink.
		return resolve(
			process.getBuiltinModule("node:url").fileURLToPath(import.meta.url),
			"..",
			"..",
			...segments,
		);
	}

	const entrypoint = process.argv[1];
	let sourceEntrypoint = entrypoint;
	if (entrypoint) {
		try {
			// Node keeps a source npm-link's consumer-side .bin path in argv[1].
			sourceEntrypoint = process.getBuiltinModule("node:fs").realpathSync(entrypoint);
		} catch (cause) {
			throw new Error(
				`Could not resolve artifact "${path}": could not resolve source entrypoint "${entrypoint}".`,
				{ cause },
			);
		}
	}
	const packageRoot = sourceEntrypoint ? findNearestPackageRoot(sourceEntrypoint) : null;
	if (!packageRoot) {
		throw new Error(
			`Could not resolve artifact "${path}": no package.json was found above ` +
				`${entrypoint ? `entrypoint "${entrypoint}"` : "process.argv[1] (unset)"}.`,
		);
	}
	// A crust.include folder is read where it is edited, so it is current before any build.
	const { crust } = JSON.parse(
		process.getBuiltinModule("node:fs").readFileSync(join(packageRoot, "package.json"), "utf8"),
	) as { crust?: { include?: unknown } };
	const include = Array.isArray(crust?.include) ? crust.include : [];
	const included = include.some((entry) => {
		if (typeof entry !== "string") return false;
		// Normalized as `crust build` stages it; a folder outside the project starts with `..`.
		const name = relative(packageRoot, resolve(packageRoot, entry));
		return name !== "" && name.split(sep).every((part, index) => part === segments[index]);
	});
	if (included) return join(packageRoot, ...segments);

	// The hooks write a build's artifacts there while `crust build` prepares the snapshot.
	const buildOutDir = process.env[BUILD_OUT_DIR_ENV];
	if (buildOutDir) return join(buildOutDir, ...segments);
	return join(packageRoot, ".crust", "root", ...segments);
}
