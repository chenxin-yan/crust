import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

// Real sockets and real timers on each runtime, in a subprocess with a hard deadline.
const script = join(import.meta.dirname, "fixtures", "flows.ts");

describe.each(["node", "bun"])("on %s", (runtime) => {
	it("SEC-C4 SEC-C14 SEC-C15 SEC-E6 SEC-D1 runs the browser and device logins over real sockets", () => {
		const run = spawnSync(runtime, [script], { encoding: "utf8", timeout: 60_000 });
		expect(run.error).toBeUndefined();
		expect(run.stderr).toBe("");
		expect(run.status).toBe(0);
		const report = JSON.parse(run.stdout);
		expect(report.loopback).toEqual({
			status: 200,
			connection: "close",
			referrerPolicy: "no-referrer",
			accessToken: "BROWSER_AT",
			closed: true,
		});
		expect(report.close).toEqual({
			timeout: { code: "timeout" },
			timeoutClosed: true,
			abort: { code: "abort" },
			abortClosed: true,
			keepAliveDestroyed: true,
		});
		expect(report.idle.closed).toBe(true);
		expect(report.idle.ms).toBeLessThan(5_000);
		expect(report.redirect).toEqual({
			moved: { code: "http", status: 307 },
			refresh: { code: "http", status: 307 },
			offsiteRequests: 0,
		});
		expect(report.device).toEqual({ userCode: "ABCD-EFGH", accessToken: "DEVICE_AT", polls: 3 });
	}, 90_000);
});
