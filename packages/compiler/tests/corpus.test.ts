import { describe, expect, it } from "bun:test";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";

import { compile } from "../src/index.js";

const goPath = Bun.which("go");
if (goPath === null) {
	console.warn(
		"[compiler corpus] SKIPPED: Go is not on PATH; native differential tests did not run",
	);
}

interface ExecutionResult {
	readonly exitCode: number;
	readonly stderr: string;
	readonly stdout: string;
}

async function run(command: string, args: readonly string[]): Promise<ExecutionResult> {
	const process = Bun.spawn([command, ...args], { stderr: "pipe", stdout: "pipe" });
	const [exitCode, stderr, stdout] = await Promise.all([
		process.exited,
		new Response(process.stderr).text(),
		new Response(process.stdout).text(),
	]);
	return { exitCode, stderr, stdout };
}

describe("compiler differential corpus", () => {
	it.skipIf(goPath === null)("matches Node for hello", async () => {
		const fixture = join(import.meta.dir, "fixtures", "hello.ts");
		const node = Bun.which("node");
		if (node === null) throw new Error("Node is required as the corpus reference runtime");

		const binary = await compile(fixture);
		try {
			expect(await run(binary, [])).toEqual(await run(node, [fixture]));
		} finally {
			await rm(dirname(binary), { recursive: true, force: true });
		}
	});
});
