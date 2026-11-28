import { describe, expect, it } from "vite-plus/test";

import { defineContext } from "../api/context.ts";
import { Crust, defineCommand } from "./crust.ts";

it("keeps safe pre-action shadowing, compatible bound replacement, and descendant locality", async () => {
	const text = defineContext("db").setup(() => "parent");
	const numeric = defineContext("db").setup(() => 42);
	const app = new Crust("cli")
		.provide(text())
		.action(async ({ ctx }) => (await ctx.db).toUpperCase())
		.command("before", (c) =>
			c.provide(numeric()).action(async ({ ctx }) => (await ctx.db).toFixed()),
		)
		.command("compatible", (c) =>
			c.action(async ({ ctx }) => (await ctx.db).toUpperCase()).provide(text.of("child")),
		)
		.command("nested", (c) =>
			c
				.action(async ({ ctx }) => (await ctx.db).toUpperCase())
				.add(
					defineCommand("leaf", (c) =>
						c.provide(numeric()).action(async ({ ctx }) => (await ctx.db).toFixed()),
					),
				),
		);
	expect(await app.run([])).toMatchObject({ status: "completed", result: "PARENT" });
	expect(await app.run(["before"])).toMatchObject({ status: "completed", result: "42" });
	expect(await app.run(["compatible"])).toMatchObject({ status: "completed", result: "CHILD" });
	expect(await app.run(["nested"])).toMatchObject({ status: "completed", result: "PARENT" });
	expect(await app.run(["nested", "leaf"])).toMatchObject({ status: "completed", result: "42" });
});

it("replaces the action on the new builder without mutating the prior action", async () => {
	const text = defineContext("db").setup(() => "parent");
	const calls: string[] = [];
	const original = new Crust("cli").provide(text()).action(async ({ ctx }) => {
		calls.push("old");
		return (await ctx.db).toUpperCase();
	});
	const replaced = original.action(async ({ ctx }) => {
		calls.push("new");
		return (await ctx.db).length;
	});
	expect(await original.run([])).toMatchObject({ status: "completed", result: "PARENT" });
	expect(await replaced.run([])).toMatchObject({ status: "completed", result: 6 });
	expect(calls).toEqual(["old", "new"]);
});

describe("runCommand", () => {
	const app = () =>
		new Crust("cli")
			.command("deploy", (c) =>
				c
					.args({ name: "target", type: "string", required: true })
					.flags({ replicas: { type: "number", default: 1 } })
					.action(({ args, flags, stdout }) => {
						stdout(`deploying ${args.target}`);
						return { target: args.target, replicas: flags.replicas };
					}),
			)
			.command("fail", (c) => c.action(() => Promise.reject(new Error("broken"))))
			.command("wait", (c) =>
				c.action(
					({ signal }) =>
						new Promise((resolve, reject) => {
							const abort = () => reject(signal.reason);
							if (signal.aborted) abort();
							signal.addEventListener("abort", abort);
							setTimeout(() => resolve("done"), 20);
						}),
				),
			);

	it("runs a command of the same application as app.run() does, capturing its output", async () => {
		const parentOut: string[] = [];
		const outcome = await app()
			.action(({ runCommand }) => runCommand(["deploy"], { args: { target: "api" } }))
			.run([], {}, { stdout: (chunk) => void parentOut.push(String(chunk)) });
		expect(outcome).toMatchObject({
			status: "completed",
			result: {
				status: "completed",
				result: { target: "api", replicas: 1 },
				stdout: "deploying api\n",
				exitCode: 0,
			},
		});
		expect(parentOut).toEqual([]);
	});

	it("passes stdin to the command, which is empty without it", async () => {
		const outcome = await new Crust("cli")
			.command("cat", (c) => c.action(({ stdin }) => stdin.text()))
			.action(async ({ runCommand }) => [
				await runCommand(["cat"], {}, { stdin: "piped" }),
				await runCommand(["cat"]),
			])
			.run([], {}, { stdin: "parent" });
		expect(outcome).toMatchObject({
			result: [{ result: "piped" }, { result: "" }],
		});
	});

	it("resolves to a failed outcome without failing the caller", async () => {
		const outcome = await app()
			.action(async ({ runCommand }) => [
				await runCommand(["fail"]),
				await runCommand(["deploy"]),
				await runCommand(["nope"]),
			])
			.run([]);
		expect(outcome.status).toBe("completed");
		const [thrown, invalid, unknown] = outcome.status === "completed" ? outcome.result : [];
		expect(thrown).toMatchObject({ status: "failed", error: new Error("broken"), exitCode: 1 });
		expect(invalid).toMatchObject({ status: "failed", error: { code: "VALIDATION" }, exitCode: 2 });
		expect(unknown).toMatchObject({
			status: "failed",
			error: { code: "COMMAND_NOT_FOUND" },
			exitCode: 2,
		});
	});

	it("is cancelled with the caller unless given its own signal", async () => {
		const outcomes: unknown[] = [];
		const run = (own?: AbortSignal) => {
			const controller = new AbortController();
			return app()
				.action(async ({ runCommand }) => {
					const pending = runCommand(["wait"], {}, own && { signal: own });
					await new Promise((resolve) => setTimeout(resolve, 5));
					controller.abort();
					outcomes.push(await pending);
				})
				.run([], {}, { signal: controller.signal });
		};
		await run();
		await run(new AbortController().signal);
		expect(outcomes).toMatchObject([
			{ status: "failed", error: { name: "AbortError" }, exitCode: 130 },
			{ status: "completed", result: "done" },
		]);
	});

	it("gives concurrent calls their own Contexts and output", async () => {
		let setups = 0;
		const counter = defineContext("counter").setup(() => ++setups);
		const outcome = await new Crust("cli")
			.provide(counter())
			.command("echo", (c) =>
				c
					.use(counter)
					.args({ name: "word", type: "string", required: true })
					.action(async ({ args, ctx, stdout }) => {
						const id = await ctx.counter;
						await new Promise((resolve) => setTimeout(resolve, 5));
						stdout(args.word);
						return id;
					}),
			)
			.action(({ runCommand }) =>
				Promise.all([
					runCommand(["echo"], { args: { word: "a" } }),
					runCommand(["echo"], { args: { word: "b" } }),
				]),
			)
			.run([]);
		expect(outcome).toMatchObject({
			status: "completed",
			result: [
				{ status: "completed", stdout: "a\n" },
				{ status: "completed", stdout: "b\n" },
			],
		});
		const results =
			outcome.status === "completed" ? outcome.result.map((o) => "result" in o && o.result) : [];
		expect(results.toSorted((a, b) => Number(a) - Number(b))).toEqual([1, 2]);
	});
});
