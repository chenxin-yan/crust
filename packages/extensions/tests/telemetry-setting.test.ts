import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { which } from "@crustjs/utils/process";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

// The saved setting outlives the process that saved it: `disable` in one run stops events in the next.

const fixture = resolve(import.meta.dirname, "telemetry-setting-fixture.ts");
const runtimes = [
	["bun", which("bun")!],
	["node", process.execPath],
] as const;

interface Run {
	readonly code: number | null;
	readonly stdout: string;
	readonly stderr: string;
}

describe.each(runtimes)("telemetry's saved setting under %s", (_name, runtime) => {
	let configHome: string;
	beforeEach(() => {
		configHome = mkdtempSync(join(tmpdir(), "crust-telemetry-setting-"));
	});
	afterEach(() => rmSync(configHome, { recursive: true, force: true }));

	function run(argv: readonly string[], env: NodeJS.ProcessEnv = {}): Promise<Run> {
		return new Promise((resolvePromise, reject) => {
			const child = spawn(runtime, [fixture, ...argv], {
				env: {
					...process.env,
					CI: undefined,
					DO_NOT_TRACK: undefined,
					ACME_TELEMETRY: undefined,
					XDG_CONFIG_HOME: configHome,
					...env,
				},
				timeout: 20_000,
			});
			let stdout = "";
			let stderr = "";
			child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
			child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
			child.on("error", reject);
			child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
		});
	}

	it("stops events in the next process after `disable`; the variable overrides it for one run", async () => {
		expect(await run(["deploy"])).toEqual({ code: 0, stdout: "", stderr: "sent acme deploy\n" });

		expect(await run(["telemetry", "disable"])).toEqual({
			code: 0,
			stdout: "Telemetry is off on this machine.\n",
			stderr: "",
		});
		const savedFile = join(configHome, "acme", "telemetry.json");
		const saved = readFileSync(savedFile, "utf8");
		expect(JSON.parse(saved)).toEqual({ telemetry: "off" });

		expect(await run(["deploy"])).toEqual({ code: 0, stdout: "", stderr: "" });
		expect(await run(["deploy"], { ACME_TELEMETRY: "1" })).toEqual({
			code: 0,
			stdout: "",
			stderr: "sent acme deploy\n",
		});
		expect(readFileSync(savedFile, "utf8")).toBe(saved);
		expect(await run(["deploy"])).toEqual({ code: 0, stdout: "", stderr: "" });
	}, 60_000);
});
