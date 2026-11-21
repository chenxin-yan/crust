import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vite-plus/test";

/** A minified bundle, as `crust build` makes it, of a CLI that extends `extensions`. */
function bundle(dir: string, extensions: string): string {
	const entry = join(dir, `${extensions}.ts`);
	writeFileSync(
		entry,
		`import { Crust } from ${JSON.stringify(fileURLToPath(import.meta.resolve("@crustjs/core")))};
import { ${extensions} } from ${JSON.stringify(fileURLToPath(new URL("./index.ts", import.meta.url)))};
await new Crust("demo").extend(${extensions}()).action(() => {}).execute();
`,
	);
	const outfile = join(dir, `${extensions}.js`);
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
	return readFileSync(outfile, "utf8");
}

// The word pattern of @crustjs/utils/search, which minification keeps as written.
const RANKING = String.raw`[\p{L}\p{N}]+`;
const RENDERER = "No command matches";

it("bundles the search ranking only into a CLI that extends search()", () => {
	const dir = mkdtempSync(join(tmpdir(), "crust-extensions-search-bundle-"));
	try {
		const withHelp = bundle(dir, "help");
		expect(withHelp).not.toContain(RANKING);
		expect(withHelp).not.toContain(RENDERER);

		const withSearch = bundle(dir, "search");
		expect(withSearch.split(RANKING)).toHaveLength(2);
		expect(withSearch.split(RENDERER)).toHaveLength(2);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}, 60_000);
