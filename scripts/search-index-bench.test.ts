import { join, resolve } from "node:path";

import { afterEach, expect, it } from "vite-plus/test";

import {
	reapBoundedProcesses,
	runBoundedProcess,
} from "../packages/crust/tests/bounded-process.ts";

const repoRoot = resolve(import.meta.dirname, "..");

afterEach(reapBoundedProcesses);

it("compiles the generated CLI and reports each step, without thresholds", async () => {
	const result = await runBoundedProcess(
		"bun",
		[join(repoRoot, "scripts/search-index-bench.ts"), "--groups", "2", "--runs", "1"],
		{ cwd: repoRoot, timeout: 55_000 },
	);

	expect(result.stderr).toBe("");
	expect(result.exitCode).toBe(0);
	// 2 groups of 30 commands, the root, `search`, `noop`, and `bench`.
	expect(result.stdout).toContain("Indexed commands: 66;");
	for (const step of ["Lazy tree build", "Index build", "One query", "Baseline", "wall time"]) {
		expect(result.stdout).toContain(step);
	}
}, 60_000);
