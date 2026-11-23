import { Crust, defineContext } from "@crustjs/core";
import { input } from "@crustjs/prompts";
import { bold } from "@crustjs/style";
import { describe, expect, it, vi } from "vite-plus/test";

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

	it("runs argv and resolves done with exactly what was written and the exit code", async () => {
		const app = new Crust("test-cli").command("greet", (command) =>
			command
				.flags({ loud: { type: "boolean" } })
				.action(async ({ flags, stdout, stderr, exitCode }) => {
					const name = await input({ message: "Name?" });
					stdout(flags.loud ? `HELLO, ${name}!` : `Hello, ${name}!`);
					stdout("Bye");
					stderr("note");
					exitCode(3);
				}),
		);

		const run = runInteractive(app, ["greet", "--loud"]);
		await run.waitFor(/Name\?/);
		expect(run.stdout()).toBe("");
		run.type("Ada");
		run.keys("return");

		expect(await run.done).toEqual({ stdout: "HELLO, Ada!\nBye\n", stderr: "note\n", exitCode: 3 });
		expect(run.stdout()).toBe("HELLO, Ada!\nBye\n");
		expect(run.screen()).not.toContain("HELLO, Ada!");
	});

	it("keeps bytes as written and shows a character split across stderr writes", async () => {
		const app = new Crust("test-cli").action(({ stdout, stderr }) => {
			const reused = Buffer.from("a");
			stdout.write(reused);
			stderr.write(reused);
			reused[0] = 0x62;
			stdout.write(reused);
			stderr.write(reused);
			stderr.write(Uint8Array.of(0xc3));
			stderr.write(Uint8Array.of(0xa9));
		});

		const run = runInteractive(app, []);
		await run.waitFor(/abé/);
		expect(await run.done).toEqual({ stdout: "ab", stderr: "abé", exitCode: 0 });
		expect(run.stdout()).toBe("ab");
	});

	it("replaces the app's Contexts for the run with the provide option", async () => {
		const clock = defineContext("clock").setup(() => "real");
		const app = new Crust("test-cli")
			.provide(clock())
			.action(async ({ ctx, stdout }) => stdout(await ctx.clock));

		const run = runInteractive(app, [], { provide: [clock.of("fake")] });

		expect(await run.done).toMatchObject({ stdout: "fake\n", exitCode: 0 });
	});

	it("strips escape codes under FORCE_COLOR unless raw is set", async () => {
		vi.stubEnv("FORCE_COLOR", "1");
		try {
			const app = new Crust("test-cli").action(({ stdout, stderr }) => {
				stdout(bold("Done"));
				stderr(bold("Warn"));
			});
			const run = runInteractive(app, []);
			expect(await run.done).toMatchObject({ stdout: "Done\n", stderr: "Warn\n" });
			expect(run.stdout()).toBe("Done\n");
			const raw = runInteractive(app, [], { raw: true });
			expect(await raw.done).toMatchObject({
				stdout: "\x1b[1mDone\x1b[22m\n",
				stderr: "\x1b[1mWarn\x1b[22m\n",
			});
			expect(raw.stdout()).toBe("\x1b[1mDone\x1b[22m\n");
		} finally {
			vi.unstubAllEnvs();
		}
	});

	it("replaces process.env until done settles, and throws for an overlapping replacement", async () => {
		vi.stubEnv("CRUST_TEST_TOKEN", "from-shell");
		try {
			const app = new Crust("test-cli").action(async ({ stdout }) => {
				await input({ message: "Go?" });
				stdout(String(process.env.CRUST_TEST_TOKEN));
			});
			const run = runInteractive(app, [], { env: { CRUST_TEST_TOKEN: "given" } });
			expect(() => runInteractive(app, [], { env: {} })).toThrow("one after another");
			await run.waitFor(/Go\?/);
			run.keys("return");
			expect(await run.done).toMatchObject({ stdout: "given\n", exitCode: 0 });
			expect(process.env.CRUST_TEST_TOKEN).toBe("from-shell");
		} finally {
			vi.unstubAllEnvs();
		}
	});

	it("resizes the terminal the prompts and stderr see", async () => {
		const app = new Crust("test-cli").action(async ({ stderr }) => {
			await input({ message: "Name?" });
			stderr(`columns=${stderr.columns}`);
			stderr("x".repeat(30));
		});

		const run = runInteractive(app, []);
		await run.waitFor(/Name\?/);
		run.resize(20, 10);
		run.keys("return");
		await run.done;

		expect(run.screen()).toContain("columns=20");
		expect(run.screen()).toContain(`${"x".repeat(20)}\n${"x".repeat(10)}`);
	});

	it("rewraps the screen on resize, so a prompt's redraw keeps the lines above it", async () => {
		const message = "What is the name of the project you want?";
		const app = new Crust("test-cli").action(async ({ stderr }) => {
			stderr("HEADER LINE ABOVE THE PROMPT");
			await input({ message });
		});

		const run = runInteractive(app, []);
		await run.waitFor(/project you want/);
		run.resize(20, 10);
		run.type("x");
		await run.waitFor(/x/);
		expect(run.screen().startsWith("HEADER LINE ABOVE TH\nE PROMPT\n")).toBe(true);
		run.resize(80, 10);
		run.type("y");
		await run.waitFor(/xy/);
		run.keys("return");
		await run.done;

		const screen = run.screen();
		expect(screen.startsWith("HEADER LINE ABOVE THE PROMPT\n")).toBe(true);
		expect(screen.split(message)).toHaveLength(2);
	});

	it("cancels a waiting prompt with exit code 130, as Ctrl-C does", async () => {
		let cause: unknown;
		const app = new Crust("test-cli").action(async ({ signal }) => {
			signal.addEventListener("abort", () => {
				cause = (signal.reason as Error).cause;
			});
			await input({ message: "Name?" });
		});

		const run = runInteractive(app, []);
		await run.waitFor(/Name\?/);
		run.cancel();

		expect(await run.done).toMatchObject({ exitCode: 130 });
		expect(cause).toBe("SIGINT");
	});

	it("cancels the run when waitFor times out, so the environment is restored", async () => {
		vi.stubEnv("CRUST_TEST_TOKEN", "from-shell");
		try {
			const app = new Crust("test-cli").action(async () => {
				await input({ message: "Name?" });
			});
			const run = runInteractive(app, [], { env: {} });
			await expect(run.waitFor(/never rendered/, 50)).rejects.toThrow("timed out");
			expect(await run.done).toMatchObject({ exitCode: 130 });
			expect(process.env.CRUST_TEST_TOKEN).toBe("from-shell");
		} finally {
			vi.unstubAllEnvs();
		}
	});

	it("resolves done with the failure's exit code and rendered error", async () => {
		const app = new Crust("test-cli").action(({ stderr }) => {
			stderr("before failure");
			throw new Error("boom");
		});

		const run = runInteractive(app, []);
		await expect(run.waitFor(/never rendered/)).rejects.toThrow("exited with code 1");
		const result = await run.done;
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("before failure\n");
		expect(result.stderr).toContain("boom");
		expect(run.screen()).toContain("boom");
	});

	it("waitFor fails when the application completes without matching", async () => {
		const app = new Crust("test-cli").action(({ stderr }) => {
			stderr("done");
		});

		const run = runInteractive(app, []);
		await expect(run.waitFor(/never rendered/)).rejects.toThrow("already exited with code 0");
		await run.done;
	});
});
