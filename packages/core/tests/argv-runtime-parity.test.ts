import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { which } from "@crustjs/utils/process";
import { describe, expect, it } from "vite-plus/test";

import { argvErrors } from "./argv-errors-fixture.ts";

// ────────────────────────────────────────────────────────────────────────────
// Argv errors are runtime-independent — the tokenizer is Crust's own, so Bun
// and Node must report malformed argv identically. Tests run on Node; Bun runs
// the same program as a subprocess.
// ────────────────────────────────────────────────────────────────────────────

const fixture = resolve(import.meta.dirname, "argv-errors-fixture.ts");
const bun = which("bun")!;

describe("argv errors across runtimes", () => {
	it("match between Bun and Node", async () => {
		const node = await argvErrors();
		expect(node[0]).toContain('Unknown flag "-z"');
		expect(node[1]).toContain('Unknown flag "-z"');

		const result = spawnSync(
			bun,
			[
				"--eval",
				`import { argvErrors } from ${JSON.stringify(fixture)};
console.log(JSON.stringify(await argvErrors()));`,
			],
			{ encoding: "utf8", timeout: 10_000 },
		);
		expect(result.stderr).toBe("");
		expect(JSON.parse(result.stdout)).toEqual(node);
	});
});
