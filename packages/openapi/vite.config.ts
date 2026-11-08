import { defineConfig } from "vite-plus";

import { libraryTasks, pack } from "../../vite.shared.ts";

export default defineConfig({
	pack,
	run: { tasks: libraryTasks },
});
