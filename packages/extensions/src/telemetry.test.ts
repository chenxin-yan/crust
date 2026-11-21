import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { Crust, defineCommand } from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { help } from "./help.ts";
import { json } from "./json.ts";
import { readSavedSetting } from "./telemetry-setting.ts";
import { type TelemetryEvent, type TelemetryOptions, telemetry } from "./telemetry.ts";

// Passes through; one test makes the read slow to show it is not counted as the command's duration.
vi.mock("./telemetry-setting.ts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./telemetry-setting.ts")>();
	return { ...actual, readSavedSetting: vi.fn(actual.readSavedSetting) };
});

const ENV = "ACME_TELEMETRY";

function recorder() {
	return vi.fn<TelemetryOptions["send"]>(async () => {});
}

describe("telemetry", () => {
	// Every test gets its own config directory (XDG_CONFIG_HOME on Linux and macOS, APPDATA on
	// Windows), so no saved setting leaks in from the machine or another test.
	let configHome: string;
	beforeEach(() => {
		configHome = mkdtempSync(join(tmpdir(), "crust-telemetry-"));
		vi.stubEnv("XDG_CONFIG_HOME", configHome);
		vi.stubEnv("APPDATA", configHome);
		vi.stubEnv("DO_NOT_TRACK", undefined);
		vi.stubEnv("CI", undefined);
		vi.stubEnv(ENV, undefined);
	});
	afterEach(() => {
		vi.unstubAllEnvs();
		rmSync(configHome, { recursive: true, force: true });
	});

	const savedFile = () => join(configHome, "acme", "telemetry.json");
	function writeSaved(content: string) {
		mkdirSync(dirname(savedFile()), { recursive: true });
		writeFileSync(savedFile(), content);
	}

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

		it("ends the duration when postRun starts, before the saved setting is read", async () => {
			vi.mocked(readSavedSetting).mockImplementationOnce(
				() => new Promise((resolve) => setTimeout(() => resolve(undefined), 300)),
			);
			const send = recorder();
			await new Crust("acme")
				.extend(telemetry({ env: ENV, enabled: "opt-out", send }))
				.action(() => {})
				.run([]);
			expect(readSavedSetting).toHaveBeenCalled();
			expect(send.mock.calls[0]![0].durationMs).toBeLessThan(150);
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

	const deploy = defineCommand("deploy", (cmd) => cmd.action(() => {}));

	describe("which setting wins", () => {
		const SAVED_ON = '{"telemetry":"on"}';
		const SAVED_OFF = '{"telemetry":"off"}';
		// Only a missing file means nothing is saved; anything but exactly one valid key is unreadable.
		const MALFORMED = [
			"{not json",
			"{}",
			'{"typo":"off"}',
			'{"telemetry":"on","x":1}',
			'{"telemetry":true}',
			"null",
			"[]",
		];

		// [case, DO_NOT_TRACK, app variable, saved file, opt-in result, opt-out result]
		it.each([
			[
				"DO_NOT_TRACK over a saved on",
				"1",
				"1",
				SAVED_ON,
				[false, "do-not-track"],
				[false, "do-not-track"],
			],
			[
				"the variable's 0 over a saved on",
				undefined,
				"0",
				SAVED_ON,
				[false, "env"],
				[false, "env"],
			],
			[
				"the variable's FALSE over a saved on",
				undefined,
				"FALSE",
				SAVED_ON,
				[false, "env"],
				[false, "env"],
			],
			[
				"the variable's 1 over a saved off",
				undefined,
				"1",
				SAVED_OFF,
				[true, "env"],
				[true, "env"],
			],
			[
				"the variable's 1 over an unreadable file",
				undefined,
				"1",
				"{}",
				[true, "env"],
				[true, "env"],
			],
			["a saved on over the mode", "0", "", SAVED_ON, [true, "saved"], [true, "saved"]],
			[
				"a saved off over the mode",
				undefined,
				undefined,
				SAVED_OFF,
				[false, "saved"],
				[false, "saved"],
			],
			...MALFORMED.map(
				(file) =>
					[
						`the unreadable file ${file}, which sends nothing`,
						undefined,
						undefined,
						file,
						[false, "saved"],
						[false, "saved"],
					] as const,
			),
			[
				"the mode when nothing decides",
				undefined,
				undefined,
				undefined,
				[false, "default"],
				[true, "default"],
			],
		] as const)(
			"%s: status reports it and postRun follows it",
			async (_case, doNotTrack, variable, file, optIn, optOut) => {
				vi.stubEnv("DO_NOT_TRACK", doNotTrack);
				vi.stubEnv(ENV, variable);
				if (file !== undefined) writeSaved(file);
				const saved = file === SAVED_ON ? "on" : file === SAVED_OFF ? "off" : "unreadable";
				for (const [enabled, [sending, decidedBy]] of [
					["opt-in", optIn],
					["opt-out", optOut],
				] as const) {
					const send = recorder();
					const app = new Crust("acme").extend(telemetry({ env: ENV, enabled, send })).add(deploy);
					const status = await app.run(["telemetry"]);
					expect(status.status === "completed" && status.result, `${enabled} status`).toEqual({
						sending,
						decidedBy,
						...(file === undefined ? {} : { saved }),
						default: enabled === "opt-out" ? "on" : "off",
					});
					expect((await app.run(["deploy"])).status).toBe("completed");
					expect(send.mock.calls.length, `${enabled} deploy`).toBe(sending ? 1 : 0);
				}
			},
		);
	});

	describe("the telemetry command", () => {
		const app = (send = recorder()) =>
			new Crust("acme")
				.extend(telemetry({ env: ENV, enabled: "opt-out", send, command: "analytics" }), json())
				.add(deploy);

		it("shows, saves, and reports the state under its configured name", async () => {
			expect(await captureExecute(app(), ["analytics"])).toEqual({
				stdout: "Telemetry is on (the default). Turn it off with: acme analytics disable",
				stderr: "",
				exitCode: 0,
			});
			expect((await captureExecute(app(), ["analytics", "disable"])).stdout).toBe(
				"Saved telemetry preference: off.",
			);
			expect(JSON.parse(readFileSync(savedFile(), "utf8"))).toEqual({ telemetry: "off" });
			expect((await captureExecute(app(), ["analytics", "status"])).stdout).toBe(
				"Telemetry is off (saved preference). Turn it on with: acme analytics enable",
			);
			expect((await captureExecute(app(), ["analytics", "--json"])).stdout).toBe(
				'{"sending":false,"decidedBy":"saved","saved":"off","default":"on"}',
			);
			expect((await captureExecute(app(), ["analytics", "enable"])).stdout).toBe(
				"Saved telemetry preference: on.",
			);
			expect((await captureExecute(app(), ["analytics", "enable", "--json"])).stdout).toBe(
				'{"sending":true,"decidedBy":"saved","saved":"on","default":"on"}',
			);
			expect((await captureExecute(app(), ["analytics"])).stdout).toBe(
				"Telemetry is on (saved preference). Turn it off with: acme analytics disable",
			);
		});

		it("says the default and how to turn it on under opt-in", async () => {
			const optIn = new Crust("acme").extend(
				telemetry({ env: ENV, enabled: "opt-in", send: recorder() }),
			);
			expect((await captureExecute(optIn, ["telemetry"])).stdout).toBe(
				"Telemetry is off (the default). Turn it on with: acme telemetry enable",
			);
		});

		it("separates the saved preference from a variable that decides this run, never printing its value", async () => {
			const sentinel = "sentinel-5be1";
			vi.stubEnv(ENV, sentinel);
			const outputs = [await captureExecute(app(), ["analytics"])];
			expect(outputs[0]!.stdout).toBe(
				"Telemetry is on for this run because ACME_TELEMETRY is set.",
			);
			outputs.push(await captureExecute(app(), ["analytics", "disable"]));
			expect(outputs[1]!.stdout).toBe(
				"Saved telemetry preference: off.\nTelemetry stays on for this run because ACME_TELEMETRY is set.",
			);
			expect(JSON.parse(readFileSync(savedFile(), "utf8"))).toEqual({ telemetry: "off" });
			outputs.push(await captureExecute(app(), ["analytics"]));
			expect(outputs[2]!.stdout).toBe(
				"Telemetry is on for this run because ACME_TELEMETRY is set.\nThe saved preference is off.",
			);
			vi.stubEnv(ENV, "0");
			outputs.push(await captureExecute(app(), ["analytics"]));
			expect(outputs[3]!.stdout).toBe(
				"Telemetry is off for this run because ACME_TELEMETRY is set.\nThe saved preference is off.",
			);
			vi.stubEnv(ENV, sentinel);

			vi.stubEnv("DO_NOT_TRACK", "1");
			outputs.push(await captureExecute(app(), ["analytics"]));
			expect(outputs[4]!.stdout).toBe(
				"Telemetry is off because DO_NOT_TRACK is set.\nThe saved preference is off.",
			);
			outputs.push(await captureExecute(app(), ["analytics", "enable", "--json"]));
			expect(outputs[5]!.stdout).toBe(
				'{"sending":false,"decidedBy":"do-not-track","saved":"on","default":"on"}',
			);
			outputs.push(await captureExecute(app(), ["analytics", "enable"]));
			expect(outputs[6]!.stdout).toBe(
				"Saved telemetry preference: on.\nTelemetry stays off for this run because DO_NOT_TRACK is set.",
			);
			expect(JSON.stringify(outputs)).not.toContain(sentinel);
		});

		it("never changes the saved setting through the variable", async () => {
			writeSaved('{"telemetry":"off"}');
			vi.stubEnv(ENV, "1");
			const send = recorder();
			await captureExecute(app(send), ["deploy"]);
			expect(send).toHaveBeenCalledTimes(1);
			expect(readFileSync(savedFile(), "utf8")).toBe('{"telemetry":"off"}');
		});

		it.skipIf(process.platform === "win32")(
			"creates a private file and directory, and leaves an existing directory's mode alone",
			async () => {
				await captureExecute(app(), ["analytics", "disable"]);
				expect(statSync(dirname(savedFile())).mode & 0o777).toBe(0o700);
				expect(statSync(savedFile()).mode & 0o777).toBe(0o600);

				rmSync(dirname(savedFile()), { recursive: true });
				mkdirSync(dirname(savedFile()), { mode: 0o755 });
				await captureExecute(app(), ["analytics", "enable"]);
				expect(statSync(dirname(savedFile())).mode & 0o777).toBe(0o755);
				expect(statSync(savedFile()).mode & 0o777).toBe(0o600);
			},
		);

		it("reports a failed save as an error that names the variable, and claims nothing changed", async () => {
			// A file where the directory should be: neither mkdir nor the write can succeed.
			writeFileSync(join(configHome, "acme"), "");
			for (const [verb, value, state] of [
				["disable", "0", "off"],
				["enable", "1", "on"],
			] as const) {
				const result = await captureExecute(app(), ["analytics", verb]);
				expect(result.exitCode, verb).toBe(1);
				expect(result.stdout, verb).toBe("");
				expect(result.stderr, verb).toContain(
					`Could not save the telemetry preference to ${savedFile()}:`,
				);
				expect(result.stderr, verb).toContain(
					`Set ACME_TELEMETRY=${value} to turn telemetry ${state} without a saved preference.`,
				);
				expect(result.stderr, verb).not.toMatch(/Saved telemetry preference/);
			}
		});

		it("removes its temporary file when the rename fails", async () => {
			// A directory in the file's place: the temporary file is written, then cannot replace it.
			mkdirSync(savedFile(), { recursive: true });
			expect((await captureExecute(app(), ["analytics", "disable"])).exitCode).toBe(1);
			expect(readdirSync(dirname(savedFile()))).toEqual(["telemetry.json"]);
			expect((await captureExecute(app(), ["analytics", "--json"])).stdout).toBe(
				'{"sending":false,"decidedBy":"saved","saved":"unreadable","default":"on"}',
			);
		});
	});

	describe("the control command's own invocations", () => {
		it.each([undefined, "1"])(
			"send no event with ACME_TELEMETRY=%j, even when they fail or show help; other commands still send",
			async (variable) => {
				vi.stubEnv(ENV, variable);
				const send = recorder();
				const app = new Crust("acme")
					.extend(help(), json(), telemetry({ env: ENV, enabled: "opt-out", send }))
					.add(deploy);
				expect((await captureExecute(app, ["deploy"])).exitCode).toBe(0);
				for (const argv of [
					["telemetry"],
					["telemetry", "--json"],
					["telemetry", "status"],
					["telemetry", "enable"],
					["telemetry", "disable"],
					["telemetry", "--help"],
					["telemetry", "disable", "--help"],
					["telemetry", "nope"],
				]) {
					await captureExecute(app, argv);
				}
				rmSync(join(configHome, "acme"), { recursive: true });
				writeFileSync(join(configHome, "acme"), "");
				expect((await captureExecute(app, ["telemetry", "disable"])).exitCode).toBe(1);
				expect(send.mock.calls.map(([event]) => event.command)).toEqual([["acme", "deploy"]]);
			},
		);

		it("still reports an app's own command named telemetry once the Extension's is renamed", async () => {
			const send = recorder();
			const app = new Crust("acme")
				.extend(telemetry({ env: ENV, enabled: "opt-out", send, command: "analytics" }))
				.add(defineCommand("telemetry", (cmd) => cmd.action(() => {})));
			await captureExecute(app, ["analytics"]);
			await captureExecute(app, ["telemetry"]);
			expect(send.mock.calls.map(([event]) => event.command)).toEqual([["acme", "telemetry"]]);
		});
	});

	describe("a damaged saved setting", () => {
		it.each([
			["a file that is not JSON", "{not json"],
			["an object without the key", "{}"],
			["a value other than on or off", '{"telemetry":"maybe"}'],
			["a root that is not an object", "[]"],
		])(
			"%s sends nothing, never fails the command, and status says how to fix it",
			async (_case, content) => {
				writeSaved(content);
				const send = recorder();
				const app = new Crust("acme")
					.extend(telemetry({ env: ENV, enabled: "opt-out", send }), json())
					.add(defineCommand("deploy", (cmd) => cmd.action(() => "done")));

				expect(await app.run(["deploy"])).toMatchObject({ status: "completed", result: "done" });
				expect(send).not.toHaveBeenCalled();
				const fix = `Run "acme telemetry enable" or "acme telemetry disable" to rewrite ${savedFile()}.`;
				expect(await captureExecute(app, ["telemetry"])).toEqual({
					stdout: `Telemetry is off: the saved preference could not be read.\n${fix}`,
					stderr: "",
					exitCode: 0,
				});
				expect((await captureExecute(app, ["telemetry", "--json"])).stdout).toBe(
					'{"sending":false,"decidedBy":"saved","saved":"unreadable","default":"on"}',
				);

				// A variable that decides the run still shows the note.
				vi.stubEnv("DO_NOT_TRACK", "1");
				expect((await captureExecute(app, ["telemetry"])).stdout).toBe(
					`Telemetry is off because DO_NOT_TRACK is set.\nThe saved preference could not be read. ${fix}`,
				);
				vi.stubEnv("DO_NOT_TRACK", undefined);

				expect((await captureExecute(app, ["telemetry", "enable"])).stdout).toBe(
					"Saved telemetry preference: on.",
				);
				expect(JSON.parse(readFileSync(savedFile(), "utf8"))).toEqual({ telemetry: "on" });
				await app.run(["deploy"]);
				expect(send).toHaveBeenCalledTimes(1);
			},
		);

		it("explains a config directory that cannot be resolved without failing, and does not promise a rewrite", async () => {
			vi.stubEnv("XDG_CONFIG_HOME", "relative");
			vi.stubEnv("APPDATA", "relative");
			vi.stubEnv("HOME", "relative");
			vi.stubEnv("USERPROFILE", "relative");
			const send = recorder();
			const app = new Crust("acme")
				.extend(telemetry({ env: ENV, enabled: "opt-out", send }), json())
				.add(deploy);

			expect((await captureExecute(app, ["deploy"])).exitCode).toBe(0);
			expect(send).not.toHaveBeenCalled();
			const status = await captureExecute(app, ["telemetry"]);
			expect(status.exitCode).toBe(0);
			expect(status.stdout).toMatch(
				/^Telemetry is off: the saved preference could not be read\.\nCannot resolve the config directory: .*not absolute.*\.$/,
			);
			expect(status.stdout).not.toContain("enable");
			expect((await captureExecute(app, ["telemetry", "--json"])).stdout).toBe(
				'{"sending":false,"decidedBy":"saved","saved":"unreadable","default":"on"}',
			);
			const disable = await captureExecute(app, ["telemetry", "disable"]);
			expect(disable.exitCode).toBe(1);
			expect(disable.stderr).toContain(
				"Could not save the telemetry preference: Cannot resolve the config directory:",
			);
			expect(disable.stderr).toContain(
				"Set ACME_TELEMETRY=0 to turn telemetry off without a saved preference.",
			);
		});
	});
});
