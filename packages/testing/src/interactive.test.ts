import { Crust } from "@crustjs/core";
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

	it("captures stdout separately from the screen", async () => {
		const app = new Crust("test-cli").action(async ({ stdout }) => {
			const name = await input({ message: "Name?" });
			stdout(`Hello, ${name}!`);
			stdout("Bye");
		});

		const run = runInteractive(app, []);
		await run.waitFor(/Name\?/);
		expect(run.stdout()).toBe("");
		run.type("Ada");
		run.keys("return");
		await run.done;

		expect(run.stdout()).toBe("Hello, Ada!\nBye");
		expect(run.screen()).not.toContain("Hello, Ada!");
	});

	it("resolves done with the result and stderr captured like run()", async () => {
		const app = new Crust("test-cli").action(async ({ stdout, stderr }) => {
			const name = await input({ message: "Name?" });
			stdout("saved");
			stderr(`Hello, ${name}!`);
			return { name };
		});

		const run = runInteractive(app, []);
		await run.waitFor(/Name\?/);
		run.type("Ada");
		run.keys("return");

		expect(await run.done).toEqual({
			status: "completed",
			result: { name: "Ada" },
			stdout: "saved",
			stderr: "Hello, Ada!",
		});
	});

	it("strips escape codes under FORCE_COLOR unless raw is set", async () => {
		vi.stubEnv("FORCE_COLOR", "1");
		try {
			const app = new Crust("test-cli").action(({ stdout, stderr }) => {
				stdout(bold("Done"));
				stderr(bold("Warn"));
			});
			const run = runInteractive(app, []);
			expect(await run.done).toMatchObject({ stdout: "Done", stderr: "Warn" });
			expect(run.stdout()).toBe("Done");
			const raw = runInteractive(app, [], {}, { raw: true });
			expect(await raw.done).toMatchObject({
				stdout: "\x1b[1mDone\x1b[22m",
				stderr: "\x1b[1mWarn\x1b[22m",
			});
			expect(raw.stdout()).toBe("\x1b[1mDone\x1b[22m");
		} finally {
			vi.unstubAllEnvs();
		}
	});

	it("reads flags' env fallbacks from process.env unless the env option is given", async () => {
		vi.stubEnv("CRUST_TEST_TOKEN", "from-shell");
		try {
			const app = new Crust("test-cli")
				.flags({ token: { type: "string", env: { name: "CRUST_TEST_TOKEN" }, default: "none" } })
				.action(({ flags }) => flags.token);
			expect(await runInteractive(app, []).done).toMatchObject({ result: "from-shell" });
			expect(await runInteractive(app, [], {}, { env: {} }).done).toMatchObject({ result: "none" });
			const given = runInteractive(app, [], {}, { env: { CRUST_TEST_TOKEN: "given" } });
			expect(await given.done).toMatchObject({ result: "given" });
		} finally {
			vi.unstubAllEnvs();
		}
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

	it("waitFor fails when the application completes without matching", async () => {
		const app = new Crust("test-cli").action(({ stderr }) => {
			stderr("done");
		});

		const run = runInteractive(app, []);
		await expect(run.waitFor(/never rendered/)).rejects.toThrow("already completed");
		await run.done;
	});
});
