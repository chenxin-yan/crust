import { defineConfig } from "vite-plus";

import { testTags, toolingTasks } from "../vite.shared.ts";

export default defineConfig({
	test: { tags: testTags },
	run: { tasks: toolingTasks },
});
