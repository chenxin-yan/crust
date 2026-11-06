import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { join, resolve } from "node:path";
import { text } from "node:stream/consumers";

import { which } from "@crustjs/utils/process";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { ensureDist } from "./helpers.ts";

// ────────────────────────────────────────────────────────────────────────────
// Default IO through a pipe — a payload larger than the 64 KiB pipe buffer must
// arrive intact even when the action exits the process right after writing, must
// stay ordered with the user's own `console.log`, and the default IO must keep
// `console.log`'s tolerance for a consumer that closes the pipe early. Bun flips
// fd 1 to non-blocking once anything touches `process.stdout` (a platform layer,
// a color library probing `isTTY`), so several cases probe it first.
// ────────────────────────────────────────────────────────────────────────────

const corePkg = resolve(import.meta.dirname, "..");
const LINE_LENGTH = 300_000;
// Tests run on Node; spawn Bun as a subject too.
const bun = which("bun")!;

beforeAll(ensureDist);

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

const run = (runtime: string, source: string) =>
	spawnSync(runtime, ["--input-type=module", "--eval", source], {
		encoding: "utf8",
		timeout: 5_000,
	});

describe("default IO", () => {
	it("keeps a large write ordered before a later console.log after stdout is probed (bun)", () => {
		const { stdout, status } = run(
			bun,
			`${importCore("src/index.ts")}void process.stdout.isTTY;
await new Crust("pipe-cli")
	.action(({ stdout }) => {
		stdout("x".repeat(${LINE_LENGTH}));
		console.log("B");
	})
	.execute({ argv: [] });
`,
		);
		expect(status).toBe(0);
		expect(stdout.indexOf("B")).toBe(LINE_LENGTH + 1);
		expect(stdout).toBe(`${"x".repeat(LINE_LENGTH)}\nB\n`);
	});

	it("never materializes process.stdout or process.stderr on a plain run (node)", () => {
		const { stdout, stderr, status } = run(
			"node",
			`import { writeSync } from "node:fs";
const touched = [];
for (const name of ["stdout", "stderr"]) {
	const { get, enumerable } = Object.getOwnPropertyDescriptor(process, name);
	Object.defineProperty(process, name, {
		configurable: true,
		enumerable,
		get() {
			touched.push(name);
			return get.call(process);
		},
	});
}
const { Crust } = await import(${JSON.stringify(join(corePkg, "dist/index.js"))});
await new Crust("pipe-cli")
	.action(({ stdout, stderr }) => {
		stdout("out");
		stderr("err");
	})
	.execute({ argv: [] });
writeSync(1, JSON.stringify(touched));
`,
		);
		expect(stderr).toBe("err\n");
		expect(stdout).toBe("out\n[]");
		expect(status).toBe(0);
	});

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
		it(`delivers a large write before an immediate process.exit() (${runtime})`, () => {
			const { stdout, stderr, status } = run(
				runtime,
				`${importCore("dist/index.js")}void process.stdout.isTTY;
await new Crust("pipe-cli")
	.action(({ stdout, stderr }) => {
		stdout("x".repeat(${LINE_LENGTH}));
		stderr("y".repeat(${LINE_LENGTH}));
		process.exit(0);
	})
	.execute({ argv: [] });
`,
			);
			expect(status).toBe(0);
			expect(stdout.length).toBe(LINE_LENGTH + 1);
			expect(stderr.length).toBe(LINE_LENGTH + 1);
			expect(stdout).toBe(`${"x".repeat(LINE_LENGTH)}\n`);
			expect(stderr).toBe(`${"y".repeat(LINE_LENGTH)}\n`);
		});

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
