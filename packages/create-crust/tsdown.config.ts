import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "tsdown";

import base from "../../tsdown.config.ts";

function packageVersion(specifier: string): string {
	let directory = dirname(fileURLToPath(import.meta.resolve(specifier)));
	while (true) {
		const packagePath = join(directory, "package.json");
		if (existsSync(packagePath)) {
			// SAFETY: workspace package manifests own the build-time version source.
			return (JSON.parse(readFileSync(packagePath, "utf8")) as { version: string }).version;
		}
		const parent = dirname(directory);
		if (parent === directory) throw new Error(`Could not find package.json for ${specifier}`);
		directory = parent;
	}
}

export default defineConfig({
	...base,
	// bin-only package has no type entry points for attw to validate
	attw: false,
	// bin-only package, no types published; auto-detect wrongly enables dts here
	dts: false,
	minify: true,
	define: {
		CRUST_CORE_VERSION: JSON.stringify(packageVersion("@crustjs/core")),
		CRUST_CLI_VERSION: JSON.stringify(packageVersion("@crustjs/crust/package.json")),
		CRUST_EXTENSIONS_VERSION: JSON.stringify(packageVersion("@crustjs/extensions")),
	},
});
