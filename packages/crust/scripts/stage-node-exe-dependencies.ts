// Crust's own packaging step after `crust build` stages crust (build:task).
// `crust build` never carries a project's dependencies, but the compiled crust
// runs tsdown from its own installation, so the staged packages must declare
// it. Every platform package declares it too: that is where the compiled crust
// runs, and pnpm resolves a package's imports only from its own dependencies.
// They are optional: package managers then skip them, instead of failing the
// whole install, under a Node outside tsdown's engines, and only Node binary
// builds need them (they report a missing backend before staging).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import crustPackage from "../package.json" with { type: "json" };
import { NODE_EXE_BACKEND_PACKAGES } from "../src/utils/build-helpers.ts";
import type { DistributionManifest } from "../src/utils/distribute.ts";

/**
 * Adds the backend packages, with their ranges from `optionalDependencies`, to
 * the `optionalDependencies` of every staged package.json, keeping the root's
 * platform packages.
 */
export function stageNodeExeDependencies(stageDir: string): void {
	const backend = Object.fromEntries(
		NODE_EXE_BACKEND_PACKAGES.map((name) => {
			const range = crustPackage.optionalDependencies[name];
			if (range === undefined)
				throw new Error(`packages/crust/package.json must optionally depend on ${name}.`);
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
			`${JSON.stringify(
				{
					...packageJson,
					optionalDependencies: { ...packageJson.optionalDependencies, ...backend },
				},
				null,
				"\t",
			)}\n`,
		);
	}
}

if (import.meta.main) stageNodeExeDependencies(join(import.meta.dirname, "..", ".crust"));
