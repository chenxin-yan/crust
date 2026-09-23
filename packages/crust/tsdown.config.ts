import { defineConfig } from "tsdown";

import base from "../../tsdown.config.ts";

// The programmatic `build()` library. The `crust` executable itself is staged
// by `crust build` (see package.json scripts), which ships this `dist/` via
// `crust.include` and carries `exports` into the generated root package.
export default defineConfig({
	...base,
	entry: ["src/index.ts"],
	// The published root package has no dependencies (the binaries inline
	// theirs), so the library bundles the workspace packages it uses — code and
	// the declarations its public types reference (BuildReport from core).
	deps: {
		alwaysBundle: [/^@crustjs\//],
		dts: { alwaysBundle: [/^@crustjs\//] },
	},
	// This package.json is never published as-is; tests/library.integration.test.ts
	// runs publint and attw against the staged root package instead.
	publint: false,
	attw: false,
});
