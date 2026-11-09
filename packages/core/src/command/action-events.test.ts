import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { executeCrust } from "../../tests/helpers.ts";
import {
	Crust,
	defineExtension,
	defineExtensionId,
	type InvocationOutcome,
	type Renderer,
} from "../index.ts";

const quiet = { stdout() {}, stderr() {} };

/** An Extension whose renderer logs its stream signals and passes text through. */
function loggingRenderer(log: string[], overrides: Partial<Renderer> = {}) {
	return defineExtension(defineExtensionId("observe")).renderer((ctx) => ({
		text: ctx.stdout,
		diag: ctx.stderr,
		stream: () => void log.push("stream"),
		event: (event) => void log.push(`renderer ${String(event)}`),
		result: (value) => void log.push(`result ${String(value)}`),
		error: (error) => void log.push(`error ${String(error)}`),
		...overrides,
	}));
}

describe("async generator actions", () => {
	it("delivers each event live to the renderer, then the caller, and returns the result", async () => {
		const log: string[] = [];
		const outcomes: InvocationOutcome[] = [];
		const observe = loggingRenderer(log).postRun((_ctx, outcome) => void outcomes.push(outcome));
		const app = new Crust("cli").extend(observe).action(async function* ({ stdout }) {
			log.push("start");
			yield 1;
			log.push("between");
			stdout("human");
			yield 2;
			return "done";
		});

		const outcome = await app.run(
			[],
			{},
			{ onEvent: (event) => log.push(`caller ${String(event)}`) },
		);

		expect(log).toEqual([
			"stream",
			"start",
			"renderer 1",
			"caller 1",
			"between",
			"renderer 2",
			"caller 2",
			"result done",
		]);
		expect(outcome).toMatchObject({ status: "completed", result: "done", events: [1, 2] });
		// Events are never printed; only stdout() writes are.
		expect(outcome.stdout).toBe("human");
		expect(outcomes).toEqual([{ status: "completed", result: "done", events: [1, 2] }]);
		expect(Object.isFrozen(outcomes[0]!.status === "completed" && outcomes[0]!.events)).toBe(true);
	});

	it("marks a generator that yields nothing with empty events, and a normal action with none", async () => {
		const outcomes: InvocationOutcome[] = [];
		const observe = defineExtension(defineExtensionId("observe")).postRun(
			(_ctx, outcome) => void outcomes.push(outcome),
		);
		const app = new Crust("cli")
			.extend(observe)
			.command("stream", (cmd) =>
				// oxlint-disable-next-line require-yield -- a generator that yields nothing still streams.
				cmd.action(async function* () {
					return 1;
				}),
			)
			.command("plain", (cmd) => cmd.action(() => 1));

		expect(await app.run(["stream"])).toMatchObject({ status: "completed", result: 1, events: [] });
		expect(await app.run(["plain"])).not.toHaveProperty("events");
		expect(outcomes).toEqual([
			{ status: "completed", result: 1, events: [] },
			{ status: "completed", result: 1 },
		]);
	});

	it("streams an async generator object a normal async action returns", async () => {
		async function* count() {
			yield "a";
			return "b";
		}
		const app = new Crust("cli").action(async () => count());

		expect(await app.run([])).toMatchObject({ status: "completed", result: "b", events: ["a"] });
	});

	it("treats an async iterable that is not a generator as an ordinary result", async () => {
		const iterable = {
			async *[Symbol.asyncIterator]() {
				yield 1;
			},
		};
		const app = new Crust("cli").action(() => iterable);

		const outcome = await app.run([]);

		expect(outcome).toMatchObject({ status: "completed" });
		expect(outcome.status === "completed" && outcome.result).toBe(iterable);
		expect(outcome).not.toHaveProperty("events");
	});

	it("fails on a throw mid-stream, keeping the events yielded before it", async () => {
		const outcomes: InvocationOutcome[] = [];
		const observe = defineExtension(defineExtensionId("observe")).postRun(
			(_ctx, outcome) => void outcomes.push(outcome),
		);
		const failure = new Error("boom");
		const app = new Crust("cli").extend(observe).action(async function* () {
			yield "first";
			throw failure;
		});

		expect(await app.run([])).toMatchObject({
			status: "failed",
			error: failure,
			events: ["first"],
		});
		expect(outcomes).toEqual([{ status: "failed", error: failure, events: ["first"] }]);
		const executed = await executeCrust(app, []);
		expect(executed.exitCode).toBe(1);
		expect(executed.stderr).toBe("Error: boom");
	});

	it("signals the renderer that a generator streams before its failure, and never for a normal action", async () => {
		const log: string[] = [];
		const app = new Crust("cli")
			.extend(loggingRenderer(log))
			.command("stream", (cmd) =>
				// oxlint-disable-next-line require-yield -- it throws before yielding on purpose.
				cmd.action(async function* () {
					throw new Error("early");
				}),
			)
			.command("plain", (cmd) =>
				cmd.action(() => {
					throw new Error("plain");
				}),
			);

		expect((await executeCrust(app, ["stream"])).exitCode).toBe(1);
		expect((await executeCrust(app, ["plain"])).exitCode).toBe(1);
		expect(log).toEqual(["stream", "error Error: early", "error Error: plain"]);
	});

	it("closes the generator and fails with the abort reason when the caller cancels", async () => {
		const controller = new AbortController();
		let finalized = false;
		const app = new Crust("cli").action(async function* () {
			try {
				yield 1;
				yield 2;
			} finally {
				finalized = true;
			}
		});

		const outcome = await app.run(
			[],
			{},
			{
				signal: controller.signal,
				onEvent: () => controller.abort(new DOMException("Caller cancelled.", "AbortError")),
			},
		);

		expect(outcome).toMatchObject({ status: "failed", error: { name: "AbortError" }, events: [1] });
		expect(finalized).toBe(true);
	});

	it("fails when the signal aborts during the generator's final step", async () => {
		const controller = new AbortController();
		const app = new Crust("cli").action(async function* () {
			yield 1;
			controller.abort(new DOMException("Caller cancelled.", "AbortError"));
			return 2;
		});

		const outcome = await app.run([], {}, { signal: controller.signal });

		expect(outcome).toMatchObject({ status: "failed", error: { name: "AbortError" }, events: [1] });
	});

	it("finishes a finally block that yields before postRun when the invocation is cancelled", async () => {
		const controller = new AbortController();
		const log: string[] = [];
		const observe = loggingRenderer(log).postRun(() => void log.push("postRun"));
		const app = new Crust("cli").extend(observe).action(async function* () {
			try {
				yield 1;
				yield 2;
			} finally {
				yield "closing";
				log.push("released");
			}
		});

		const outcome = await app.run(
			[],
			{},
			{ signal: controller.signal, onEvent: () => controller.abort() },
		);

		expect(outcome).toMatchObject({ status: "failed", events: [1] });
		// Values yielded while closing are not events.
		expect(log).toEqual(["stream", "renderer 1", "released", "postRun"]);
	});

	it("closes the generator and fails when the renderer's event throws", async () => {
		let finalized = false;
		const failure = new Error("renderer failed");
		const strict = loggingRenderer([], {
			event: () => {
				throw failure;
			},
		});
		const app = new Crust("cli").extend(strict).action(async function* () {
			try {
				yield 1;
				yield 2;
			} finally {
				finalized = true;
			}
		});

		expect(await app.run([])).toMatchObject({ status: "failed", error: failure, events: [1] });
		expect(finalized).toBe(true);
	});

	it("keeps the consumer's failure when closing the generator also throws", async () => {
		const consumer = new Error("consumer");
		const close = new Error("close");
		const app = new Crust("cli").action(async function* () {
			try {
				yield 1;
			} finally {
				// oxlint-disable-next-line no-unsafe-finally -- simulates a cleanup failure.
				throw close;
			}
		});

		const outcome = await app.run(
			[],
			{},
			{
				onEvent: () => {
					throw consumer;
				},
			},
		);

		expect(outcome.status).toBe("failed");
		const error = outcome.status === "failed" ? outcome.error : undefined;
		expect(error).toBeInstanceOf(SuppressedError);
		expect(error).toMatchObject({ error: close, suppressed: consumer });
	});

	it("exits 130 and prints the cleanup failure when closing a cancelled generator throws", async () => {
		const controller = new AbortController();
		const stderr: string[] = [];
		const app = new Crust("cli").action(async function* () {
			try {
				yield 1;
			} finally {
				// oxlint-disable-next-line no-unsafe-finally -- simulates a cleanup failure.
				throw new Error("close");
			}
		});

		const previous = process.exitCode;
		try {
			const exitCode = await app.execute({
				argv: [],
				io: { ...quiet, stderr: (text) => stderr.push(text) },
				signal: controller.signal,
				onEvent: () => controller.abort(new DOMException("Caller cancelled.", "AbortError")),
			});

			expect(exitCode).toBe(130);
			expect(stderr).toEqual(["Error: close"]);
		} finally {
			process.exitCode = previous;
		}
	});

	it("validates the returned value with .output()", async () => {
		const app = new Crust("cli").output(z.object({ count: z.number() })).action(async function* () {
			yield "progress";
			return { count: 1 };
		});
		const bad = new Crust("cli").output(z.number()).action(async function* () {
			yield "progress";
			// SAFETY: simulates a return value that escapes its declared type.
			return "1" as unknown as number;
		});

		expect(await app.run([])).toMatchObject({
			status: "completed",
			result: { count: 1 },
			events: ["progress"],
		});
		expect(await bad.run([])).toMatchObject({
			status: "failed",
			error: { code: "OUTPUT" },
			events: ["progress"],
		});
	});

	it("delivers events to execute()'s onEvent without printing them", async () => {
		const events: unknown[] = [];
		const stdout: string[] = [];
		const app = new Crust("cli").action(async function* () {
			yield { step: 1 };
			return "ok";
		});

		const exitCode = await app.execute({
			argv: [],
			io: { ...quiet, stdout: (text) => stdout.push(text) },
			onEvent: (event) => events.push(event),
		});

		expect(exitCode).toBe(0);
		expect(events).toEqual([{ step: 1 }]);
		expect(stdout).toEqual([]);
	});
});
