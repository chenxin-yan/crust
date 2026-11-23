import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { Crust, defineExtension, defineExtensionId } from "@crustjs/core";
import { bold } from "@crustjs/style";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { captureExecute, withEnv } from "./index.ts";

describe("captureExecute", () => {
	let originalExitCode: typeof process.exitCode;
	beforeEach(() => {
		originalExitCode = process.exitCode;
		process.exitCode = 0;
	});
	afterEach(() => {
		process.exitCode = originalExitCode;
	});

	it("captures exit code 0 and exactly what was written", async () => {
		const app = new Crust("test-cli").action(({ stdout, stderr }) => {
			stdout("a");
			stdout("b");
			stdout.write("no newline");
			stderr("warn");
		});

		const result = await captureExecute(app, []);
		expect(result).toEqual({ stdout: "a\nb\nno newline", stderr: "warn\n", exitCode: 0 });
	});

	it("strips escape codes under FORCE_COLOR unless raw is set", async () => {
		vi.stubEnv("FORCE_COLOR", "1");
		try {
			const app = new Crust("test-cli").action(({ stdout, stderr }) => {
				stdout(bold("Done"));
				stderr(bold("Warn"));
			});
			expect(await captureExecute(app, [])).toMatchObject({ stdout: "Done\n", stderr: "Warn\n" });
			expect(await captureExecute(app, [], { raw: true })).toMatchObject({
				stdout: "\x1b[1mDone\x1b[22m\n",
				stderr: "\x1b[1mWarn\x1b[22m\n",
			});
		} finally {
			vi.unstubAllEnvs();
		}
	});

	it("replaces process.env for the run with the env option, then restores it", async () => {
		vi.stubEnv("CRUST_TEST_TOKEN", "from-shell");
		vi.stubEnv("CRUST_TEST_OTHER", "kept");
		try {
			const app = new Crust("test-cli")
				.flags({ token: { type: "string", env: { name: "CRUST_TEST_TOKEN" }, default: "none" } })
				.action(({ flags, stdout }) =>
					stdout(
						`${flags.token} ${process.env.CRUST_TEST_OTHER} ${Object.keys(process.env).length}`,
					),
				);
			expect((await captureExecute(app, [])).stdout).toMatch(/^from-shell kept \d+\n$/);
			expect((await captureExecute(app, [], { env: {} })).stdout).toBe("none undefined 0\n");
			expect(
				(await captureExecute(app, [], { env: { CRUST_TEST_TOKEN: "given", GONE: undefined } }))
					.stdout,
			).toBe("given undefined 1\n");
			expect(
				(await captureExecute(app, [], { env: { ...process.env, CRUST_TEST_TOKEN: "given" } }))
					.stdout,
			).toMatch(/^given kept \d+\n$/);
			expect(process.env.CRUST_TEST_TOKEN).toBe("from-shell");
			expect(process.env.CRUST_TEST_OTHER).toBe("kept");
		} finally {
			vi.unstubAllEnvs();
		}
	});

	it("runs in the cwd option's directory, then restores the working directory", async () => {
		const before = process.cwd();
		const dir = realpathSync(mkdtempSync(join(tmpdir(), "crust-testing-cwd-")));
		try {
			const app = new Crust("test-cli").action(({ stdout }) => stdout(process.cwd()));
			expect((await captureExecute(app, [], { cwd: dir })).stdout).toBe(`${dir}\n`);
			expect(process.cwd()).toBe(before);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("rejects a second run that replaces the environment while one is active", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const app = new Crust("test-cli").action(async ({ stdout }) => {
			await gate;
			stdout(String(process.env.CRUST_TEST_RUN));
		});
		const first = captureExecute(app, [], { env: { CRUST_TEST_RUN: "first" } });
		await expect(captureExecute(app, [], { env: { CRUST_TEST_RUN: "second" } })).rejects.toThrow(
			"one after another",
		);
		await expect(withEnv({}, async () => {})).rejects.toThrow("one after another");
		release();
		expect((await first).stdout).toBe("first\n");
		// The guard is released once the run settles.
		expect(await withEnv({ CRUST_TEST_RUN: "later" }, async () => process.env.CRUST_TEST_RUN)).toBe(
			"later",
		);
	});

	it("restores the environment when withEnv's function throws", async () => {
		const before = { ...process.env };
		await expect(
			withEnv({ ONLY: "1" }, async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		expect(process.env).toEqual(before);
	});

	it("gives the action stdin and terminal answers from its options", async () => {
		const app = new Crust("test-cli").action(async ({ stdin, stdout, stderr }) => {
			stderr(`${stdin.isTTY} ${stdout.isTTY} ${stdout.columns} ${stderr.columns}`);
			stdout.write(new TextEncoder().encode(await stdin.text()));
		});
		expect(await captureExecute(app, [])).toEqual({
			stdout: "",
			stderr: "false false undefined undefined\n",
			exitCode: 0,
		});
		expect(await captureExecute(app, [], { isTTY: true })).toMatchObject({
			stderr: "true true 80 80\n",
		});
		expect(await captureExecute(app, [], { isTTY: true, columns: 120, stdin: "a\0b" })).toEqual({
			stdout: "a\0b",
			stderr: "false true 120 120\n",
			exitCode: 0,
		});
	});

	it("captures bytes as they were written when the writer reuses its buffer", async () => {
		const app = new Crust("test-cli").action(({ stdout, stderr }) => {
			const reused = Buffer.from("a");
			for (const stream of [stdout, stderr]) {
				reused[0] = 0x61;
				stream.write(reused);
				reused[0] = 0x62;
				stream.write(reused);
			}
		});
		expect(await captureExecute(app, [])).toEqual({ stdout: "ab", stderr: "ab", exitCode: 0 });
	});

	it("captures exit code 1 without leaking it to the process", async () => {
		process.exitCode = 7;
		const app = new Crust("test-cli").action(() => {
			throw new Error("boom");
		});

		const result = await captureExecute(app, []);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("boom");
		expect(process.exitCode).toBe(7);
	});

	it("restores the caller's exit code after overlapping failure and success captures", async () => {
		process.exitCode = 7;

		let releaseErrorRenderer!: () => void;
		const errorRendererGate = new Promise<void>((resolve) => {
			releaseErrorRenderer = resolve;
		});
		let releaseSuccess!: () => void;
		const successGate = new Promise<void>((resolve) => {
			releaseSuccess = resolve;
		});

		const delayedRenderer = defineExtension(defineExtensionId("delayed-renderer")).onError(
			async () => {
				await errorRendererGate;
				return true;
			},
		);
		const failingApp = new Crust("test-cli").extend(delayedRenderer).action(() => {
			throw new Error("boom");
		});
		const successfulApp = new Crust("test-cli").action(async () => {
			await successGate;
		});

		const pendingFailure = captureExecute(failingApp, []);
		await sleep(0);
		// Core sets the exit code once, after rendering.
		expect(process.exitCode).toBe(7);
		const pendingSuccess = captureExecute(successfulApp, []);
		await sleep(0);

		releaseErrorRenderer();
		expect((await pendingFailure).exitCode).toBe(1);
		releaseSuccess();
		expect((await pendingSuccess).exitCode).toBe(0);
		expect(process.exitCode).toBe(7);
	});
});
