/**
 * @module-tag windows
 * @module-tag macos
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { expect, it } from "vite-plus/test";

const script = fileURLToPath(new URL("generate-agents.ts", import.meta.url));
// The generator starts one process per variable it probes: seconds on a loaded CI host.
const SPAWN_TIMEOUT_MS = 50_000;
const TEST_TIMEOUT_MS = 60_000;

function check(nodeArgs: string[] = []) {
	return spawnSync(process.execPath, [...nodeArgs, script, "--check"], {
		encoding: "utf8",
		timeout: SPAWN_TIMEOUT_MS,
	});
}

it(
	"keeps src/agents.generated.ts in sync with the installed skills package",
	() => {
		const result = check();
		expect(result.status, result.stderr || result.error?.message).toBe(0);
	},
	TEST_TIMEOUT_MS,
);

it(
	"generates the same table whatever platform the host reports",
	() => {
		const asWindows = `import os from "node:os";
import { syncBuiltinESMExports } from "node:module";
Object.defineProperty(process, "platform", { value: "win32" });
os.platform = () => "win32";
syncBuiltinESMExports();`;
		const result = check(["--import", `data:text/javascript,${encodeURIComponent(asWindows)}`]);
		expect(result.status, result.stderr || result.error?.message).toBe(0);
	},
	TEST_TIMEOUT_MS,
);
