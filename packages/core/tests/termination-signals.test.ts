import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

import { which } from "@crustjs/utils/process";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { ensureDist } from "./helpers.ts";

// Real signals end the process on their default action, so they are sent inside a child.
const corePkg = resolve(import.meta.dirname, "..");
const runtimes = [which("bun")!, ...(which("node") ? ["node"] : [])];

beforeAll(ensureDist);

// The action sends SIGNAL to itself, and again SECOND_AFTER ms after the abort when set; a
// comma-separated SIGNAL runs execute() once per signal. IGNORE completes the action despite the
// abort; GUARD adds another listener that owns the signal; BUSY receives the signal during
// synchronous work and returns before the event loop can handle it. After execute(), async work
// runs before the report line, then AFTER=exit calls process.exit(code) and AFTER=zero sets
// process.exitCode = 0.
const PROBE = `import { Crust } from ${JSON.stringify(join(corePkg, "dist/index.js"))};
const { SIGNAL: SIGNALS, SECOND_AFTER, IGNORE, GUARD, BUSY, AFTER } = process.env;
if (GUARD) process.on(SIGNALS, () => {});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let exitCode;
for (const SIGNAL of SIGNALS.split(",")) exitCode = await new Crust("app")
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
await sleep(20);
console.log(\`exit \${exitCode}, listeners \${process.listenerCount("SIGINT")} \${process.listenerCount("SIGTERM")} \${process.listenerCount("beforeExit")}\`);
if (AFTER === "exit") process.exit(exitCode);
if (AFTER === "zero") process.exitCode = 0;
`;

function probe(
	runtime: string,
	env: {
		SIGNAL: string;
		SECOND_AFTER?: string;
		IGNORE?: string;
		GUARD?: string;
		BUSY?: string;
		AFTER?: string;
	},
) {
	return spawnSync(runtime, ["--input-type=module", "--eval", PROBE], {
		encoding: "utf8",
		env: { ...process.env, ...env },
		timeout: 10_000,
	});
}

describe.each(runtimes)("execute() termination signals (%s)", (runtime) => {
	// Shells and supervisors read death by the signal (WIFSIGNALED), not a 130/143 exit status.
	// The re-raise waits for the event loop to drain, so code after execute() still runs.
	it.each([
		["SIGTERM", "", 143],
		["SIGINT", "", 130],
		["SIGTERM", "1", 143],
		["SIGINT", "1", 130],
	])(
		"cancels on %s, runs cleanup and the caller's code, then dies by it (IGNORE=%j)",
		(SIGNAL, IGNORE, code) => {
			expect(probe(runtime, { SIGNAL, IGNORE })).toMatchObject({
				status: null,
				signal: SIGNAL,
				stdout: `released\nexit ${code}, listeners 0 0 1\n`,
			});
		},
	);

	it("treats a SIGTERM within 50 ms of the first as the same one", () => {
		expect(probe(runtime, { SIGNAL: "SIGTERM", SECOND_AFTER: "0" })).toMatchObject({
			status: null,
			signal: "SIGTERM",
			stdout: "released\nexit 143, listeners 0 0 1\n",
		});
	});

	it("dies by a SIGTERM that arrived while synchronous work blocked the event loop", () => {
		expect(probe(runtime, { SIGNAL: "SIGTERM", BUSY: "1" })).toMatchObject({
			status: null,
			signal: "SIGTERM",
			stdout: "released\nexit 143, listeners 0 0 1\n",
		});
	});

	it("dies once, by the signal of the latest cancelled execute()", () => {
		expect(probe(runtime, { SIGNAL: "SIGINT,SIGTERM" })).toMatchObject({
			status: null,
			signal: "SIGTERM",
			stdout: "released\nreleased\nexit 143, listeners 0 0 1\n",
		});
	});

	it.each([
		["exit", "process.exit(code)", 143],
		["zero", "process.exitCode = 0", 0],
	])("keeps the caller's AFTER=%s (%s) instead of re-raising", (AFTER, _, status) => {
		expect(probe(runtime, { SIGNAL: "SIGTERM", AFTER })).toMatchObject({
			status,
			signal: null,
			stdout: "released\nexit 143, listeners 0 0 1\n",
		});
	});

	it("exits 143 and leaves the signal to a listener that still owns it", () => {
		expect(probe(runtime, { SIGNAL: "SIGTERM", IGNORE: "1", GUARD: "1" })).toMatchObject({
			status: 143,
			stdout: "released\nexit 143, listeners 0 1 1\n",
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
