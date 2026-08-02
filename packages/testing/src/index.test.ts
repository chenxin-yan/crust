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
