import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, it } from "vite-plus/test";

// The default sink shares Core's stderr writer, so a spinner inside a Crust action writes in
// order with the action's own `stderr()` lines and never creates `process.stderr`.
const dist = (pkg: string) =>
	JSON.stringify(resolve(import.meta.dirname, "../..", pkg, "dist/index.js"));

describe("default spinner sink through a pipe", () => {
	it.skipIf(process.platform === "win32")(
		"writes through Core's stderr writer without materializing process.stderr (node)",
		() => {
			const { stdout, stderr, status } = spawnSync(
				"node",
				[
					"--input-type=module",
					"--eval",
					`import { writeSync } from "node:fs";
const touched = [];
const { get, enumerable } = Object.getOwnPropertyDescriptor(process, "stderr");
Object.defineProperty(process, "stderr", {
	configurable: true,
	enumerable,
	get() {
		touched.push("stderr");
		return get.call(process);
	},
});
const { Crust } = await import(${dist("core")});
const { spinner } = await import(${dist("progress")});
await new Crust("pipe-cli")
	.action(async ({ stderr }) => {
		stderr("before");
		await spinner({ message: "Working", sigint: false, task: () => {} });
		stderr("after");
	})
	.execute({ argv: [] });
writeSync(1, JSON.stringify(touched));
`,
				],
				{ encoding: "utf8", env: { ...process.env, NO_COLOR: "1" }, timeout: 5_000 },
			);
			expect(stderr).toBe("before\n✓ Working\nafter\n");
			expect(stdout).toBe("[]");
			expect(status).toBe(0);
		},
	);
});
