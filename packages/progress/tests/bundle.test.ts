import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, it } from "vite-plus/test";

// The shipped artifact: the default theme decides color for the spinner's sink, which must not
// pull in @crustjs/style's chain engine (shared prototype getters, CSS colour names).
it("bundles a spinner without @crustjs/style's chain engine", () => {
	const dir = mkdtempSync(join(tmpdir(), "crust-progress-bundle-"));
	try {
		const entry = join(dir, "entry.ts");
		const outfile = join(dir, "out.js");
		writeFileSync(
			entry,
			`import { spinner } from ${JSON.stringify(resolve(import.meta.dirname, "../dist/index.js"))};\nconsole.log(spinner);\n`,
		);
		const result = spawnSync(
			"bun",
			["build", entry, "--target=node", "--minify", "--outfile", outfile],
			{
				encoding: "utf8",
				timeout: 30_000,
			},
		);
		if (result.status !== 0) throw new Error(`bundle failed:\n${result.stderr}`);
		const code = readFileSync(outfile, "utf8");
		expect(code).not.toContain("crust.style.steps");
		expect(code).not.toContain("rebeccapurple");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
