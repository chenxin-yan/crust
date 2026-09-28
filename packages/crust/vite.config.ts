import { defineConfig } from "vite-plus";

import { libraryTasks, pack, runtimeInput, upstreamBuild } from "../../vite.shared.ts";

// The programmatic `build()` library. The `crust` executable itself is staged
// by `crust build` (`build:task` below), which ships this `dist/` via
// `crust.include` and carries `exports` into the generated root package;
// scripts/stage-node-exe-dependencies.ts then adds the Node binary backend.
export default defineConfig({
	pack: {
		...pack,
		entry: ["src/index.ts"],
		// The published packages only optionally depend on the Node binary backend
		// (tsdown, resolved at build time, never imported); the binaries inline
		// everything else, so the library bundles the workspace packages' code.
		// Declarations stay external: bundling core's `unique symbol` brands would
		// mint a second `ExtensionId`, making the re-exported `BuildReport`
		// incompatible with `@crustjs/core`'s. package.json declares core as the
		// peer that resolves those types.
		deps: {
			alwaysBundle: [/^@crustjs\//],
			// An empty list, not omitted: tsdown falls back to the JS list otherwise.
			dts: { alwaysBundle: [] },
		},
		// This package.json is never published as-is; tests/library.integration.test.ts
		// runs publint and attw against the staged root package instead.
		publint: false,
		attw: false,
	},
	// Two cached stages: each restores only its own output, and staging
	// fingerprints `dist/`, so a library-only change re-stages `.crust/`.
	run: {
		tasks: {
			...libraryTasks,
			"pack:task": {
				...libraryTasks["build:task"],
				cache: { ...libraryTasks["build:task"].cache, output: ["dist/**"] },
			},
			"build:task": {
				command: "bun src/cli.ts build && bun scripts/stage-node-exe-dependencies.ts",
				dependsOn: ["pack:task", upstreamBuild],
				cache: {
					env: ["CI"],
					input: [...runtimeInput, "dist/**", "!.crust/**"],
					output: [".crust/**"],
				},
			},
		},
	},
});
