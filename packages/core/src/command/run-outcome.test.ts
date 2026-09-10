import { describe, expect, it } from "bun:test";

import { getAmbientTerminalIO, getTerminalIO, withTerminalIO } from "@crustjs/utils/terminal";

import {
	Crust,
	defineContext,
	defineExtension,
	defineExtensionId,
	type AnyCrust,
} from "../index.ts";

describe("captured run outcomes", () => {
	it("captures quietly, preserving callback payloads and result", async () => {
		const log = console.log;
		const error = console.error;
		let liveWrites = 0;
		console.log = console.error = () => {
			liveWrites++;
		};
		try {
			const result = await new Crust("app")
				.action(({ stdout, stderr }) => {
					stdout("one\ntwo");
					stdout("");
					stderr("diagnostic");
					return 42;
				})
				.run([]);
			expect(result).toEqual({
				status: "completed",
				result: 42,
				stdout: "one\ntwo\n",
				stderr: "diagnostic",
			});
			expect(liveWrites).toBe(0);
		} finally {
			console.log = log;
			console.error = error;
		}
	});
	it.each([undefined, null, 0, "failure", { identity: true }])(
		"retains primitive and object failures: %p",
		async (error) => {
			const result = await new Crust("app")
				.action(({ stdout }) => {
					stdout("partial");
					throw error;
				})
				.run([]);
			expect(result).toEqual({ status: "failed", error, stdout: "partial", stderr: "" });
			if (result.status === "failed") expect(result.error).toBe(error);
		},
	);
	it("records before forwarding a throwing sink", async () => {
		const error = new Error("sink");
		const result = await new Crust("app")
			.action(({ stdout }) => stdout("recorded"))
			.run(
				[],
				{},
				{
					stdout() {
						throw error;
					},
				},
			);
		expect(result).toEqual({ status: "failed", error, stdout: "recorded", stderr: "" });
	});
	it("finishes before required validation and captures hook output", async () => {
		const id = defineExtensionId("finish");
		const app = new Crust("app").flags({ name: "mode", type: "string", required: true }).extend(
			defineExtension(id, {
				hooks: {
					preRun(ctx) {
						ctx.stdout("help");
						return ctx.finish();
					},
				},
			}),
		);
		const erased: AnyCrust = app;
		expect(await erased.run([])).toEqual({
			status: "finished",
			by: id,
			stdout: "help",
			stderr: "",
		});
	});
});

it("captures preparation output/failure while snapshot still rejects", async () => {
	const error = { preparation: true };
	const app = new Crust("app").extend(
		defineExtension(defineExtensionId("prepare"), {
			sections() {
				getAmbientTerminalIO()?.stderr("preparing");
				throw error;
			},
		}),
	);
	expect(await app.run([])).toEqual({ status: "failed", error, stdout: "", stderr: "preparing" });
	await expect(app.snapshot()).rejects.toBe(error);
});

it("captures cleanup failure only after disposal, without presenting errors or changing exit status", async () => {
	const error = new Error("cleanup");
	const status = process.exitCode;
	let presented = false;
	const resource = defineContext("resource", ({ stderr }) => ({
		[Symbol.asyncDispose]: async () => {
			await Promise.resolve();
			stderr("disposed");
			throw error;
		},
	}));
	const app = new Crust("app")
		.provide(resource())
		.extend(
			defineExtension(defineExtensionId("errors"), {
				hooks: {
					onError() {
						presented = true;
					},
				},
			}),
		)
		.action(async ({ ctx, stdout }) => {
			await ctx.resource;
			stdout("action");
			return 1;
		});
	const outcome = await app.run([]);
	expect(outcome).toEqual({ status: "failed", error, stdout: "action", stderr: "disposed" });
	expect(presented).toBe(false);
	expect(process.exitCode).toBe(status);
});

it("captures cancellation and postRun diagnostics with original error identity", async () => {
	const error = new DOMException("cancelled", "AbortError");
	const app = new Crust("app")
		.extend(
			defineExtension(defineExtensionId("post"), {
				hooks: {
					postRun({ stderr }, outcome) {
						stderr(outcome.status);
						throw "secondary";
					},
				},
			}),
		)
		.action(({ stdout }) => {
			stdout("partial");
			throw error;
		});
	expect(await app.run([])).toEqual({
		status: "failed",
		error,
		stdout: "partial",
		stderr: "failed",
	});
});

it("isolates nested and concurrent invocation terminal bridges", async () => {
	const inner = new Crust("inner").action(async () => {
		await Promise.resolve();
		getAmbientTerminalIO()?.stderr("inner");
	});
	const outer = new Crust("outer").action(async ({ stdout }) => {
		getAmbientTerminalIO()?.stderr("before");
		const result = await inner.run([]);
		expect(result.status).toBe("completed");
		stdout(result.stderr);
		getAmbientTerminalIO()?.stderr("after");
	});
	const [a, b] = await Promise.all([outer.run([]), inner.run([])]);
	expect(a).toEqual({
		status: "completed",
		result: undefined,
		stdout: "inner",
		stderr: "before\nafter",
	});
	expect(b).toEqual({ status: "completed", result: undefined, stdout: "", stderr: "inner" });
	expect(getAmbientTerminalIO()).toBeUndefined();
});

it("preserves explicit terminal streams without claiming to capture their writes", async () => {
	const writes: string[] = [];
	const app = new Crust("app").action(({ stdout }) => {
		getTerminalIO()?.output?.write("explicit");
		stdout("captured");
	});
	const outcome = await withTerminalIO(
		{
			output: {
				write(text) {
					writes.push(text);
				},
			},
		},
		() => app.run([]),
	);
	expect(outcome.status).toBe("completed");
	expect(outcome.stdout).toBe("captured");
	expect(outcome.stderr).toBe("");
	expect(writes).toEqual(["explicit"]);
});

it("retains invocation sink callbacks rather than rereading a mutated IO object", async () => {
	const writes: string[] = [];
	const io = {
		stdout: (text: string) => {
			writes.push(`original:${text}`);
		},
	};
	const app = new Crust("app").action(({ stdout }) => {
		io.stdout = (text) => {
			writes.push(`replacement:${text}`);
		};
		stdout("line");
	});
	const outcome = await app.run([], {}, io);
	expect(outcome.status).toBe("completed");
	expect(outcome.stdout).toBe("line");
	expect(writes).toEqual(["original:line"]);
});

it.each(["flgas", "arg", "raww"])(
	"checks unknown payload section %s before action",
	async (key) => {
		let called = false;
		const app = new Crust("app")
			.flags({ name: "mode", type: "string", default: "safe" })
			.action(() => {
				called = true;
			});
		const input = { flags: { mode: "safe" }, [key]: {} };
		const outcome = await app.run([], input);
		expect(outcome.status).toBe("failed");
		if (outcome.status === "failed") {
			expect(outcome.error).toMatchObject({ code: "PARSE" });
		}
		expect(called).toBe(false);
	},
);

it("accepts args, flags and raw sections and treats undefined unknown keys as omitted", async () => {
	const app = new Crust("app")
		.args({ name: "file", type: "string", required: true })
		.flags({ name: "mode", type: "string", required: true })
		.action(({ args, flags, rawArgs }) => ({ args, flags, rawArgs }));
	const input = {
		args: { file: "file.txt", unknown: undefined },
		flags: { mode: "safe", unknown: undefined },
		raw: ["--literal"],
		unknown: undefined,
	};
	expect(await app.run([], input)).toEqual({
		status: "completed",
		result: { args: { file: "file.txt" }, flags: { mode: "safe" }, rawArgs: ["--literal"] },
		stdout: "",
		stderr: "",
	});
});
