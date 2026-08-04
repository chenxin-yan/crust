import { describe, expect, it } from "bun:test";

import { input } from "@crustjs/prompts";

import { captureRun, interactiveRun, type RunnableApp } from "./index.ts";

describe("captureRun", () => {
	it("captures output from a structural runnable as lines", async () => {
		const app: RunnableApp = {
			async run(_argv, io) {
				io?.stdout?.("first");
				io?.stdout?.("second");
				io?.stderr?.("warning");
			},
		};

		expect(await captureRun(app, [])).toEqual({
			stdout: "first\nsecond",
			stderr: "warning",
		});
	});

	it("returns errors after preserving output", async () => {
		const error = new Error("failed");
		const app: RunnableApp = {
			async run(_argv, io) {
				io?.stdout?.("before");
				io?.stderr?.("problem");
				throw error;
			},
		};

		const result = await captureRun(app, []);
		expect(result.stdout).toBe("before");
		expect(result.stderr).toBe("problem");
		expect(result.error).toBe(error);
	});
});

describe("interactiveRun", () => {
	it("drives prompts from a structural runnable and merges stderr with prompt frames", async () => {
		const app: RunnableApp = {
			async run(_argv, io) {
				io?.stderr?.("Starting");
				const name = await input({ message: "Name?" });
				io?.stderr?.(`Hello, ${name}!`);
			},
		};

		const run = interactiveRun(app, []);
		await run.waitFor(/Name\?/);
		run.type("Ada");
		run.keys("return");
		await run.done;

		expect(run.screen()).toContain("Starting");
		expect(run.screen()).toContain("Hello, Ada!");
	});

	it("waitFor rethrows the application error instead of hanging", async () => {
		const error = new Error("boom");
		const app: RunnableApp = {
			async run() {
				throw error;
			},
		};

		const run = interactiveRun(app, []);
		await expect(run.waitFor(/never rendered/)).rejects.toBe(error);
	});

	it("waitFor fails when the application completes without matching", async () => {
		const app: RunnableApp = {
			async run(_argv, io) {
				io?.stderr?.("done");
			},
		};

		const run = interactiveRun(app, []);
		await expect(run.waitFor(/never rendered/)).rejects.toThrow("already completed");
		await run.done;
	});
});

describe("captureExecute", () => {
	it("captures exit code 0 and stdout on success", async () => {
		const { Crust } = await import("@crustjs/core");
		const { captureExecute } = await import("./index.ts");
		const app = new Crust("test-cli").handle(({ stdout }) => {
			stdout("hello");
		});

		const result = await captureExecute(app, []);
		expect(result).toEqual({ stdout: "hello", stderr: "", exitCode: 0 });
	});

	it("captures exit code 1 and the rendered failure", async () => {
		const { Crust } = await import("@crustjs/core");
		const { captureExecute } = await import("./index.ts");
		const app = new Crust("test-cli").handle(() => {
			throw new Error("boom");
		});

		const result = await captureExecute(app, []);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("boom");
	});

	it("captures exit code 130 for AbortError cancellation", async () => {
		const { Crust } = await import("@crustjs/core");
		const { captureExecute } = await import("./index.ts");
		const app = new Crust("test-cli").handle(() => {
			throw new DOMException("Prompt was cancelled.", "AbortError");
		});

		const result = await captureExecute(app, []);
		expect(result.exitCode).toBe(130);
		expect(result.stderr).toBe("");
	});

	it("captures onError extension rendering", async () => {
		const { Crust, defineExtension } = await import("@crustjs/core");
		const { captureExecute } = await import("./index.ts");
		const renderer = defineExtension("renderer", {
			hooks: {
				onError(error, ctx) {
					ctx.stderr(`custom: ${(error as Error).message}`);
					return true;
				},
			},
		});
		const app = new Crust("test-cli").extend(renderer).handle(() => {
			throw new Error("boom");
		});

		const result = await captureExecute(app, []);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBe("custom: boom");
	});

	it("restores process.exitCode", async () => {
		const { Crust } = await import("@crustjs/core");
		const { captureExecute } = await import("./index.ts");
		const before = process.exitCode;
		const app = new Crust("test-cli").handle(() => {
			throw new Error("boom");
		});

		await captureExecute(app, []);
		expect(process.exitCode).toBe(before);
	});
});
