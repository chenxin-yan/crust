import { Crust, defineCommand } from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { help } from "./help.ts";
import { type TelemetryEvent, type TelemetryOptions, telemetry } from "./telemetry.ts";

const ENV = "ACME_TELEMETRY";

function recorder() {
	return vi.fn<TelemetryOptions["send"]>(async () => {});
}

describe("telemetry", () => {
	beforeEach(() => {
		vi.stubEnv("DO_NOT_TRACK", undefined);
		vi.stubEnv("CI", undefined);
		vi.stubEnv(ENV, undefined);
	});
	afterEach(() => vi.unstubAllEnvs());

	describe("outcomes", () => {
		it("sends one completed event with the command path, duration, and ci", async () => {
			const send = recorder();
			const app = new Crust("acme")
				.extend(telemetry({ env: ENV, enabled: "opt-out", send }))
				.add(defineCommand("deploy", (cmd) => cmd.action(() => "done")));

			expect((await captureExecute(app, ["deploy"])).exitCode).toBe(0);
			expect(send).toHaveBeenCalledTimes(1);
			expect(send).toHaveBeenCalledWith(
				{
					command: ["acme", "deploy"],
					outcome: "completed",
					durationMs: expect.any(Number),
					ci: false,
				},
				{ signal: expect.any(AbortSignal) },
			);
			const event = send.mock.calls[0]![0];
			expect(Number.isInteger(event.durationMs)).toBe(true);
			expect(event.durationMs).toBeGreaterThanOrEqual(0);
		});

		it("measures from setup to postRun", async () => {
			const send = recorder();
			const app = new Crust("acme")
				.extend(telemetry({ env: ENV, enabled: "opt-out", send }))
				.action(() => new Promise((resolve) => setTimeout(resolve, 50)));

			await app.run([]);
			expect(send.mock.calls[0]![0].durationMs).toBeGreaterThanOrEqual(45);
		});

		it("reports a failed action as failed and keeps the failure", async () => {
			const send = recorder();
			const app = new Crust("acme")
				.extend(telemetry({ env: ENV, enabled: "opt-out", send }))
				.action(() => {
					throw new Error("boom");
				});

			const outcome = await app.run([]);
			expect(outcome.status).toBe("failed");
			expect(send.mock.calls.map(([event]) => event.outcome)).toEqual(["failed"]);
		});

		it("reports --help and an actionless command under help() as handled", async () => {
			const send = recorder();
			const app = new Crust("acme")
				.extend(help())
				.extend(telemetry({ env: ENV, enabled: "opt-out", send }))
				.add(defineCommand("deploy", (cmd) => cmd.action(() => {})));

			await captureExecute(app, ["deploy", "--help"]);
			await captureExecute(app, []);
			expect(send.mock.calls.map(([event]) => [event.command, event.outcome])).toEqual([
				[["acme", "deploy"], "handled"],
				[["acme"], "handled"],
			]);
		});

		it("reports a run cancelled through its signal as failed, or completed when the action ignored it", async () => {
			const send = recorder();
			const controller = new AbortController();
			const cancelled = new Crust("acme")
				.extend(telemetry({ env: ENV, enabled: "opt-out", send }))
				.action(({ signal }) => {
					controller.abort(new DOMException("Interrupted by SIGINT.", "AbortError"));
					signal.throwIfAborted();
				});
			expect((await cancelled.run([], {}, { signal: controller.signal })).status).toBe("failed");

			const ignoring = new AbortController();
			const ignored = new Crust("acme")
				.extend(telemetry({ env: ENV, enabled: "opt-out", send }))
				.action(() => {
					ignoring.abort(new DOMException("Interrupted by SIGINT.", "AbortError"));
				});
			expect((await ignored.run([], {}, { signal: ignoring.signal })).status).toBe("completed");

			expect(send.mock.calls.map(([event]) => event.outcome)).toEqual(["failed", "completed"]);
		});

		const deployApp = (send: TelemetryOptions["send"]) =>
			new Crust("acme").extend(telemetry({ env: ENV, enabled: "opt-out", send })).add(
				defineCommand("deploy", (cmd) =>
					cmd
						.args({ name: "target", type: "string", required: true })
						.flags({ replicas: { type: "number", description: "Replicas" } })
						.action(() => {}),
				),
			);

		it.each([
			["an unknown command", ["nope"], 'Error: Unknown command "nope".'],
			["an unknown flag", ["deploy", "prod", "--nope"], 'Error: Unknown flag "--nope"'],
		])("sends no event for %s, which fails before setup", async (_case, argv, stderr) => {
			const send = recorder();
			const result = await captureExecute(deployApp(send), argv);
			expect(result).toMatchObject({ exitCode: 1, stderr: expect.stringContaining(stderr) });
			expect(send).not.toHaveBeenCalled();
		});

		it.each([
			["a missing required argument", ["deploy"], 'Error: Missing required argument "<target>"'],
			[
				"a flag value of the wrong type",
				["deploy", "prod", "--replicas", "many"],
				"Error: Expected a number for --replicas.",
			],
		])("reports %s as failed: it is checked after setup", async (_case, argv, stderr) => {
			const send = recorder();
			const result = await captureExecute(deployApp(send), argv);
			expect(result).toMatchObject({ exitCode: 1, stderr: expect.stringContaining(stderr) });
			expect(send.mock.calls.map(([event]) => [event.command, event.outcome])).toEqual([
				[["acme", "deploy"], "failed"],
			]);
		});

		it("reports ci from the CI variable", async () => {
			vi.stubEnv("CI", "true");
			const send = recorder();
			await new Crust("acme")
				.extend(telemetry({ env: ENV, enabled: "opt-out", send }))
				.action(() => {})
				.run([]);
			expect(send.mock.calls[0]![0].ci).toBe(true);
		});
	});

	describe("switches", () => {
		async function sent(enabled: TelemetryOptions["enabled"]): Promise<boolean> {
			const send = recorder();
			await new Crust("acme")
				.extend(telemetry({ env: ENV, enabled, send }))
				.action(() => {})
				.run([]);
			return send.mock.calls.length === 1;
		}

		it.each([
			[undefined, false, true],
			["", false, true],
			["1", true, true],
			["yes", true, true],
			["0", false, false],
			["false", false, false],
			["FALSE", false, false],
			["False", false, false],
		])("the app variable %j: opt-in sends %s, opt-out sends %s", async (value, optIn, optOut) => {
			vi.stubEnv(ENV, value);
			expect(await sent("opt-in")).toBe(optIn);
			expect(await sent("opt-out")).toBe(optOut);
		});

		it.each(["1", "true", "false", "yes"])(
			"DO_NOT_TRACK=%j wins over the app variable in both modes",
			async (value) => {
				vi.stubEnv("DO_NOT_TRACK", value);
				vi.stubEnv(ENV, "1");
				expect(await sent("opt-in")).toBe(false);
				expect(await sent("opt-out")).toBe(false);
			},
		);

		it.each(["0", ""])("DO_NOT_TRACK=%j does not opt out", async (value) => {
			vi.stubEnv("DO_NOT_TRACK", value);
			expect(await sent("opt-out")).toBe(true);
		});
	});

	describe("send failures", () => {
		it("swallows a send that throws or rejects without changing the outcome", async () => {
			const throwing = vi.fn<TelemetryOptions["send"]>(() => {
				throw new Error("sync");
			});
			const rejecting = vi.fn<TelemetryOptions["send"]>(async () => {
				throw new Error("async");
			});
			for (const send of [throwing, rejecting]) {
				const app = new Crust("acme")
					.extend(telemetry({ env: ENV, enabled: "opt-out", send }))
					.action(() => "ok");
				expect(await captureExecute(app, [])).toEqual({ stdout: "", stderr: "", exitCode: 0 });
				expect(await app.run([])).toMatchObject({ status: "completed", result: "ok" });
			}
			expect(throwing).toHaveBeenCalledTimes(2);
			expect(rejecting).toHaveBeenCalledTimes(2);
		});

		it("aborts send's signal and stops waiting after 1 s; a send that ignores it and rejects later stays handled", async () => {
			const unhandled = vi.fn();
			process.on("unhandledRejection", unhandled);
			try {
				const rejected = Promise.withResolvers<void>();
				let signal: AbortSignal | undefined;
				const send = vi.fn<TelemetryOptions["send"]>((_event, options) => {
					signal = options.signal;
					return new Promise((_resolve, reject) =>
						setTimeout(() => {
							reject(new Error("late"));
							rejected.resolve();
						}, 1_500),
					);
				});
				const app = new Crust("acme")
					.extend(telemetry({ env: ENV, enabled: "opt-out", send }))
					.action(() => {});

				const started = performance.now();
				expect((await captureExecute(app, [])).exitCode).toBe(0);
				const elapsed = performance.now() - started;
				expect(elapsed).toBeGreaterThanOrEqual(950);
				expect(elapsed).toBeLessThan(1_400);
				expect(signal?.aborted).toBe(true);
				expect(signal?.reason).toMatchObject({ name: "TimeoutError" });

				// Node reports an unhandled rejection after the microtasks of the turn that rejected it.
				await rejected.promise;
				await new Promise((resolve) => setImmediate(resolve));
				expect(unhandled).not.toHaveBeenCalled();
			} finally {
				process.off("unhandledRejection", unhandled);
			}
		});
	});

	it("never puts argument or flag values in the event", async () => {
		const sentinel = "sentinel-7f3a";
		const events: TelemetryEvent[] = [];
		const app = new Crust("acme")
			.extend(
				telemetry({
					env: ENV,
					enabled: "opt-out",
					send: async (event) => {
						events.push(event);
					},
				}),
			)
			.add(
				defineCommand("deploy", (cmd) =>
					cmd
						.args({ name: "target", type: "string", required: true })
						.flags({ name: { type: "string", description: "Name" } })
						.action(() => {}),
				),
			)
			.add(defineCommand("status", (cmd) => cmd.action(() => {})));

		// "status" is a sibling command's name passed as the positional value.
		await captureExecute(app, ["deploy", "status", "--name", sentinel]);
		await captureExecute(app, ["deploy", sentinel, `--name=${sentinel}`]);
		expect(events.map((event) => event.command)).toEqual([
			["acme", "deploy"],
			["acme", "deploy"],
		]);
		expect(JSON.stringify(events)).not.toContain(sentinel);
		expect(
			events.every((event) => Object.keys(event).sort().join() === "ci,command,durationMs,outcome"),
		).toBe(true);
	});
});
