import { describe, expect, it, beforeEach, afterEach } from "vite-plus/test";

import { Crust, defineContext, defineExtension, defineExtensionId } from "../index.ts";

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

	it("run() cancels Context setup and waits for its registered cleanup", async () => {
		const { ready, action: waitForSignal } = awaitingSignal();
		const controller = new AbortController();
		let cleanedUp = false;
		const resource = defineContext("resource").setup(async ({ signal, defer }) => {
			defer(async () => {
				await Promise.resolve();
				cleanedUp = true;
			});
			return waitForSignal({ signal });
		});
		const outcome = new Crust("cli")
			.provide(resource())
			.action(({ ctx }) => ctx.resource)
			.run([], {}, { signal: controller.signal });

		await ready;
		controller.abort();
		expect(await outcome).toMatchObject({ status: "failed", error: controller.signal.reason });
		expect(cleanedUp).toBe(true);
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

	it("keeps a caller's non-AbortError reason and renders it as an ordinary failure", async () => {
		const { ready, action } = awaitingSignal();
		const controller = new AbortController();
		const stderr: string[] = [];
		const exitCode = new Crust("cli").action(action).execute({
			argv: [],
			io: { stdout() {}, stderr: (text) => stderr.push(text) },
			signal: controller.signal,
		});

		await ready;
		controller.abort(new Error("deadline exceeded"));

		expect(await exitCode).toBe(1);
		expect(stderr).toEqual(["Error: deadline exceeded"]);
	});

	it("execute() turns the first SIGINT into an AbortError on ctx.signal and keeps listening until the invocation settles", async () => {
		const before = process.listenerCount("SIGINT");
		const { ready, action } = awaitingSignal();
		let reason: unknown;
		const cleanedUp = Promise.withResolvers<void>();
		let listenersDuringCleanup = -1;
		const app = new Crust("cli").action(async (ctx) => {
			try {
				await action(ctx);
			} finally {
				reason = ctx.signal.reason;
				await cleanedUp.promise;
				// A one-shot handler that re-raises when nobody listens (progress spinner) must still see Core here.
				listenersDuringCleanup = process.listenerCount("SIGINT");
			}
		});
		const exitCode = app.execute({ argv: [], io: quiet });

		await ready;
		expect(process.listenerCount("SIGINT")).toBe(before + 1);
		// Invoke Core's listener directly: emitting a real SIGINT would reach the test runner.
		process.listeners("SIGINT").at(-1)!("SIGINT");
		cleanedUp.resolve();

		expect(await exitCode).toBe(130);
		expect((reason as Error).name).toBe("AbortError");
		expect(listenersDuringCleanup).toBe(before + 1);
		expect(process.listenerCount("SIGINT")).toBe(before);
	});

	it("a second SIGINT removes Core's listener and leaves termination to any remaining listener", async () => {
		// Guard listener: without it Core would re-raise SIGINT into the test runner.
		const guard = () => {};
		process.on("SIGINT", guard);
		const before = process.listenerCount("SIGINT");
		const { ready, action } = awaitingSignal();
		const released = Promise.withResolvers<void>();
		const app = new Crust("cli").action(async (ctx) => {
			try {
				await action(ctx);
			} finally {
				await released.promise;
			}
		});
		const exitCode = app.execute({ argv: [], io: quiet });
		try {
			await ready;
			const core = process.listeners("SIGINT").at(-1)!;
			core("SIGINT");
			expect(process.listenerCount("SIGINT")).toBe(before + 1);
			core("SIGINT");
			expect(process.listenerCount("SIGINT")).toBe(before);
			expect(process.listeners("SIGINT")).toContain(guard);
			released.resolve();
			expect(await exitCode).toBe(130);
		} finally {
			process.removeListener("SIGINT", guard);
		}
	});

	it("shares one signal between Context setups, Extension hooks and the action, including the onError fallback context", async () => {
		const seen: AbortSignal[] = [];
		const dependency = defineContext("dependency").setup(({ signal }) => {
			seen.push(signal);
		});
		const resource = defineContext("resource")
			.use(dependency)
			.setup(async ({ ctx, signal }) => {
				seen.push(signal);
				await ctx.dependency;
			});
		const probe = defineExtension(defineExtensionId("probe"))
			.preRun((ctx) => {
				seen.push(ctx.signal);
			})
			.onError((_error, ctx) => {
				seen.push(ctx.signal);
				return true;
			});
		const app = new Crust("cli")
			.extend(probe)
			.provide(dependency(), resource())
			.action(async ({ ctx, signal }) => {
				seen.push(signal);
				await ctx.resource;
			});

		await app.execute({ argv: [], io: quiet });
		expect(seen).toHaveLength(4);
		for (const signal of seen) expect(signal).toBe(seen[0]!);

		seen.length = 0;
		await app.execute({ argv: ["--bogus"], io: quiet });
		expect(seen).toHaveLength(1);
		expect(seen[0]).toBeInstanceOf(AbortSignal);
	});
});
