import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vite-plus/test";

// `crust build` runs build hooks from source; a CLI it bundles should not carry the skill renderer.
it("leaves the skill renderer out of a Crust-built bundle", () => {
	const dir = mkdtempSync(join(tmpdir(), "crust-skills-build-hook-"));
	try {
		const entry = join(dir, "cli.ts");
		writeFileSync(
			entry,
			`import { Crust } from ${JSON.stringify(fileURLToPath(import.meta.resolve("@crustjs/core")))};
import { skill } from ${JSON.stringify(fileURLToPath(new URL("./index.ts", import.meta.url)))};
await new Crust("demo").extend(skill({})).action(() => {}).execute();
`,
		);
		const outfile = join(dir, "cli.js");
		const result = spawnSync(
			"bun",
			[
				"build",
				"--minify",
				"--target=bun",
				"--define",
				'process.env.CRUST_INTERNAL_BUILD="1"',
				entry,
				"--outfile",
				outfile,
			],
			{ encoding: "utf8", timeout: 30_000 },
		);
		expect(result.status, result.stderr || result.error?.message).toBe(0);

		const bundle = readFileSync(outfile, "utf8");
		expect(bundle).toContain("points at another installed copy of this CLI");
		expect(bundle).not.toContain("How to Use This Skill");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
