import { defineConfig } from "vite-plus";

import { libraryTasks, pack, testTags } from "../../vite.shared.ts";

export default defineConfig({
	test: { tags: testTags },
	pack,
	run: { tasks: libraryTasks },
});
