import { defineConfig } from "vite-plus";

import { toolingTasks } from "../vite.shared.ts";

export default defineConfig({
	run: { tasks: toolingTasks },
});
