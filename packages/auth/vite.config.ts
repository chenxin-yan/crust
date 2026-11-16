import { defineConfig } from "vite-plus";

import { libraryTasks, pack, testTags, upstreamBuild } from "../../vite.shared.ts";

export default defineConfig({
	// Every test must assert, so a security test that runs no expect() never counts as passed.
	test: { tags: testTags, expect: { requireAssertions: true } },
	pack,
	run: {
		tasks: {
			...libraryTasks,
			// The executed-results gate: every security id the manifest requires has a passed test.
			"check:security:task": {
				command:
					"vp test run --reporter=json --outputFile=node_modules/.security/report.json && node tests/check-security.ts node_modules/.security/report.json",
				dependsOn: [upstreamBuild],
				cache: false,
			},
		},
	},
});
