import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { expect, it } from "vite-plus/test";

it("keeps src/agents.generated.ts in sync with the installed skills package", () => {
	const result = spawnSync(
		process.execPath,
		[fileURLToPath(new URL("generate-agents.ts", import.meta.url)), "--check"],
		{ encoding: "utf8", timeout: 20_000 },
	);
	expect(result.status, result.stderr || result.error?.message).toBe(0);
});
