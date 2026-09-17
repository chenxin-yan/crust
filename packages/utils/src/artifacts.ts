import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { findNearestPackageRoot } from "./source.ts";

/**
 * Set by `crust build` while it prepares the Command Snapshot: the absolute
 * directory Extension build hooks write into (`.crust/artifacts`). Core reads it
 * to run the hooks; `resolveArtifactDir` reads it so sections evaluated during
 * that run see the artifacts being built instead of the wiped `.crust/root`.
 */
export const BUILD_OUT_DIR_ENV = "CRUST_INTERNAL_BUILD_OUT_DIR";

type StandaloneGlobals = {
	Bun?: { main?: string };
	Deno?: { build?: { standalone?: boolean } };
};

/** True inside a `bun build --compile` or `deno compile` executable. */
function isCompiledExecutable(): boolean {
	// SAFETY: both globals are optional and every access below is optional-chained.
	const { Bun, Deno } = globalThis as StandaloneGlobals;
	// Bun serves the embedded entry from a virtual filesystem (`/$bunfs/` on POSIX,
	// `B:/~BUN/` on Windows); Deno flags the standalone build directly. Neither
	// leaves a real source path to walk from.
	const bunMain = Bun?.main ?? "";
	return (
		bunMain.startsWith("/$bunfs/") ||
		/^[A-Za-z]:[\\/]~BUN[\\/]/.test(bunMain) ||
		Deno?.build?.standalone === true
	);
}

/**
 * Absolute path of a build artifact or `crust.include` directory shipped with
 * this CLI. `name` is a top-level directory name such as `"skills"`.
 *
 * The path is computed from how the CLI is running — never probed:
 * - Compiled executable (Bun or Deno): `<dir of the executable>/<name>`, which
 *   is a platform package's `bin/` or wherever the binary was placed.
 * - Crust-built Node bundle: `<name>` next to the bundle's `bin/` directory,
 *   i.e. `.crust/root/<name>` in place and `<installed root>/<name>` after install.
 * - Snapshot preparation inside `crust build`: `<build output dir>/<name>`, the
 *   artifacts earlier Extension build hooks wrote in this same build.
 * - Source (`bun run`, `node`, `deno run`): `.crust/root/<name>` under the
 *   nearest package root of `process.argv[1]` — the output of the last `crust build`.
 *
 * @throws {Error} when `name` is not a single path segment, or in source mode
 *   when no `package.json` is found above `process.argv[1]`.
 */
export function resolveArtifactDir(name: string): string {
	if (name === "" || name === "." || name === ".." || /[\\/]/.test(name)) {
		throw new Error(`Artifact name must be a single directory name, got ${JSON.stringify(name)}.`);
	}

	if (isCompiledExecutable()) {
		return join(dirname(process.execPath), name);
	}

	// `crust build` defines this literal in every Bun/Node bundle it produces so a
	// staged bundle can be told apart from source. Kept as a literal property
	// access so the bundler can replace it.
	if (process.env.CRUST_INTERNAL_BUILD === "1") {
		// import.meta.url is the bundle itself (everything is inlined) and Node
		// realpaths it, unlike process.argv[1] through a node_modules/.bin symlink.
		return resolve(fileURLToPath(import.meta.url), "..", "..", name);
	}

	// `crust build` wipes `.crust` before running the entry for its snapshot, so
	// `.crust/root` cannot exist yet; the hooks' output directory is what is current.
	const buildOutDir = process.env[BUILD_OUT_DIR_ENV];
	if (buildOutDir) return join(buildOutDir, name);

	const entrypoint = process.argv[1];
	const packageRoot = entrypoint ? findNearestPackageRoot(entrypoint) : null;
	if (!packageRoot) {
		throw new Error(
			`Could not resolve artifact "${name}": no package.json was found above ` +
				`${entrypoint ? `entrypoint "${entrypoint}"` : "process.argv[1] (unset)"}.`,
		);
	}
	return join(packageRoot, ".crust", "root", name);
}
