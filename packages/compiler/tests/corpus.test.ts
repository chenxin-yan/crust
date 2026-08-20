import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { compile } from "../src/index.js";

const goPath = Bun.which("go");
if (goPath === null) {
	console.warn(
		"[compiler corpus] SKIPPED: Go is not on PATH; native differential tests did not run",
	);
}

function run(command: string, args: readonly string[] = []) {
	const { exitCode, stderr, stdout } = Bun.spawnSync([command, ...args]);
	return { exitCode, stderr, stdout };
}

const fixtures = [
	{ name: "hello", args: [] },
	{ name: "lone-surrogate", args: [] },
	{ name: "embedded-bom", args: [] },
	{ name: "literals", args: [] },
	{ name: "expressions", args: ["Crust"] },
	{ name: "template", args: ["Crust"] },
	{ name: "functions", args: [] },
	{ name: "hello-argv", args: ["Crust", "extra"] },
] as const;

describe("compiler differential corpus", () => {
	it("rejects a directory-valued output path", async () => {
		const fixture = join(import.meta.dir, "fixtures", "hello.ts");
		const outputPath = await mkdtemp(join(tmpdir(), "crust-compiler-output-"));
		try {
			await expect(compile(fixture, { outputPath })).rejects.toThrow("must not be a directory");
		} finally {
			await rm(outputPath, { recursive: true, force: true });
		}
	});

	for (const { name, args } of fixtures) {
		it.skipIf(goPath === null)(
			`matches Node for ${name}`,
			async () => {
				const fixture = join(import.meta.dir, "fixtures", `${name}.ts`);
				const node = Bun.which("node");
				if (node === null) throw new Error("Node is required as the corpus reference runtime");

				const binary = await compile(fixture);
				try {
					expect(run(binary, args)).toEqual(run(node, [fixture, ...args]));
				} finally {
					await rm(dirname(binary), { recursive: true, force: true });
				}
			},
			120_000,
		);
	}
});
