import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { which } from "@crustjs/utils/process";
import { describe, expect, it } from "vite-plus/test";

// Promise.race only stops the wait for `send`; the process still lives until its work ends.
// These runs prove the 1 s deadline reaches that work through `send`'s signal, after a
// completed command and after Ctrl-C, where Core re-raises the signal once the event loop drains.

const fixture = resolve(import.meta.dirname, "telemetry-send-fixture.ts");
const runtimes = [
	["bun", which("bun")!],
	["node", process.execPath],
] as const;

interface Exit {
	readonly code: number | null;
	readonly signal: NodeJS.Signals | null;
	readonly stderr: string;
	/** Milliseconds from the start, or from the SIGINT when one was sent, to the exit. */
	readonly ms: number;
}

function runFixture(runtime: string, interrupt: boolean): Promise<Exit> {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(runtime, [fixture], {
			env: {
				...process.env,
				CI: undefined,
				DO_NOT_TRACK: undefined,
				ACME_TELEMETRY: undefined,
				FIXTURE_WAIT: interrupt ? "1" : undefined,
			},
			timeout: 20_000,
		});
		let from = performance.now();
		let stderr = "";
		child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
		child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
			if (interrupt && chunk.includes("ready")) {
				from = performance.now();
				child.kill("SIGINT");
			}
		});
		child.on("error", reject);
		child.on("close", (code, signal) =>
			resolvePromise({ code, signal, stderr, ms: performance.now() - from }),
		);
	});
}

describe.each(runtimes)("telemetry send under %s", (_name, runtime) => {
	it("aborts send's signal at 1 s, so the process exits after a completed command", async () => {
		const exit = await runFixture(runtime, false);
		expect(exit.stderr).toBe("send aborted: TimeoutError\n");
		expect(exit.code).toBe(0);
		expect(exit.ms).toBeLessThan(4_000);
	}, 30_000);

	it("aborts send's signal at 1 s after Ctrl-C, so the signal exit is not held", async () => {
		const exit = await runFixture(runtime, true);
		expect(exit.stderr).toContain("send aborted: TimeoutError\n");
		expect(exit.signal).toBe("SIGINT");
		expect(exit.ms).toBeGreaterThanOrEqual(900);
		expect(exit.ms).toBeLessThan(3_000);
	}, 30_000);
});
