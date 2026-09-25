import { defineConfig } from "vite-plus";

import { libraryTasks, pack } from "../../vite.shared.ts";

export default defineConfig({
	pack: {
		...pack,
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
	},
	run: { tasks: libraryTasks },
});
