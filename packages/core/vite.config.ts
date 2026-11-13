import { defineConfig } from "vite-plus";

import { libraryTasks, pack, testTags } from "../../vite.shared.ts";

export default defineConfig({
	test: { tags: testTags },
	pack: {
		...pack,
		entry: ["src/index.ts", "src/tooling.ts"],
	},
	run: { tasks: libraryTasks },
});
