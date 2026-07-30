import { describe, expect, it } from "bun:test";

import { Crust } from "@crustjs/core";
import { input } from "@crustjs/prompts";

import { captureRun, interactiveRun } from "./index.ts";

describe("captureRun", () => {
	it("captures joined output", async () => {
		const app = new Crust("test").handle(({ stdout, stderr }) => {
			stdout("hello ");
			stdout("world");
			stderr("warning");
		});

		expect(await captureRun(app, [])).toEqual({
			stdout: "hello world",
			stderr: "warning",
		});
	});

	it("returns errors after preserving output", async () => {
		const error = new Error("failed");
		const app = new Crust("test").handle(({ stdout, stderr }) => {
			stdout("before");
			stderr("problem");
			throw error;
		});

		const result = await captureRun(app, []);
		expect(result.stdout).toBe("before");
		expect(result.stderr).toBe("problem");
		expect(result.error).toBe(error);
	});
});

describe("interactiveRun", () => {
	it("drives prompts and merges application stderr with prompt frames", async () => {
		const app = new Crust("test").handle(async ({ stderr }) => {
			stderr("Starting\n");
			const name = await input({ message: "Name?" });
			stderr(`Hello, ${name}!`);
		});

		const run = interactiveRun(app, []);
		await run.waitFor(/Name\?/);
		run.type("Ada");
		run.keys("return");
		await run.done;

		expect(run.screen()).toContain("Starting");
		expect(run.screen()).toContain("Hello, Ada!");
	});
});
