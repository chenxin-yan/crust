import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// ────────────────────────────────────────────────────────────────────────────
// Default IO through a pipe — once `process.stdout` is materialized (any platform
// layer or color library probing `isTTY` does it), Bun's native `console.log`
// silently drops output past the 64 KiB pipe buffer at exit (oven-sh/bun#36419).
// The default IO must deliver a large payload intact to a piped parent.
// ────────────────────────────────────────────────────────────────────────────

const corePkg = resolve(import.meta.dir, "..");
const LINE_LENGTH = 300_000;

const ENTRY_SOURCE = `import { Crust } from ${JSON.stringify(join(corePkg, "src/index.ts"))};
void process.stdout.isTTY;
await new Crust("pipe-cli")
	.action(({ stdout, stderr }) => {
		stdout("x".repeat(${LINE_LENGTH}));
		stderr("y".repeat(${LINE_LENGTH}));
	})
	.execute({ argv: [] });
`;

let fixtureDir: string;

beforeAll(() => {
	fixtureDir = mkdtempSync(join(tmpdir(), "crust-default-io-"));
	writeFileSync(join(fixtureDir, "entry.ts"), ENTRY_SOURCE);
});

afterAll(() => rmSync(fixtureDir, { recursive: true, force: true }));

describe("default IO", () => {
	it("delivers output larger than the pipe buffer to a piped parent", async () => {
		const proc = Bun.spawn([process.execPath, join(fixtureDir, "entry.ts")], {
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
});
