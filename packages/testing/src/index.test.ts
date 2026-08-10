import { describe, expect, it } from "bun:test";

import { Crust, defineCommand, defineExtension } from "@crustjs/core";
import { spinner } from "@crustjs/progress";
import { input } from "@crustjs/prompts";

import {
	type ArgvHints,
	captureExecute,
	captureRun,
	runInteractive,
	type RunnableApp,
} from "./index.ts";

type Expect<T extends true> = T;
type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

describe("argv hints", () => {
	it("derives command and flag spellings from the app type while accepting any string", async () => {
		const login = defineCommand("login", (command) =>
			command.flags({ name: "token", type: "string", short: "t" }).action(() => {}),
		);
		const app = new Crust("cli").flags({ name: "verbose", type: "boolean", short: "v" }).add(login);

		type _Hints = Expect<
			Equal<ArgvHints<typeof app>, "login" | "--verbose" | "-v" | "--token" | "-t">
		>;
		// structural apps without the phantom fall back to no hints
		type _None = Expect<Equal<ArgvHints<RunnableApp>, never>>;

		// arbitrary strings (positionals, flag values) remain accepted by every helper,
		// including widened string[] arrays — the common consumer pattern
		const typecheckLooseArgv = () => {
			const widened: string[] = ["login", "free-text"];
			void captureRun(app, widened);
			void captureExecute(app, ["login", "free-text"]);
			void runInteractive(app, ["login", "free-text"]);
		};
		void typecheckLooseArgv;

		const result = await captureRun(app, ["login", "--token", "abc"]);
		expect(result.error).toBeUndefined();
	});
});

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

describe("runInteractive", () => {
	it("drives prompts from a structural runnable and merges stderr with prompt frames", async () => {
		const app: RunnableApp = {
			async run(_argv, io) {
				io?.stderr?.("Starting");
				const name = await input({ message: "Name?" });
				io?.stderr?.(`Hello, ${name}!`);
			},
		};

		const run = runInteractive(app, []);
		await run.waitFor(/Name\?/);
		run.type("Ada");
		run.keys("return");
		await run.done;

		expect(run.screen()).toContain("Starting");
		expect(run.screen()).toContain("Hello, Ada!");
	});

	it("captures spinner output on the fake terminal screen", async () => {
		const app: RunnableApp = {
			async run() {
				await spinner({ message: "Deploying", task: async () => "ok" });
			},
		};

		const run = runInteractive(app, []);
		await run.waitFor(/Deploying/);
		await run.done;

		expect(run.screen()).toContain("✓ Deploying");
	});

	it("waitFor rethrows the application error instead of hanging", async () => {
		const error = new Error("boom");
		const app: RunnableApp = {
			async run() {
				throw error;
			},
		};

		const run = runInteractive(app, []);
		await expect(run.waitFor(/never rendered/)).rejects.toBe(error);
	});

	it("waitFor fails when the application completes without matching", async () => {
		const app: RunnableApp = {
			async run(_argv, io) {
				io?.stderr?.("done");
			},
		};

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
