import { defineConfig } from "tsdown";

import base from "../../tsdown.config.ts";

export default defineConfig({
	...base,
	entry: [
		"src/artifacts.ts",
		"src/error.ts",
		"src/json.ts",
		"src/path.ts",
		"src/primitive.ts",
		"src/process.ts",
		"src/source.ts",
		"src/schema.ts",
		"src/terminal.ts",
	],
});
