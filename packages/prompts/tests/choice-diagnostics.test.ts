import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, it } from "vite-plus/test";

const repoRoot = resolve(import.meta.dirname, "../../..");
const tscBin = join(repoRoot, "node_modules/.bin/tsc");

// A @ts-expect-error proves only that a call fails; the message is what tells the user why.
it("reports a default outside literal choices against the default, naming the choices", () => {
	const fixture = mkdtempSync(join(tmpdir(), "crust-prompts-diagnostics-"));
	try {
		writeFileSync(
			join(fixture, "input.ts"),
			`import { filter, multifilter, multiselect, select } from ${JSON.stringify(join(import.meta.dirname, "../src/index.ts"))};
const FEATURES = ["eslint", "prettier"] as const;
void select({ choices: FEATURES, default: "bogus" });
void filter({ choices: FEATURES, default: "bogus" });
void multiselect({ choices: FEATURES, default: ["bogus"] });
void multifilter({ choices: FEATURES, initial: ["bogus"] });
`,
		);
		writeFileSync(
			join(fixture, "tsconfig.json"),
			JSON.stringify({
				compilerOptions: {
					strict: true,
					target: "esnext",
					module: "esnext",
					moduleResolution: "bundler",
					noEmit: true,
					allowImportingTsExtensions: true,
					skipLibCheck: true,
					types: [join(repoRoot, "node_modules/@types/bun")],
				},
				files: ["input.ts"],
			}),
		);
		const result = spawnSync(tscBin, ["-p", fixture], { timeout: 60_000 });
		const output = result.stdout.toString() + result.stderr.toString();
		expect(result.status).toBe(1);
		expect(output.match(/input\.ts\(\d+,\d+\)/g)).toEqual([
			"input.ts(3,34)",
			"input.ts(4,34)",
			"input.ts(5,49)",
			"input.ts(6,49)",
		]);
		expect(
			output.match(/Type '"bogus"' is not assignable to type '"eslint" \| "prettier"/g),
		).toHaveLength(4);
		expect(output).not.toContain("NotChoiceTuple");
	} finally {
		rmSync(fixture, { recursive: true, force: true });
	}
});
