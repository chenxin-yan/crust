import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, it } from "vite-plus/test";

const repoRoot = resolve(import.meta.dirname, "../../..");
const tscBin = join(repoRoot, "node_modules/.bin/tsc");

it("diagnoses broad choice input without exhausting type instantiation", () => {
	const fixture = mkdtempSync(join(tmpdir(), "crust-run-diagnostics-"));
	try {
		writeFileSync(
			join(fixture, "input.ts"),
			`import { Crust } from ${JSON.stringify(join(import.meta.dirname, "../src/index.ts"))};
const app = new Crust("app").flags(
	{ name: "mode", type: "string", choices: ["safe", "fast"], required: true },
	{ name: "verbose", type: "boolean" },
).action(({ flags }) => flags.mode);
declare const broad: string;
void app.run([], { flags: { mode: broad } });
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
		// An @ts-expect-error would also swallow TS2589, hiding the regression.
		expect(output.match(/error TS\d+/g)).toEqual(["error TS2322"]);
	} finally {
		rmSync(fixture, { recursive: true, force: true });
	}
});
