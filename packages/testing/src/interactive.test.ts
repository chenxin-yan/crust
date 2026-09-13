import { describe, expect, it } from "bun:test";

import { Crust, defineExtension, defineExtensionId } from "@crustjs/core";
import { progress, spinner } from "@crustjs/progress";
import { input } from "@crustjs/prompts";

import { runInteractive } from "./interactive.ts";

describe("runInteractive", () => {
	it("drives prompts and merges stderr with prompt frames", async () => {
		const app = new Crust("test-cli").action(async ({ stderr }) => {
			stderr("Starting");
			const name = await input({ message: "Name?" });
			stderr(`Hello, ${name}!`);
		});

		const run = runInteractive(app, []);
		await run.waitFor(/Name\?/);
		run.type("Ada");
		run.keys("return");
		await run.done;

		expect(run.screen()).toContain("Starting");
		expect(run.screen()).toContain("Hello, Ada!");
	});

	it("captures spinner output on the fake terminal screen", async () => {
		const app = new Crust("test-cli").action(async () => {
			await spinner({ message: "Deploying", task: async () => "ok" });
		});

		const run = runInteractive(app, []);
		await run.waitFor(/Deploying/);
		await run.done;

		expect(run.screen()).toContain("✓ Deploying");
	});

	it("captures progress indicator output on the fake terminal screen", async () => {
		const app = new Crust("test-cli").action(() => {
			const bar = progress({ message: "Copying", total: 2 });
			bar.start();
			bar.advance();
			bar.stop();
		});

		const run = runInteractive(app, []);
		await run.done;

		expect(run.screen()).toContain("✓ Copying (1/2)");
	});

	it("waitFor rethrows the application error instead of hanging", async () => {
		const error = new Error("boom");
		const app = new Crust("test-cli").action(() => {
			throw error;
		});

		const run = runInteractive(app, []);
		await expect(run.waitFor(/never rendered/)).rejects.toBe(error);
		await expect(run.done).rejects.toBe(error);
	});

	for (const error of [undefined, null, 0, "failed"]) {
		it(`propagates a primitive failure (${String(error)}) after live stderr`, async () => {
			const app = new Crust("test-cli").action(({ stderr }) => {
				stderr("before failure");
				throw error;
			});
			const run = runInteractive(app, []);
			await expect(run.done).rejects.toBe(error);
			expect(run.screen()).toContain("before failure");
			await expect(run.waitFor(/never rendered/)).rejects.toBe(error);
		});
	}

	it("allows an Extension to finish without running the action", async () => {
		const gate = defineExtension(defineExtensionId("gate"), {
			hooks: {
				preRun: (ctx) => {
					ctx.stderr("finished");
					return ctx.finish();
				},
			},
		});
		let called = false;
		const app = new Crust("test-cli").extend(gate).action(() => {
			called = true;
		});
		const run = runInteractive(app, []);
		await run.done;
		expect(run.screen()).toContain("finished");
		expect(called).toBe(false);
	});

	it("waitFor fails when the application completes without matching", async () => {
		const app = new Crust("test-cli").action(({ stderr }) => {
			stderr("done");
		});

		const run = runInteractive(app, []);
		await expect(run.waitFor(/never rendered/)).rejects.toThrow("already completed");
		await run.done;
	});
});
