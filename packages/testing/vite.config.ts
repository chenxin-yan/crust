import { defineConfig } from "vite-plus";

import { libraryTasks, pack } from "../../vite.shared.ts";

export default defineConfig({
	pack: {
		...pack,
		entry: ["src/index.ts", "src/interactive.ts"],
	},
	run: { tasks: libraryTasks },
});
