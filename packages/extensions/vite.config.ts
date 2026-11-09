import { defineConfig } from "vite-plus";

import { libraryTasks, pack } from "../../vite.shared.ts";

export default defineConfig({
	pack,
	run: {
		tasks: {
			...libraryTasks,
			"check:types:task": {
				...libraryTasks["check:types:task"],
				// Also check the consumer fixture under `exactOptionalPropertyTypes`.
				command: "tsc --noEmit && tsc --noEmit -p tsconfig.exact.json",
			},
		},
	},
});
