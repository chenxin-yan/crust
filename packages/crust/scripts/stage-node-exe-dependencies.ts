// Crust's own packaging step after `crust build` stages crust (build:task).
// `crust build` never carries a project's dependencies, but the compiled crust
// runs tsdown from its own installation, so the staged packages must declare
// it. Every platform package declares it too: that is where the compiled crust
// runs, and pnpm resolves a package's imports only from its own dependencies.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import crustPackage from "../package.json" with { type: "json" };
import { NODE_EXE_BACKEND_PACKAGES } from "../src/utils/build-helpers.ts";
import type { DistributionManifest } from "../src/utils/distribute.ts";

/** Adds the backend packages, with their ranges from `dependencies`, to every staged package.json. */
export function stageNodeExeDependencies(
	stageDir: string,
	dependencies: Record<string, string> = crustPackage.dependencies,
): void {
	const backend = Object.fromEntries(
		NODE_EXE_BACKEND_PACKAGES.map((name) => {
			const range = dependencies[name];
			if (range === undefined)
				throw new Error(`packages/crust/package.json must depend on ${name}.`);
			return [name, range];
		}),
	);
	// SAFETY: `crust build` wrote this manifest; publish validation re-checks it.
	const manifest = JSON.parse(
		readFileSync(join(stageDir, "manifest.json"), "utf8"),
	) as DistributionManifest;
	for (const dir of [manifest.root.dir, ...manifest.packages.map((pkg) => pkg.dir)]) {
		const path = join(stageDir, dir, "package.json");
		const packageJson = JSON.parse(readFileSync(path, "utf8"));
		writeFileSync(
			path,
			`${JSON.stringify({ ...packageJson, dependencies: backend }, null, "\t")}\n`,
		);
	}
}

if (import.meta.main) stageNodeExeDependencies(join(import.meta.dirname, "..", ".crust"));
