import { defineConfig } from "vite-plus";

import { libraryTasks, pack, testTags } from "../../vite.shared.ts";

export default defineConfig({
	test: { tags: testTags },
	pack: {
		...pack,
		entry: [
			"src/artifacts.ts",
			"src/error.ts",
			"src/json.ts",
			"src/package-manager.ts",
			"src/path.ts",
			"src/primitive.ts",
			"src/process.ts",
			"src/source.ts",
			"src/schema.ts",
			"src/signals.ts",
			"src/terminal.ts",
		],
	},
	run: { tasks: libraryTasks },
});
