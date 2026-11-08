import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

import { which } from "@crustjs/utils/process";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { ensureDist } from "./helpers.ts";

// Real signals end the process on their default action, so they are sent inside a child.
const corePkg = resolve(import.meta.dirname, "..");
const runtimes = [which("bun")!, ...(which("node") ? ["node"] : [])];

beforeAll(ensureDist);

// The action sends SIGNAL to itself, and again SECOND_AFTER ms after the abort when set.
const PROBE = `import { Crust } from ${JSON.stringify(join(corePkg, "dist/index.js"))};
const { SIGNAL, SECOND_AFTER } = process.env;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const exitCode = await new Crust("app")
	.action(async ({ signal }) => {
		// Signal listeners don't keep Node's event loop alive.
		const keepAlive = setInterval(() => {}, 1_000);
		try {
			await new Promise((resolve) => {
				signal.addEventListener("abort", resolve, { once: true });
				process.kill(process.pid, SIGNAL);
			});
			if (SECOND_AFTER) {
				await sleep(Number(SECOND_AFTER));
				process.kill(process.pid, SIGNAL);
			}
			// Leaves a re-raised signal time to end the process.
			await sleep(100);
			signal.throwIfAborted();
		} finally {
			clearInterval(keepAlive);
			console.log("released");
		}
	})
	.execute({ argv: [] });
console.log(\`exit \${exitCode}, listeners \${process.listenerCount("SIGINT")} \${process.listenerCount("SIGTERM")}\`);
`;

function probe(runtime: string, env: { SIGNAL: string; SECOND_AFTER?: string }) {
	return spawnSync(runtime, ["--input-type=module", "--eval", PROBE], {
		encoding: "utf8",
		env: { ...process.env, ...env },
		timeout: 10_000,
	});
}

describe.each(runtimes)("execute() termination signals (%s)", (runtime) => {
	it("cancels on SIGTERM, runs cleanup, exits 143 and removes its listeners", () => {
		expect(probe(runtime, { SIGNAL: "SIGTERM" })).toMatchObject({
			status: 143,
			stdout: "released\nexit 143, listeners 0 0\n",
		});
	});

	it("keeps exit code 130 for SIGINT", () => {
		expect(probe(runtime, { SIGNAL: "SIGINT" })).toMatchObject({
			status: 130,
			stdout: "released\nexit 130, listeners 0 0\n",
		});
	});

	it("treats a SIGTERM within 50 ms of the first as the same one", () => {
		expect(probe(runtime, { SIGNAL: "SIGTERM", SECOND_AFTER: "0" })).toMatchObject({
			status: 143,
			stdout: "released\nexit 143, listeners 0 0\n",
		});
	});

	it("lets a second SIGTERM after the window terminate the process", () => {
		expect(probe(runtime, { SIGNAL: "SIGTERM", SECOND_AFTER: "200" })).toMatchObject({
			status: null,
			signal: "SIGTERM",
			stdout: "",
		});
	});
});
