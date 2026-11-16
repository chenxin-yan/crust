/**
 * @module-tag windows
 * @module-tag macos
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { expect, it } from "vite-plus/test";

const script = fileURLToPath(new URL("generate-agents.ts", import.meta.url));

function check(nodeArgs: string[] = []) {
	return spawnSync(process.execPath, [...nodeArgs, script, "--check"], {
		encoding: "utf8",
		timeout: 20_000,
	});
}

it("keeps src/agents.generated.ts in sync with the installed skills package", () => {
	const result = check();
	expect(result.status, result.stderr || result.error?.message).toBe(0);
});

it("generates the same table whatever platform the host reports", () => {
	const asWindows = `import os from "node:os";
import { syncBuiltinESMExports } from "node:module";
Object.defineProperty(process, "platform", { value: "win32" });
os.platform = () => "win32";
syncBuiltinESMExports();`;
	const result = check(["--import", `data:text/javascript,${encodeURIComponent(asWindows)}`]);
	expect(result.status, result.stderr || result.error?.message).toBe(0);
});
