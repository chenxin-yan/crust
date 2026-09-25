import { defineConfig } from "vite-plus";

import { toolingTasks } from "../vite.shared.ts";

export default defineConfig({
	test: { setupFiles: ["./oxlint/anti-slop/rule-tester.setup.ts"] },
	run: { tasks: toolingTasks },
});
