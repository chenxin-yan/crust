import { defineConfig } from "tsdown";

import base from "../../tsdown.config.ts";
import corePackage from "../core/package.json" with { type: "json" };
import crustPackage from "../crust/package.json" with { type: "json" };
import extensionsPackage from "../extensions/package.json" with { type: "json" };

export default defineConfig({
	...base,
	// bin-only package has no type entry points for attw to validate
	attw: false,
	// bin-only package, no types published; auto-detect wrongly enables dts here
	dts: false,
	minify: true,
	define: {
		CRUST_CORE_VERSION: JSON.stringify(corePackage.version),
		CRUST_CLI_VERSION: JSON.stringify(crustPackage.version),
		CRUST_EXTENSIONS_VERSION: JSON.stringify(extensionsPackage.version),
	},
});
