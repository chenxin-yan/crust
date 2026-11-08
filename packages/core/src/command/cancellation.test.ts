import { describe, expect, it, beforeEach, afterEach, onTestFinished, vi } from "vite-plus/test";

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

	it("execute({ signal }) keeps exit code 130 when SIGTERM arrives after the caller cancelled", async () => {
		const before = process.listenerCount("SIGTERM");
		const controller = new AbortController();
		const started = Promise.withResolvers<void>();
		const released = Promise.withResolvers<void>();
		const exitCode = new Crust("cli")
			.action(async ({ signal }) => {
				started.resolve();
				await released.promise;
				signal.throwIfAborted();
			})
			.execute({ argv: [], io: quiet, signal: controller.signal });

		await started.promise;
		expect(process.listenerCount("SIGTERM")).toBe(before + 1);
		controller.abort(new DOMException("Caller cancelled.", "AbortError"));
		// Invoke Core's listener directly: emitting a real SIGTERM would reach the test runner.
		process.listeners("SIGTERM").at(-1)!("SIGTERM");
		released.resolve();

		expect(await exitCode).toBe(130);
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

	it.each([
		["SIGINT", 130],
		["SIGTERM", 143],
	] as const)(
		"execute() keeps the %s exit code %i when Context disposal fails after it",
		async (name, code) => {
			const { ready, action } = awaitingSignal();
			const seen: unknown[] = [];
			const stderr: string[] = [];
			const resource = defineContext("resource").setup(({ defer }) => {
				defer(() => {
					throw new Error("db close failed");
				});
			});
			const exitCode = new Crust("cli")
				.provide(resource())
				.extend(
					defineExtension(defineExtensionId("errors")).onError((error) => {
						seen.push(error);
					}),
				)
				.action(async (ctx) => {
					await ctx.ctx.resource;
					return action(ctx);
				})
				.execute({ argv: [], io: { stdout() {}, stderr: (text) => stderr.push(text) } });

			await ready;
			// Invoke Core's listener directly: emitting a real signal would reach the test runner.
			process.listeners(name).at(-1)!(name);

			expect(await exitCode).toBe(code);
			expect(process.exitCode).toBe(code);
			expect(seen).toHaveLength(1);
			expect((seen[0] as Error).name).toBe("AbortError");
			expect(stderr).toEqual(["Cleanup failed: db close failed"]);
		},
	);

	it("execute() keeps exit code 130 and renders only the dispose failure when an action's await using fails while aborting", async () => {
		const { ready, action } = awaitingSignal();
		const controller = new AbortController();
		const seen: unknown[] = [];
		const stderr: string[] = [];
		const exitCode = new Crust("cli")
			.extend(
				defineExtension(defineExtensionId("errors")).onError((error) => {
					seen.push(error);
				}),
			)
			.action(async (ctx) => {
				await using _connection = {
					async [Symbol.asyncDispose]() {
						throw new Error("connection close failed");
					},
				};
				return await action(ctx);
			})
			.execute({
				argv: [],
				io: { stdout() {}, stderr: (text) => stderr.push(text) },
				signal: controller.signal,
			});

		await ready;
		controller.abort(new DOMException("Caller cancelled.", "AbortError"));

		expect(await exitCode).toBe(130);
		expect(process.exitCode).toBe(130);
		expect(seen).toHaveLength(1);
		expect((seen[0] as Error).name).toBe("SuppressedError");
		expect(stderr).toEqual(["Error: connection close failed"]);
	});

	it("renders a cancellation's cleanup failure as Core's lines, never through a renderer's error", async () => {
		const { ready, action } = awaitingSignal();
		const controller = new AbortController();
		const rendered: unknown[] = [];
		const stderr: string[] = [];
		const exitCode = new Crust("cli")
			.extend(
				defineExtension(defineExtensionId("render")).renderer((ctx) => ({
					text: ctx.stdout,
					diag: ctx.stderr,
					error: (error) => rendered.push(error),
				})),
			)
			.action(async (ctx) => {
				await using _connection = {
					async [Symbol.asyncDispose]() {
						throw new Error("connection close failed");
					},
				};
				return await action(ctx);
			})
			.execute({
				argv: [],
				io: { stdout() {}, stderr: (text) => stderr.push(text) },
				signal: controller.signal,
			});

		await ready;
		controller.abort(new DOMException("Caller cancelled.", "AbortError"));

		expect(await exitCode).toBe(130);
		expect(rendered).toEqual([]);
		expect(stderr).toEqual(["Error: connection close failed"]);
	});

	it("execute() keeps exit code 130 when an onError hook rendering a postRun AbortError resets process.exitCode", async () => {
		const exitCode = await new Crust("cli")
			.extend(
				defineExtension(defineExtensionId("late-abort"))
					.postRun(() => {
						throw new DOMException("Cancelled during postRun.", "AbortError");
					})
					.onError(() => {
						process.exitCode = 0;
					}),
			)
			.action(() => {})
			.execute({ argv: [], io: quiet });

		expect(exitCode).toBe(130);
		expect(process.exitCode).toBe(130);
	});

	it("execute() exits 1 for an action's SuppressedError that does not wrap cancellation", async () => {
		const stderr: string[] = [];
		const exitCode = await new Crust("cli")
			.action(async () => {
				await using _connection = {
					async [Symbol.asyncDispose]() {
						throw new Error("connection close failed");
					},
				};
				throw new Error("query failed");
			})
			.execute({ argv: [], io: { stdout() {}, stderr: (text) => stderr.push(text) } });

		expect(exitCode).toBe(1);
		expect(process.exitCode).toBe(1);
		expect(stderr).toEqual(["Error: connection close failed\nError: query failed"]);
	});

	it.each([
		["SIGINT", 130, "Interrupted by SIGINT."],
		["SIGTERM", 143, "Terminated by SIGTERM."],
	] as const)(
		"execute() turns the first %s into an AbortError on ctx.signal, exits %i and keeps listening until the invocation settles",
		async (name, code, message) => {
			const before = process.listenerCount(name);
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
					listenersDuringCleanup = process.listenerCount(name);
				}
			});
			const exitCode = app.execute({ argv: [], io: quiet });

			await ready;
			expect(process.listenerCount(name)).toBe(before + 1);
			// Invoke Core's listener directly: emitting a real signal would reach the test runner.
			process.listeners(name).at(-1)!(name);
			cleanedUp.resolve();

			expect(await exitCode).toBe(code);
			expect(reason).toMatchObject({ name: "AbortError", message });
			expect(listenersDuringCleanup).toBe(before + 1);
			expect(process.listenerCount(name)).toBe(before);
		},
	);

	it("a second SIGINT removes Core's listener and leaves termination to any remaining listener", async () => {
		vi.useFakeTimers({ toFake: ["performance"] });
		onTestFinished(() => void vi.useRealTimers());
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
			vi.advanceTimersByTime(51);
			core("SIGINT");
			expect(process.listenerCount("SIGINT")).toBe(before);
			expect(process.listeners("SIGINT")).toContain(guard);
			released.resolve();
			expect(await exitCode).toBe(130);
		} finally {
			process.removeListener("SIGINT", guard);
		}
	});

	it("treats a SIGINT within 50 ms of the first as the same Ctrl-C relayed by a parent", async () => {
		vi.useFakeTimers({ toFake: ["performance"] });
		onTestFinished(() => void vi.useRealTimers());
		const guard = () => {};
		process.on("SIGINT", guard);
		onTestFinished(() => void process.removeListener("SIGINT", guard));
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
		await ready;
		const core = process.listeners("SIGINT").at(-1)!;
		core("SIGINT");
		// `npm run` relays the terminal's SIGINT: the same press arrives again immediately.
		vi.advanceTimersByTime(1);
		core("SIGINT");
		expect(process.listenerCount("SIGINT")).toBe(before + 1);
		vi.advanceTimersByTime(200);
		core("SIGINT");
		expect(process.listenerCount("SIGINT")).toBe(before);
		released.resolve();
		expect(await exitCode).toBe(130);
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
