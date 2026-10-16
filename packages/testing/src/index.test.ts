import { setTimeout as sleep } from "node:timers/promises";

import { Crust, defineExtension, defineExtensionId } from "@crustjs/core";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

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
		expect(process.exitCode).toBe(1);
		const pendingSuccess = captureExecute(successfulApp, []);
		await sleep(0);

		releaseErrorRenderer();
		expect((await pendingFailure).exitCode).toBe(1);
		releaseSuccess();
		expect((await pendingSuccess).exitCode).toBe(0);
		expect(process.exitCode).toBe(7);
	});
});
