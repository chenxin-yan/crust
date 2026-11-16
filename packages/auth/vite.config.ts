import { defineConfig } from "vite-plus";

import { libraryTasks, pack, testTags } from "../../vite.shared.ts";

export default defineConfig({
	// A test that asserts nothing must not pass.
	test: { tags: testTags, expect: { requireAssertions: true } },
	pack: { ...pack, entry: ["src/index.ts", "src/oauth.ts"] },
	run: { tasks: libraryTasks },
});
