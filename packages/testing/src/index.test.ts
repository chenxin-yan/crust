import { describe, expect, it } from "bun:test";

import { Crust, defineCommand, defineExtension } from "@crustjs/core";
import { progress, spinner } from "@crustjs/progress";
import { input } from "@crustjs/prompts";

import { captureExecute, captureRun, runInteractive } from "./index.ts";

describe("captureRun", () => {
	it("preserves command, argument, and flag types from the application", () => {
		const deploy = defineCommand("deploy", (command) =>
			command
				.args({ name: "target", type: "string", required: true })
				.flags({ name: "force", type: "boolean" })
				.action(() => {}),
		);
		const app = new Crust("cli").add(deploy);

		function typecheckHarness() {
			void captureRun(app, ["deploy"], { args: { target: "prod" }, flags: { force: true } });
			void runInteractive(app, ["deploy"], { args: { target: "prod" } });
			// @ts-expect-error -- command paths come from the application tree
			void captureRun(app, ["deply"], { args: { target: "prod" } });
			// @ts-expect-error -- required arguments remain required through the harness
			void captureRun(app, ["deploy"]);
			// @ts-expect-error -- flags come from the selected command
			void runInteractive(app, ["deploy"], { args: { target: "prod" }, flags: { froce: true } });
		}
		void typecheckHarness;
		expect(true).toBe(true);
	});

	it("captures output as lines", async () => {
		const app = new Crust("test-cli").action(({ stdout, stderr }) => {
			stdout("first");
			stdout("second");
			stderr("warning");
		});

		expect(await captureRun(app, [])).toEqual({
			stdout: "first\nsecond",
			stderr: "warning",
		});
	});

	it("returns errors after preserving output", async () => {
		const error = new Error("failed");
		const app = new Crust("test-cli").action(({ stdout, stderr }) => {
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

describe("captureExecute", () => {
	it("captures exit code 0 and stdout on success", async () => {
		const app = new Crust("test-cli").action(({ stdout }) => {
			stdout("hello");
		});

		const result = await captureExecute(app, []);
		expect(result).toEqual({ stdout: "hello", stderr: "", exitCode: 0 });
	});

	it("captures exit code 1 and the rendered failure", async () => {
		const app = new Crust("test-cli").action(() => {
			throw new Error("boom");
		});

		const result = await captureExecute(app, []);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("boom");
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
		const renderer = defineExtension("renderer", {
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

	it("isolates exit codes across overlapping captures", async () => {
		const originalExitCode = process.exitCode;
		try {
			// Non-zero ambient value: if capture B reads state restored by capture
			// A's finally block, B reports 7 instead of its own 0.
			process.exitCode = 7;

			let releaseA!: () => void;
			const gateA = new Promise<void>((resolve) => {
				releaseA = resolve;
			});
			let releaseB!: () => void;
			const gateB = new Promise<void>((resolve) => {
				releaseB = resolve;
			});

			const appA = new Crust("test-cli").action(async () => {
				await gateA;
			});
			const appB = new Crust("test-cli").action(async () => {
				await gateB;
			});

			const pendingA = captureExecute(appA, []);
			await Bun.sleep(0);
			const pendingB = captureExecute(appB, []);
			await Bun.sleep(0);

			releaseA();
			expect((await pendingA).exitCode).toBe(0);
			releaseB();
			expect((await pendingB).exitCode).toBe(0);
			expect(process.exitCode).toBe(7);
		} finally {
			process.exitCode = originalExitCode;
		}
	});

	it("restores process.exitCode", async () => {
		const before = process.exitCode;
		const app = new Crust("test-cli").action(() => {
			throw new Error("boom");
		});

		await captureExecute(app, []);
		expect(process.exitCode).toBe(before);
	});
});
