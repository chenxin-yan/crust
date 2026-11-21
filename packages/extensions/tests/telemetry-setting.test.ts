import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
					APPDATA: configHome,
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
			stdout: "Saved telemetry preference: off.\n",
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

		// The control command's own runs send nothing, even with telemetry on.
		expect(await run(["telemetry", "enable"])).toEqual({
			code: 0,
			stdout: "Saved telemetry preference: on.\n",
			stderr: "",
		});
		expect(await run(["telemetry"])).toEqual({
			code: 0,
			stdout: "Telemetry is on (saved preference). Turn it off with: acme telemetry disable\n",
			stderr: "",
		});
		expect(await run(["deploy"])).toEqual({ code: 0, stdout: "", stderr: "sent acme deploy\n" });
	}, 60_000);

	// Root ignores directory permissions, so only a regular user can see the save fail.
	it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
		"reports a disable it cannot save, sends nothing for it, and leaves later runs on",
		async () => {
			chmodSync(configHome, 0o500);
			try {
				const failed = await run(["telemetry", "disable"]);
				expect(failed.code).toBe(1);
				expect(failed.stdout).toBe("");
				expect(failed.stderr).toContain("Could not save the telemetry preference to ");
				expect(failed.stderr).toContain(
					"Set ACME_TELEMETRY=0 to turn telemetry off without a saved preference.",
				);
				expect(failed.stderr).not.toContain("sent ");
				expect(await run(["deploy"])).toEqual({
					code: 0,
					stdout: "",
					stderr: "sent acme deploy\n",
				});
			} finally {
				chmodSync(configHome, 0o700);
			}
		},
		60_000,
	);
});
