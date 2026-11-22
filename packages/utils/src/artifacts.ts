import { findNearestPackageRoot } from "./source.ts";

/**
 * Set by `crust build` while it prepares the Command Snapshot: the absolute
 * entry-isolated directory Extension build hooks write into. Core reads it
 * to run the hooks; `artifactPath` reads it so sections evaluated during
 * that run see the artifacts being built instead of the wiped `.crust/root`.
 */
export const BUILD_OUT_DIR_ENV = "CRUST_INTERNAL_BUILD_OUT_DIR";

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
 * Absolute path of a file or directory shipped with this CLI. `path` starts with
 * a build artifact or `crust.include` directory name and may continue below it,
 * such as `"skills"` or `"templates/base"`.
 *
 * The shipped root is computed from how the CLI is running — never probed:
 * - Compiled executable (Bun or Node SEA): `<dir of the executable>/<path>`, which
 *   is a platform package's `bin/` or wherever the binary was placed.
 * - Crust-built Bun/Node bundle: `<path>` next to the bundle's `bin/` directory,
 *   i.e. `.crust/root/<path>` in place and `<installed root>/<path>` after install.
 *   Build-only environment is ignored.
 * - Snapshot preparation inside `crust build`: `<build output dir>/<path>`, the
 *   artifacts earlier Extension build hooks wrote in this same build.
 * - Source (`bun run`, `node`): `.crust/root/<path>` under the
 *   nearest package root of the real `process.argv[1]` entrypoint (following source
 *   links) — the output of the last `crust build`.
 *
 * @throws {Error} when `path` is absolute or has an empty, `.` or `..` segment, or in
 *   source mode when the entrypoint cannot be resolved or has no enclosing `package.json`.
 */
export function artifactPath(path: string): string {
	const segments = path.split(/[\\/]/);
	// Every segment must name something, which also rejects absolute paths and escapes.
	if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
		throw new Error(
			`Artifact path must be names separated by "/", such as "templates/base", got ${JSON.stringify(path)}.`,
		);
	}

	const { dirname, join, resolve } = process.getBuiltinModule("node:path");
	if (isCompiledExecutable()) {
		return join(dirname(process.execPath), ...segments);
	}

	if (isCrustBundle()) {
		// import.meta.url is the bundle itself (everything is inlined) and Node
		// realpaths it, unlike process.argv[1] through a node_modules/.bin symlink.
		return resolve(
			process.getBuiltinModule("node:url").fileURLToPath(import.meta.url),
			"..",
			"..",
			...segments,
		);
	}

	// `crust build` wipes `.crust` before running the entry for its snapshot, so
	// `.crust/root` cannot exist yet; the hooks' output directory is what is current.
	const buildOutDir = process.env[BUILD_OUT_DIR_ENV];
	if (buildOutDir) return join(buildOutDir, ...segments);

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
	return join(packageRoot, ".crust", "root", ...segments);
}
