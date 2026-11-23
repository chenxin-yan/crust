import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { closeSync, openSync } from "node:fs";
import { join, resolve } from "node:path";
import { text } from "node:stream/consumers";

import { which } from "@crustjs/utils/process";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { ensureDist } from "./helpers.ts";

// ────────────────────────────────────────────────────────────────────────────
// Default IO through a pipe — a payload larger than the 64 KiB pipe buffer must
// arrive intact even when the action exits the process right after writing, and must
// stay ordered with the user's own `console.log`. A consumer that closes stdout early
// cancels the run (exit 141); one that closes stderr is ignored. Bun flips
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

// The fd writer and its guarantees apply outside Windows; Windows keeps the stream writer.
const fdWriter = process.platform !== "win32";

const run = (runtime: string, source: string) =>
	spawnSync(runtime, ["--input-type=module", "--eval", source], {
		encoding: "utf8",
		timeout: 5_000,
	});

describe("default IO", () => {
	it.runIf(fdWriter)(
		"keeps a large write ordered before a later console.log after stdout is probed (bun)",
		() => {
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
		},
	);

	it.runIf(fdWriter)(
		"never materializes process.stdout or process.stderr on a plain run (node)",
		() => {
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
		},
	);

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
		it.runIf(fdWriter)(
			`delivers a large write before an immediate process.exit() (${runtime})`,
			() => {
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
			},
		);

		it(`survives a consumer closing stderr early (${runtime})`, async () => {
			const { exitCode, other } = await runWithEarlyClose(runtime, "stderr");
			expect(exitCode).toBe(0);
			expect(other).toBe("first\nsecond\n");
		});

		it.runIf(fdWriter)(
			`cancels silently with 141 once a consumer closes stdout (${runtime})`,
			async () => {
				const { exitCode, other } = await runWithEarlyClose(runtime, "stdout");
				expect(exitCode).toBe(141);
				expect(other).toBe("first\n");
			},
		);

		it.runIf(fdWriter)(
			`stops a streaming action piped to head -1 and aborts its signal (${runtime})`,
			() => {
				const source = `${importCore("dist/index.js")}await new Crust("follow")
	.action(async ({ stdout, signal }) => {
		try {
			for (let n = 0; !signal.aborted; n++) {
				stdout(\`line \${n}\`);
				await new Promise((resolve) => setTimeout(resolve, 1));
			}
		} finally {
			console.error(\`cause \${signal.reason?.cause}\`);
		}
	})
	.execute({ argv: [] });
`;
				const { stdout, stderr, status } = spawnSync(
					"bash",
					[
						"-c",
						'"$0" --input-type=module --eval "$1" | head -1; echo "${PIPESTATUS[*]}"',
						runtime,
						source,
					],
					{ encoding: "utf8", timeout: 5_000 },
				);
				expect({ stdout, stderr, status }).toEqual({
					stdout: "line 0\n141 0\n",
					stderr: "cause SIGPIPE\n",
					status: 0,
				});
			},
		);

		it.runIf(process.platform === "linux")(
			`fails with the system error and exit 1 on a full disk (${runtime})`,
			() => {
				const full = openSync("/dev/full", "w");
				try {
					const { stderr, status } = spawnSync(
						runtime,
						["--input-type=module", "--eval", EARLY_CLOSE_SOURCE],
						{ stdio: ["ignore", full, "pipe"], encoding: "utf8", timeout: 5_000 },
					);
					expect({ stderr, status }).toEqual({
						stderr: "Error: ENOSPC: no space left on device, write\n",
						status: 1,
					});
				} finally {
					closeSync(full);
				}
			},
		);
	}
});
