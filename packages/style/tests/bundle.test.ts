import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

// The shipped artifact: one module, so only statement-level tree-shaking applies.
const styleEntry = resolve(import.meta.dirname, "../dist/index.js");

let fixtureDir: string;

beforeAll(() => {
	fixtureDir = mkdtempSync(join(tmpdir(), "crust-style-bundle-"));
});

afterAll(() => rmSync(fixtureDir, { recursive: true, force: true }));

function bundle(imports: string, body?: string): string {
	const entry = join(fixtureDir, "entry.ts");
	const outfile = join(fixtureDir, "out.js");
	writeFileSync(
		entry,
		`import { ${imports} } from ${JSON.stringify(styleEntry)};\n${
			body ??
			`console.log(${imports
				.split(",")
				.map((name) => `${name.trim()}("x")`)
				.join(", ")});`
		}\n`,
	);
	const result = spawnSync(
		"bun",
		["build", entry, "--target=bun", "--minify", "--outfile", outfile],
		{
			encoding: "utf8",
			timeout: 30_000,
		},
	);
	if (result.status !== 0) throw new Error(`bundle failed:\n${result.stderr}`);
	return readFileSync(outfile, "utf8");
}

describe("bare colour exports", () => {
	it("bundle without the chain engine or CSS colour names", () => {
		const code = bundle("bold, cyan, dim");
		expect(code).not.toContain("crust.style.steps");
		expect(code).not.toContain("rebeccapurple");
		expect(code).not.toContain("brightMagenta");
	});
});

describe("createPlainStyle", () => {
	it("bundles without the chain engine or CSS colour names", () => {
		const code = bundle(
			"createPlainStyle",
			'const s = createPlainStyle({ overrides: { isTTY: true } });\nconsole.log(s.bold(s.cyan("x")));',
		);
		expect(code).not.toContain("crust.style.steps");
		expect(code).not.toContain("rebeccapurple");
	});
});
