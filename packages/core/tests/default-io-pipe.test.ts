import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { text } from "node:stream/consumers";

import { which } from "@crustjs/utils/process";
import { beforeAll, describe, expect, it } from "vite-plus/test";

// ────────────────────────────────────────────────────────────────────────────
// Default IO through a pipe — once `process.stdout` is materialized (any platform
// layer or color library probing `isTTY` does it), Bun's native `console.log`
// silently drops output past the 64 KiB pipe buffer at exit (oven-sh/bun#36419).
// The default IO must deliver a large payload intact to a piped parent, and must
// keep `console.log`'s tolerance for a consumer that closes the pipe early.
// ────────────────────────────────────────────────────────────────────────────

const corePkg = resolve(import.meta.dirname, "..");
const LINE_LENGTH = 300_000;
// The regression is Bun's; tests run on Node, so spawn Bun as the subject.
const bun = which("bun")!;

beforeAll(() => {
	// Direct `vp test` needs both packages' dist; leave existing builds alone.
	for (const [pkg, marker] of [
		[resolve(corePkg, "../utils"), "dist/artifacts.js"],
		[corePkg, "dist/index.js"],
	] as const) {
		if (existsSync(join(pkg, marker))) continue;
		const build = spawnSync(bun, ["run", "build"], { cwd: pkg, timeout: 120_000 });
		if (build.status !== 0) {
			throw new Error(
				`${pkg} build failed:\n${build.stdout.toString()}\n${build.stderr.toString()}`,
			);
		}
	}
});

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
	const proc = spawn(runtime, ["--input-type=module", "--eval", EARLY_CLOSE_SOURCE], {
		stdio: ["ignore", "pipe", "pipe"],
		timeout: 5_000,
	});
	const exited = once(proc, "close");
	await once(proc[closed], "data");
	proc[closed].destroy();
	const other = await text(proc[closed === "stdout" ? "stderr" : "stdout"]);
	const [exitCode] = await exited;
	return { exitCode, other };
}

const runtimes = [bun, ...(which("node") ? ["node"] : [])];

describe("default IO", () => {
	it("delivers output larger than the pipe buffer to a piped parent", () => {
		const {
			stdout,
			stderr,
			status: exitCode,
		} = spawnSync(bun, ["--input-type=module", "--eval", LARGE_SOURCE], {
			encoding: "utf8",
			timeout: 5_000,
		});
		expect(exitCode).toBe(0);
		expect(stdout).toBe(`${"x".repeat(LINE_LENGTH)}\n`);
		expect(stderr).toBe(`${"y".repeat(LINE_LENGTH)}\n`);
	});

	for (const runtime of runtimes) {
		it(`does not leave error listeners after successful writes (${runtime})`, () => {
			const source = `${importCore("dist/index.js")}
import assert from "node:assert/strict";
const streams = [process.stdout, process.stderr];
const listeners = streams.map((stream) => stream.listeners("error"));
await new Crust("pipe-cli")
	.action(({ stdout, stderr }) => {
		stdout("first");
		stderr("first");
		stdout("second");
		stderr("second");
	})
	.execute({ argv: [] });
await new Promise((resolve) => setImmediate(resolve));
for (const [index, stream] of streams.entries()) {
	assert.deepEqual(stream.listeners("error"), listeners[index]);
	if (listeners[index].length === 0) {
		assert.throws(() => stream.emit("error", new Error("unrelated failure")), /unrelated failure/);
	}
}
`;
			const {
				stdout,
				stderr,
				status: exitCode,
			} = spawnSync(runtime, ["--input-type=module", "--eval", source], {
				encoding: "utf8",
				timeout: 5_000,
			});
			expect(stderr).toBe("first\nsecond\n");
			expect(stdout).toBe("first\nsecond\n");
			expect(exitCode).toBe(0);
		});

		for (const closed of ["stdout", "stderr"] as const) {
			it(`survives a consumer closing ${closed} early (${runtime})`, async () => {
				const { exitCode, other } = await runWithEarlyClose(runtime, closed);
				expect(exitCode).toBe(0);
				expect(other).toBe("first\nsecond\n");
			});
		}
	}
});
