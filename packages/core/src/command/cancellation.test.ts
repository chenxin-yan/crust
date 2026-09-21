import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { Crust, defineExtension, defineExtensionId } from "../index.ts";

const quiet = { stdout() {}, stderr() {} };

/** Resolves once the action has started and is awaiting `ctx.signal`. */
function awaitingSignal() {
	let started!: () => void;
	const ready = new Promise<void>((resolve) => {
		started = resolve;
	});
	const action = ({ signal }: { signal: AbortSignal }) =>
		new Promise<never>((_, reject) => {
			signal.addEventListener("abort", () => reject(signal.reason), { once: true });
			started();
		});
	return { ready, action };
}

describe("invocation cancellation signal", () => {
	let originalExitCode: number | string | null | undefined;

	beforeEach(() => {
		originalExitCode = process.exitCode;
		process.exitCode = 0;
	});

	afterEach(() => {
		process.exitCode = originalExitCode ?? 0;
	});

	it("gives every invocation a signal that never aborts unless a caller cancels", async () => {
		let seen: AbortSignal | undefined;
		const app = new Crust("cli").action(({ signal }) => {
			seen = signal;
		});

		expect(await app.run([])).toMatchObject({ status: "completed" });
		expect(seen).toBeInstanceOf(AbortSignal);
		expect(seen?.aborted).toBe(false);
	});

	it("run() forwards the caller signal and reports its AbortError as a failed outcome", async () => {
		const { ready, action } = awaitingSignal();
		const controller = new AbortController();
		const outcome = new Crust("cli").action(action).run([], {}, { signal: controller.signal });

		await ready;
		controller.abort(new DOMException("Caller cancelled.", "AbortError"));

		expect(await outcome).toMatchObject({ status: "failed" });
		const failed = await outcome;
		expect(failed.status === "failed" && (failed.error as Error).name).toBe("AbortError");
		expect(process.exitCode).toBe(0);
	});

	it("execute({ signal }) cancels silently with exit code 130", async () => {
		const { ready, action } = awaitingSignal();
		const controller = new AbortController();
		const stderr: string[] = [];
		const exitCode = new Crust("cli").action(action).execute({
			argv: [],
			io: { stdout() {}, stderr: (text) => stderr.push(text) },
			signal: controller.signal,
		});

		await ready;
		controller.abort(new DOMException("Caller cancelled.", "AbortError"));

		expect(await exitCode).toBe(130);
		expect(process.exitCode).toBe(130);
		expect(stderr).toEqual([]);
	});

	it("execute() installs no SIGINT listener by default", async () => {
		const before = process.listenerCount("SIGINT");
		let during = -1;
		await new Crust("cli")
			.action(() => {
				during = process.listenerCount("SIGINT");
			})
			.execute({ argv: [], io: quiet });

		expect(during).toBe(before);
	});

	it('execute({ sigint: "abort" }) turns the first SIGINT into an AbortError on ctx.signal, then releases the listener', async () => {
		const before = process.listenerCount("SIGINT");
		const { ready, action } = awaitingSignal();
		let reason: unknown;
		const app = new Crust("cli").action(async (ctx) => {
			try {
				await action(ctx);
			} finally {
				reason = ctx.signal.reason;
			}
		});
		const exitCode = app.execute({ argv: [], io: quiet, sigint: "abort" });

		await ready;
		expect(process.listenerCount("SIGINT")).toBe(before + 1);
		// Invoke Core's listener directly: emitting a real SIGINT would reach the test runner.
		process.listeners("SIGINT").at(-1)!("SIGINT");

		expect(await exitCode).toBe(130);
		expect((reason as Error).name).toBe("AbortError");
		expect(process.listenerCount("SIGINT")).toBe(before);
	});

	it("shares one signal between Extension hooks and the action, including the onError fallback context", async () => {
		const seen: AbortSignal[] = [];
		const probe = defineExtension(defineExtensionId("probe"), {
			hooks: {
				preRun(ctx) {
					seen.push(ctx.signal);
				},
				onError(_error, ctx) {
					seen.push(ctx.signal);
					return true;
				},
			},
		});
		const app = new Crust("cli").extend(probe).action(({ signal }) => {
			seen.push(signal);
		});

		await app.execute({ argv: [], io: quiet });
		expect(seen).toHaveLength(2);
		expect(seen[0]).toBe(seen[1]);

		seen.length = 0;
		await app.execute({ argv: ["--bogus"], io: quiet });
		expect(seen).toHaveLength(1);
		expect(seen[0]).toBeInstanceOf(AbortSignal);
	});
});
