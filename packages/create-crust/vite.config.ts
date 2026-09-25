import { defineConfig } from "vite-plus";

import { libraryTasks } from "../../vite.shared.ts";

// `crust build` stages this CLI; there is no library to pack.
export default defineConfig({
	run: { tasks: libraryTasks },
});
