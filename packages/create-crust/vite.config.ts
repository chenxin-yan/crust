import { defineConfig } from "vite-plus";

import { libraryTasks, testTags } from "../../vite.shared.ts";

// `crust build` stages this CLI; there is no library to pack.
export default defineConfig({
	test: { tags: testTags },
	run: {
		tasks: {
			...libraryTasks,
			"build:task": { ...libraryTasks["build:task"], command: "crust build" },
		},
	},
});
