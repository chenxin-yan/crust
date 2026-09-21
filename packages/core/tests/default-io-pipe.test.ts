import { describe, expect, it } from "bun:test";
import { join, resolve } from "node:path";

// ────────────────────────────────────────────────────────────────────────────
// Default IO through a pipe — once `process.stdout` is materialized (any platform
// layer or color library probing `isTTY` does it), Bun's native `console.log`
// silently drops output past the 64 KiB pipe buffer at exit (oven-sh/bun#36419).
// The default IO must deliver a large payload intact to a piped parent, and must
// keep `console.log`'s tolerance for a consumer that closes the pipe early.
// ────────────────────────────────────────────────────────────────────────────

const corePkg = resolve(import.meta.dir, "..");
const LINE_LENGTH = 300_000;

const importCore = (entry: string) =>
	`import { Crust } from ${JSON.stringify(join(corePkg, entry))};\n`;

const LARGE_SOURCE = `${importCore("src/index.ts")}void process.stdout.isTTY;
await new Crust("pipe-cli")
	.action(({ stdout, stderr }) => {
		stdout("x".repeat(${LINE_LENGTH}));
		stderr("y".repeat(${LINE_LENGTH}));
	})
	.execute({ argv: [] });
`;

// Node consumes the built package (no TypeScript loader); Bun can as well.
const EARLY_CLOSE_SOURCE = `${importCore("dist/index.js")}await new Crust("pipe-cli")
	.action(async ({ stdout, stderr }) => {
		stdout("first");
		stderr("first");
		await new Promise((resolve) => setTimeout(resolve, 100));
		stdout("second");
		stderr("second");
	})
	.execute({ argv: [] });
`;

/** Closes the parent's end of `closed` after its first chunk, drains the other stream. */
async function runWithEarlyClose(runtime: string, closed: "stdout" | "stderr") {
	const proc = Bun.spawn([runtime, "--input-type=module", "--eval", EARLY_CLOSE_SOURCE], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const reader = proc[closed].getReader();
	await reader.read();
	await reader.cancel();
	const other = await new Response(proc[closed === "stdout" ? "stderr" : "stdout"]).text();
	return { exitCode: await proc.exited, other };
}

const runtimes = [process.execPath, ...(Bun.which("node") ? ["node"] : [])];

describe("default IO", () => {
	it("delivers output larger than the pipe buffer to a piped parent", async () => {
		const proc = Bun.spawn([process.execPath, "--input-type=module", "--eval", LARGE_SOURCE], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		expect(exitCode).toBe(0);
		expect(stdout).toBe(`${"x".repeat(LINE_LENGTH)}\n`);
		expect(stderr).toBe(`${"y".repeat(LINE_LENGTH)}\n`);
	});

	for (const runtime of runtimes) {
		for (const closed of ["stdout", "stderr"] as const) {
			it(`survives a consumer closing ${closed} early (${runtime})`, async () => {
				const { exitCode, other } = await runWithEarlyClose(runtime, closed);
				expect(exitCode).toBe(0);
				expect(other).toBe("first\nsecond\n");
			});
		}
	}
});
