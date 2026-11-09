import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

import { which } from "@crustjs/utils/process";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { ensureDist } from "./helpers.ts";

// Real signals end the process on their default action, so they are sent inside a child.
const corePkg = resolve(import.meta.dirname, "..");
const runtimes = [which("bun")!, ...(which("node") ? ["node"] : [])];

beforeAll(ensureDist);

// The action sends SIGNAL to itself, and again SECOND_AFTER ms after the abort when set. IGNORE
// completes the action despite the abort; GUARD adds another listener that owns the signal; BUSY
// receives the signal during synchronous work and returns before the event loop can handle it.
const PROBE = `import { Crust } from ${JSON.stringify(join(corePkg, "dist/index.js"))};
const { SIGNAL, SECOND_AFTER, IGNORE, GUARD, BUSY } = process.env;
if (GUARD) process.on(SIGNAL, () => {});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const exitCode = await new Crust("app")
	.action(async ({ signal }) => {
		// Signal listeners don't keep Node's event loop alive.
		const keepAlive = setInterval(() => {}, 1_000);
		try {
			if (BUSY) {
				process.kill(process.pid, SIGNAL);
				const end = Date.now() + 100;
				while (Date.now() < end) {}
				return;
			}
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
			if (!IGNORE) signal.throwIfAborted();
		} finally {
			clearInterval(keepAlive);
			console.log("released");
		}
	})
	.execute({ argv: [] });
console.log(\`exit \${exitCode}, listeners \${process.listenerCount("SIGINT")} \${process.listenerCount("SIGTERM")}\`);
`;

function probe(
	runtime: string,
	env: { SIGNAL: string; SECOND_AFTER?: string; IGNORE?: string; GUARD?: string; BUSY?: string },
) {
	return spawnSync(runtime, ["--input-type=module", "--eval", PROBE], {
		encoding: "utf8",
		env: { ...process.env, ...env },
		timeout: 10_000,
	});
}

describe.each(runtimes)("execute() termination signals (%s)", (runtime) => {
	// Shells and supervisors read death by the signal (WIFSIGNALED), not a 130/143 exit status.
	it.each([
		["SIGTERM", ""],
		["SIGINT", ""],
		["SIGTERM", "1"],
		["SIGINT", "1"],
	])("cancels on %s, runs cleanup, and dies by it (IGNORE=%j)", (SIGNAL, IGNORE) => {
		expect(probe(runtime, { SIGNAL, IGNORE })).toMatchObject({
			status: null,
			signal: SIGNAL,
			stdout: "released\n",
		});
	});

	it("treats a SIGTERM within 50 ms of the first as the same one", () => {
		expect(probe(runtime, { SIGNAL: "SIGTERM", SECOND_AFTER: "0" })).toMatchObject({
			status: null,
			signal: "SIGTERM",
			stdout: "released\n",
		});
	});

	it("dies by a SIGTERM that arrived while synchronous work blocked the event loop", () => {
		expect(probe(runtime, { SIGNAL: "SIGTERM", BUSY: "1" })).toMatchObject({
			status: null,
			signal: "SIGTERM",
			stdout: "released\n",
		});
	});

	it("exits 143 and leaves the signal to a listener that still owns it", () => {
		expect(probe(runtime, { SIGNAL: "SIGTERM", IGNORE: "1", GUARD: "1" })).toMatchObject({
			status: 143,
			stdout: "released\nexit 143, listeners 0 1\n",
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
