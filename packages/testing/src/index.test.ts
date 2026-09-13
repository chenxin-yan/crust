import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { Crust, defineExtension, defineExtensionId } from "@crustjs/core";
import { spinner } from "@crustjs/progress";

import { captureExecute } from "./index.ts";

describe("captureExecute", () => {
	let originalExitCode: typeof process.exitCode;
	beforeEach(() => {
		originalExitCode = process.exitCode;
		process.exitCode = 0;
	});
	afterEach(() => {
		process.exitCode = originalExitCode;
	});

	it("captures exit code 0 and stdout on success", async () => {
		const app = new Crust("test-cli").action(({ stdout }) => {
			stdout("hello");
		});

		const result = await captureExecute(app, []);
		expect(result).toEqual({ stdout: "hello", stderr: "", exitCode: 0 });
	});

	it("captures progress output through execute IO", async () => {
		const app = new Crust("test-cli").action(async () => {
			await spinner({ message: "Deploying", task: async () => "ok" });
		});

		const result = await captureExecute(app, []);

		expect(result.stderr).toContain("✓ Deploying");
		expect(result.exitCode).toBe(0);
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

	it("captures exit code 130 for AbortError cancellation", async () => {
		const app = new Crust("test-cli").action(() => {
			throw new DOMException("Prompt was cancelled.", "AbortError");
		});

		const result = await captureExecute(app, []);
		expect(result.exitCode).toBe(130);
		expect(result.stderr).toBe("");
	});

	it("captures onError extension rendering", async () => {
		const renderer = defineExtension(defineExtensionId("renderer"), {
			hooks: {
				onError(error, ctx) {
					ctx.stderr(`custom: ${(error as Error).message}`);
					return true;
				},
			},
		});
		const app = new Crust("test-cli").extend(renderer).action(() => {
			throw new Error("boom");
		});

		const result = await captureExecute(app, []);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBe("custom: boom");
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

		const delayedRenderer = defineExtension(defineExtensionId("delayed-renderer"), {
			hooks: {
				async onError() {
					await errorRendererGate;
					return true;
				},
			},
		});
		const failingApp = new Crust("test-cli").extend(delayedRenderer).action(() => {
			throw new Error("boom");
		});
		const successfulApp = new Crust("test-cli").action(async () => {
			await successGate;
		});

		const pendingFailure = captureExecute(failingApp, []);
		await Bun.sleep(0);
		expect(process.exitCode).toBe(1);
		const pendingSuccess = captureExecute(successfulApp, []);
		await Bun.sleep(0);

		releaseErrorRenderer();
		expect((await pendingFailure).exitCode).toBe(1);
		releaseSuccess();
		expect((await pendingSuccess).exitCode).toBe(0);
		expect(process.exitCode).toBe(7);
	});
});
