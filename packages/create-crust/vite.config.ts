import { configDefaults, defineConfig } from "vite-plus";

import { libraryTasks, testTags } from "../../vite.shared.ts";

// `crust build` stages this CLI; there is no library to pack.
export default defineConfig({
	// templates/base/src/app.test.ts (and its staged copy) is the scaffolded project's test.
	test: { tags: testTags, exclude: [...configDefaults.exclude, "templates/**", ".crust/**"] },
	run: {
		tasks: {
			...libraryTasks,
			"build:task": { ...libraryTasks["build:task"], command: "crust build" },
		},
	},
});
