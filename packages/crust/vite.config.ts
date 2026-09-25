import { defineConfig } from "vite-plus";

import { libraryTasks, pack } from "../../vite.shared.ts";

// The programmatic `build()` library. The `crust` executable itself is staged
// by `crust build` (see package.json scripts), which ships this `dist/` via
// `crust.include` and carries `exports` into the generated root package.
export default defineConfig({
	pack: {
		...pack,
		entry: ["src/index.ts"],
		// The published root package has no runtime dependencies (the binaries
		// inline theirs), so the library bundles the workspace packages' code.
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
	run: { tasks: libraryTasks },
});
