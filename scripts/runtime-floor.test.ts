/**
 * @module-tag mise
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { expect, it } from "vite-plus/test";

import { floorRuntime } from "../packages/crust/tests/helpers.ts";

// Every package's build loads and works on the oldest Node and Bun that `engines` promises.
it.each(["node", "bun"] as const)(
	"the built packages run on the oldest supported %s",
	(runtime) => {
		const script = join(import.meta.dirname, "smoke-runtimes", "smoke.mjs");
		const run = spawnSync(floorRuntime(runtime), [script], { encoding: "utf8", timeout: 120_000 });
		expect(run.status, run.stderr).toBe(0);
	},
	300_000,
);
