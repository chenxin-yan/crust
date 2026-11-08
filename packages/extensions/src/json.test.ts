import {
	type AnyCrust,
	Crust,
	CrustError,
	defineContext,
	defineExtension,
	defineExtensionId,
} from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";
import type { StandardSchema } from "@crustjs/utils/schema";
import { describe, expect, it } from "vite-plus/test";

import { help } from "./help.ts";
import { json } from "./json.ts";

class DeployError extends Error {
	override name = "DeployError";
	readonly region = "us-east-1";
}

function appReturning(result: () => unknown) {
	return new Crust("app").extend(json()).action(({ stdout }) => {
		stdout("working");
		return result();
	});
}

/** A Standard Schema without Standard JSON Schema support: declaring it is what counts. */
const anything: StandardSchema = {
	"~standard": { version: 1, vendor: "crust-test", validate: (value) => ({ value }) },
};

/** An app whose action prints for humans with `stdout()` and declares `.output()`. */
function outputAppReturning(result: () => unknown) {
	return new Crust("app")
		.extend(json())
		.output(anything)
		.action(({ stdout }) => {
			stdout("table row 1");
			stdout("table row 2");
			return result();
		});
}

const disposeFails = defineContext("resource").setup(() => ({
	[Symbol.dispose]() {
		throw new Error("dispose");
	},
}));

/** `execute()` with a caller signal, restoring the exit code it sets. */
async function executeWithSignal(app: AnyCrust, argv: string[], signal: AbortSignal) {
	const stdout: string[] = [];
	const stderr: string[] = [];
	const previous = process.exitCode;
	try {
		const exitCode = await app.execute({
			argv,
			io: { stdout: (line) => stdout.push(line), stderr: (line) => stderr.push(line) },
			signal,
		});
		return { stdout, stderr, exitCode };
	} finally {
		process.exitCode = previous;
	}
}

describe("json", () => {
	it("prints the action result as JSON on stdout and moves action output to stderr", async () => {
		const app = new Crust("app").extend(json()).action(({ stdout, stderr }) => {
			stdout("working");
			stderr("warning");
			return { id: 7, tags: ["a"] };
		});

		expect(await captureExecute(app, ["--json"])).toEqual({
			stdout: '{"id":7,"tags":["a"]}',
			stderr: "working\nwarning",
			exitCode: 0,
		});
	});

	// Core holds action-side output until the renderer is chosen after every setup.
	it.each(["json first", "json last"])(
		"moves Context stdout written in another Extension's setup to stderr (%s)",
		async (order) => {
			const logger = defineContext("logger").setup(({ stdout }) => {
				stdout("logger:setup");
				return stdout;
			});
			const early = defineExtension(defineExtensionId("early"))
				.provide(logger())
				.use(logger)
				.setup(async ({ ctx }) => void (await ctx.logger));
			const base = new Crust("app");
			const app = (
				order === "json first" ? base.extend(json(), early) : base.extend(early, json())
			).command("log", (cmd) =>
				cmd.use(logger).action(async ({ ctx }) => {
					(await ctx.logger)("logger:action");
					return { ok: true };
				}),
			);

			expect(await captureExecute(app, ["log", "--json"])).toEqual({
				stdout: '{"ok":true}',
				stderr: "logger:setup\nlogger:action",
				exitCode: 0,
			});
		},
	);

	it.each(["json first", "json last"])(
		"renders another Extension's setup failure as JSON after its Context output (%s)",
		async (order) => {
			const logger = defineContext("logger").setup(({ stdout }) => {
				stdout("logger:setup");
				return stdout;
			});
			const failing = defineExtension(defineExtensionId("failing"))
				.provide(logger())
				.use(logger)
				.setup(async ({ ctx }) => {
					await ctx.logger;
					throw new Error("setup failed");
				});
			const base = new Crust("app");
			const app = (
				order === "json first" ? base.extend(json(), failing) : base.extend(failing, json())
			).action(() => ({ ok: true }));

			expect(await captureExecute(app, ["--json"])).toEqual({
				stdout: "",
				stderr: 'logger:setup\n{"message":"setup failed"}',
				exitCode: 1,
			});
		},
	);

	it("changes nothing without --json", async () => {
		const app = appReturning(() => {
			throw new Error("boom");
		});

		expect(await captureExecute(app, [])).toEqual({
			stdout: "working",
			stderr: "Error: boom",
			exitCode: 1,
		});
		expect(
			await captureExecute(
				appReturning(() => ({ id: 7 })),
				[],
			),
		).toEqual({
			stdout: "working",
			stderr: "",
			exitCode: 0,
		});
	});

	it("documents --json in a root help section that subcommands do not repeat", async () => {
		const app = new Crust("app")
			.extend(json(), help())
			.command("deploy", (cmd) => cmd.action(() => {}));
		const snapshot = await app.snapshot();

		expect(snapshot.meta.sections).toEqual([
			expect.objectContaining({
				title: "JSON output",
				body: "--json prints the command's result as JSON on stdout (NDJSON for streaming commands). Other output goes to stderr; commands that declare an output schema print only the JSON.",
			}),
		]);
		expect((await captureExecute(app, ["--help"])).stdout).toContain("JSON output:");
		expect((await captureExecute(app, ["deploy", "--help"])).stdout).not.toContain("JSON output:");
	});

	it("prints nothing on stdout for an undefined result", async () => {
		const app = appReturning(() => undefined);

		expect(await captureExecute(app, ["--json"])).toEqual({
			stdout: "",
			stderr: "working",
			exitCode: 0,
		});
	});

	it("renders a CrustError as its toJSON() on stderr instead of the default Error line", async () => {
		const app = new Crust("app")
			.extend(json())
			.args({ name: "target", type: "string", required: true })
			.action(() => {});

		const { stdout, stderr, exitCode } = await captureExecute(app, ["--json"]);

		expect(stdout).toBe("");
		expect(exitCode).toBe(1);
		const error = JSON.parse(stderr);
		expect(error).toMatchObject({ code: "VALIDATION" });
		expect(error.message).toContain("target");
	});

	it("renders any other Error as only its message, never reading other fields", async () => {
		const app = appReturning(() => {
			throw new DeployError("region unavailable");
		});

		expect(await captureExecute(app, ["--json"])).toEqual({
			stdout: "",
			stderr: 'working\n{"message":"region unavailable"}',
			exitCode: 1,
		});
	});

	it.each([
		["a string", "plain failure", '{"message":"plain failure"}'],
		["undefined", undefined, '{"message":"undefined"}'],
	])("renders a thrown %s with String()", async (_label, thrown, line) => {
		const app = appReturning(() => {
			throw thrown;
		});

		expect(await captureExecute(app, ["--json"])).toEqual({
			stdout: "",
			stderr: `working\n${line}`,
			exitCode: 1,
		});
	});

	it.each([
		["a BigInt", () => 1n],
		[
			"a cycle",
			() => {
				const value: Record<string, unknown> = {};
				value.self = value;
				return value;
			},
		],
		["a function", () => ({ run: () => {} })],
		["a class instance", () => new Date(0)],
		["-0", () => -0],
	])("fails with one error JSON line when the result is %s", async (_label, result) => {
		const app = appReturning(result);

		const { stdout, stderr, exitCode } = await captureExecute(app, ["--json"]);

		expect(exitCode).toBe(1);
		expect(stdout).toBe("");
		const lines = stderr.split("\n");
		expect(lines).toHaveLength(2);
		expect(lines[0]).toBe("working");
		expect(JSON.parse(lines[1]!).message).toMatch(/^--json: the command result is not JSON data/);

		const ran = await app.run([], { flags: { json: true } });
		expect(ran).toMatchObject({ status: "failed", stdout: "", stderr: "working" });
		expect(ran.status === "failed" && (ran.error as Error).message).toMatch(
			/^--json: the command result is not JSON data/,
		);
	});

	// The serialization error fails the action, so postRun hooks see a failed outcome and a
	// throwing one cannot replace it.
	it.each(["json first", "other first"])(
		"renders the serialization error once beside another failing postRun (%s)",
		async (order) => {
			const other = defineExtension(defineExtensionId("other")).postRun(() => {
				throw new Error("other");
			});
			const base = new Crust("app");
			const app = (
				order === "json first" ? base.extend(json(), other) : base.extend(other, json())
			).action(() => 1n);

			const { stdout, stderr, exitCode } = await captureExecute(app, ["--json"]);

			expect(stdout).toBe("");
			expect(exitCode).toBe(1);
			expect(JSON.parse(stderr).message).toMatch(/^--json: the command result is not JSON data/);
		},
	);

	it.each(["json first", "help first"])(
		"leaves --help output on stdout whatever the .extend() order (%s)",
		async (order) => {
			const base = new Crust("app");
			const app = (
				order === "json first" ? base.extend(json(), help()) : base.extend(help(), json())
			).action(() => ({ ok: true }));

			const { stdout, stderr, exitCode } = await captureExecute(app, ["--json", "--help"]);

			expect(stdout).toContain("--json");
			expect(stdout).not.toContain('{"ok":true}');
			expect(stderr).toBe("");
			expect(exitCode).toBe(0);
		},
	);

	it("renders a Context disposal failure after the result once, as JSON", async () => {
		const app = new Crust("app")
			.extend(json())
			.provide(disposeFails())
			.action(async ({ ctx }) => {
				await ctx.resource;
				return { ok: true };
			});

		expect(await captureExecute(app, ["--json"])).toEqual({
			stdout: '{"ok":true}',
			stderr: '{"message":"dispose"}',
			exitCode: 1,
		});
		expect(await app.run([], { flags: { json: true } })).toMatchObject({
			status: "failed",
			stdout: '{"ok":true}',
			stderr: "",
		});
	});

	it("keeps the action's error JSON when Context disposal also fails", async () => {
		const app = new Crust("app")
			.extend(json())
			.provide(disposeFails())
			.action(async ({ ctx }) => {
				await ctx.resource;
				throw new Error("boom");
			});

		// Core renders the cleanup side itself after the action error was rendered.
		expect(await captureExecute(app, ["--json"])).toEqual({
			stdout: "",
			stderr: '{"message":"boom"}\nCleanup failed: dispose',
			exitCode: 1,
		});
	});

	it("renders a validation error as JSON when an unknown command is a parent action's positional", async () => {
		const app = new Crust("app")
			.extend(json())
			.command("deploy", (cmd) => cmd.action(() => {}))
			.action(() => {});

		const { stderr, exitCode } = await captureExecute(app, ["nope", "--json"]);

		expect(JSON.parse(stderr)).toMatchObject({ code: "VALIDATION" });
		expect(exitCode).toBe(1);
	});

	it.each([
		["routing", ["nope", "--json"]],
		["argv syntax", ["deploy", "--json", "--unknown"]],
	])("falls back to the default renderer when %s fails before flags are bound", async (_, argv) => {
		const app = new Crust("app").extend(json()).command("deploy", (cmd) => cmd.action(() => {}));

		const { stderr, exitCode } = await captureExecute(app, argv);

		expect(stderr).toMatch(/^Error: /);
		expect(exitCode).toBe(1);
	});

	describe("commands with .output()", () => {
		it("prints only the JSON result, dropping stdout() text", async () => {
			const app = outputAppReturning(() => ({ id: 7 }));

			expect(await captureExecute(app, ["--json"])).toEqual({
				stdout: '{"id":7}',
				stderr: "",
				exitCode: 0,
			});
			expect(await app.run([], { flags: { json: true } })).toEqual({
				status: "completed",
				result: { id: 7 },
				stdout: '{"id":7}',
				stderr: "",
			});
		});

		it("changes nothing without --json", async () => {
			expect(
				await captureExecute(
					outputAppReturning(() => ({ id: 7 })),
					[],
				),
			).toEqual({ stdout: "table row 1\ntable row 2", stderr: "", exitCode: 0 });
		});

		it("writes held text to stderr, in order, for an undefined result", async () => {
			expect(
				await captureExecute(
					outputAppReturning(() => undefined),
					["--json"],
				),
			).toEqual({ stdout: "", stderr: "table row 1\ntable row 2", exitCode: 0 });
		});

		it("writes held text to stderr before the error JSON", async () => {
			const app = outputAppReturning(() => {
				throw new Error("boom");
			});

			expect(await captureExecute(app, ["--json"])).toEqual({
				stdout: "",
				stderr: 'table row 1\ntable row 2\n{"message":"boom"}',
				exitCode: 1,
			});
		});

		it("writes held text to stderr before a serialization error", async () => {
			const { stdout, stderr, exitCode } = await captureExecute(
				outputAppReturning(() => 1n),
				["--json"],
			);

			expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
			const lines = stderr.split("\n");
			expect(lines.slice(0, 2)).toEqual(["table row 1", "table row 2"]);
			expect(JSON.parse(lines[2]!).message).toMatch(/^--json: the command result is not JSON data/);
		});

		it("keeps stderr() lines live while stdout() text is held", async () => {
			const log: string[] = [];
			const app = new Crust("app")
				.extend(json())
				.flags({ empty: { type: "boolean" } })
				.output(anything)
				.action(({ stdout, stderr, flags }) => {
					stdout("held");
					stderr("live");
					log.push("resumed");
					return flags.empty ? undefined : { ok: true };
				});
			const io = {
				stdout: (line: string) => log.push(line),
				stderr: (line: string) => log.push(`stderr:${line}`),
			};

			await app.execute({ argv: ["--json"], io });
			expect(log.splice(0)).toEqual(["stderr:live", "resumed", '{"ok":true}']);
			await app.execute({ argv: ["--json", "--empty"], io });
			expect(log).toEqual(["stderr:live", "resumed", "stderr:held"]);
		});

		it("streams NDJSON and drops held text once the result line has data", async () => {
			const app = new Crust("app")
				.extend(json())
				.output(anything)
				.action(async function* ({ stdout }) {
					stdout("working");
					yield 1;
					return { synced: 1 };
				});

			expect(await captureExecute(app, ["--json"])).toEqual({
				stdout: '{"type":"event","data":1}\n{"type":"result","data":{"synced":1}}',
				stderr: "",
				exitCode: 0,
			});
		});

		it("writes held text to stderr when a generator returns nothing", async () => {
			const app = new Crust("app")
				.extend(json())
				.output(anything)
				.action(async function* ({ stdout }) {
					stdout("working");
					yield 1;
				});

			expect(await captureExecute(app, ["--json"])).toEqual({
				stdout: '{"type":"event","data":1}\n{"type":"result"}',
				stderr: "working",
				exitCode: 0,
			});
		});

		it("writes held text to stderr when a run() invocation fails", async () => {
			const failure = new Error("boom");
			const app = outputAppReturning(() => {
				throw failure;
			});

			expect(await app.run([], { flags: { json: true } })).toEqual({
				status: "failed",
				error: failure,
				stdout: "",
				stderr: "table row 1\ntable row 2",
			});
		});

		it("writes held text to stderr after a failure another Extension claims", async () => {
			const claimer = defineExtension(defineExtensionId("claimer")).onError((_error, ctx) => {
				ctx.stderr("claimed");
				return true;
			});
			const app = new Crust("app")
				.extend(json(), claimer)
				.output(anything)
				.action(({ stdout }) => {
					stdout("working");
					throw new Error("boom");
				});

			expect(await captureExecute(app, ["--json"])).toEqual({
				stdout: "",
				stderr: "claimed\nworking",
				exitCode: 1,
			});
		});

		it("writes held text to stderr when the action is cancelled", async () => {
			const controller = new AbortController();
			const app = new Crust("app")
				.extend(json())
				.output(anything)
				.action(({ stdout, signal }) => {
					stdout("working");
					controller.abort(new DOMException("Caller cancelled.", "AbortError"));
					signal.throwIfAborted();
				});

			expect(await executeWithSignal(app, ["--json"], controller.signal)).toEqual({
				stdout: [],
				stderr: ["working"],
				exitCode: 130,
			});
		});

		it.each(["json first", "json last"])(
			"writes held Context text to stderr when an earlier setup is cancelled (%s)",
			async (order) => {
				const controller = new AbortController();
				const logger = defineContext("logger").setup(({ stdout }) => {
					stdout("logger:setup");
					return stdout;
				});
				const cancelling = defineExtension(defineExtensionId("cancelling"))
					.provide(logger())
					.use(logger)
					.setup(async ({ ctx, signal }) => {
						await ctx.logger;
						controller.abort(new DOMException("Caller cancelled.", "AbortError"));
						signal.throwIfAborted();
					});
				const base = new Crust("app");
				const app = (
					order === "json first" ? base.extend(json(), cancelling) : base.extend(cancelling, json())
				)
					.output(anything)
					.action(() => ({ ok: true }));

				expect(await executeWithSignal(app, ["--json"], controller.signal)).toEqual({
					stdout: [],
					stderr: ["logger:setup"],
					exitCode: 130,
				});
			},
		);

		it("discards late disposer text after a result, and writes it to stderr after a flush", async () => {
			const closing = defineContext("closing").setup(({ stdout }) => ({
				[Symbol.dispose]() {
					stdout("closed");
				},
			}));
			const app = new Crust("app")
				.extend(json())
				.provide(closing())
				.flags({ empty: { type: "boolean" } })
				.output(anything)
				.action(async ({ ctx, stdout, flags }) => {
					await ctx.closing;
					stdout("working");
					return flags.empty ? undefined : { ok: true };
				});

			expect(await captureExecute(app, ["--json"])).toEqual({
				stdout: '{"ok":true}',
				stderr: "",
				exitCode: 0,
			});
			expect(await captureExecute(app, ["--json", "--empty"])).toEqual({
				stdout: "",
				stderr: "working\nclosed",
				exitCode: 0,
			});
		});
	});

	describe("generator actions", () => {
		it("streams each event as an NDJSON line, then one result line", async () => {
			const app = new Crust("app").extend(json()).action(async function* ({ stdout }) {
				stdout("working");
				yield { file: "a" };
				yield "b";
				return { synced: 2 };
			});

			expect(await captureExecute(app, ["--json"])).toEqual({
				stdout: [
					'{"type":"event","data":{"file":"a"}}',
					'{"type":"event","data":"b"}',
					'{"type":"result","data":{"synced":2}}',
				].join("\n"),
				stderr: "working",
				exitCode: 0,
			});
			expect(await captureExecute(app, [])).toEqual({ stdout: "working", stderr: "", exitCode: 0 });
		});

		it("writes each event line as it is yielded", async () => {
			const log: string[] = [];
			const app = new Crust("app").extend(json()).action(async function* () {
				yield 1;
				log.push("resumed");
				return 2;
			});

			await app.execute({
				argv: ["--json"],
				io: { stdout: (line) => log.push(line), stderr: (line) => log.push(`stderr:${line}`) },
			});

			expect(log).toEqual(['{"type":"event","data":1}', "resumed", '{"type":"result","data":2}']);
		});

		it("still ends with one result line for zero events and an undefined result", async () => {
			const app = new Crust("app").extend(json()).action(async function* () {});

			expect(await captureExecute(app, ["--json"])).toEqual({
				stdout: '{"type":"result"}',
				stderr: "",
				exitCode: 0,
			});
		});

		it("ends a failed stream with one error line on stdout instead of stderr JSON", async () => {
			const app = new Crust("app").extend(json()).action(async function* () {
				yield 1;
				throw new CrustError("PARSE", "bad value");
			});

			expect(await captureExecute(app, ["--json"])).toEqual({
				stdout: [
					'{"type":"event","data":1}',
					'{"type":"error","error":{"code":"PARSE","message":"bad value"}}',
				].join("\n"),
				stderr: "",
				exitCode: 1,
			});
		});

		it.each([
			["a BigInt", 1n],
			["undefined", undefined],
		])(
			"fails with an error line and closes the generator when an event is %s",
			async (_label, event) => {
				let closed = false;
				const app = new Crust("app").extend(json()).action(async function* () {
					try {
						yield 1;
						yield event;
						return 2;
					} finally {
						closed = true;
					}
				});

				const { stdout, stderr, exitCode } = await captureExecute(app, ["--json"]);

				expect(exitCode).toBe(1);
				expect(stderr).toBe("");
				const lines = stdout.split("\n");
				expect(lines).toHaveLength(2);
				expect(lines[0]).toBe('{"type":"event","data":1}');
				expect(JSON.parse(lines[1]!)).toMatchObject({
					type: "error",
					error: { message: expect.stringMatching(/^--json: an event is not JSON data/) },
				});
				expect(closed).toBe(true);
			},
		);

		it("fails with an error line when the returned result is not JSON data", async () => {
			const app = new Crust("app").extend(json()).action(async function* () {
				yield 1;
				return 1n;
			});

			const { stdout, exitCode } = await captureExecute(app, ["--json"]);

			expect(exitCode).toBe(1);
			const lines = stdout.split("\n");
			expect(lines).toHaveLength(2);
			expect(JSON.parse(lines[1]!)).toMatchObject({
				type: "error",
				error: { message: expect.stringMatching(/^--json: the command result is not JSON data/) },
			});
		});

		// Stdout already ended with the result line, so a later failure must not add a second final line.
		it("renders a failure after the result line as error JSON on stderr", async () => {
			const app = new Crust("app")
				.extend(json())
				.provide(disposeFails())
				.action(async function* ({ ctx }) {
					await ctx.resource;
					yield "opened";
					return { ok: true };
				});

			expect(await captureExecute(app, ["--json"])).toEqual({
				stdout: '{"type":"event","data":"opened"}\n{"type":"result","data":{"ok":true}}',
				stderr: '{"message":"dispose"}',
				exitCode: 1,
			});
		});

		it("renders a failure before the generator starts as stderr JSON", async () => {
			const app = new Crust("app")
				.extend(json())
				.args({ name: "target", type: "string", required: true })
				.action(async function* () {
					yield 1;
				});

			const { stdout, stderr, exitCode } = await captureExecute(app, ["--json"]);

			expect(stdout).toBe("");
			expect(exitCode).toBe(1);
			expect(JSON.parse(stderr)).toMatchObject({ code: "VALIDATION" });
		});

		it("captures the stream under run() and leaves failures to outcome.error", async () => {
			const failure = new Error("boom");
			const app = new Crust("app").extend(json()).action(async function* () {
				yield 1;
				throw failure;
			});

			expect(await app.run([], { flags: { json: true } })).toEqual({
				status: "failed",
				error: failure,
				events: [1],
				stdout: '{"type":"event","data":1}',
				stderr: "",
			});
		});
	});

	it("captures the result on stdout under run() and leaves failures to outcome.error", async () => {
		const ok = appReturning(() => [1, 2]);
		expect(await ok.run([], { flags: { json: true } })).toEqual({
			status: "completed",
			result: [1, 2],
			stdout: "[1,2]",
			stderr: "working",
		});

		const failure = new CrustError("PARSE", "bad value");
		const failing = appReturning(() => {
			throw failure;
		});
		expect(await failing.run([], { flags: { json: true } })).toEqual({
			status: "failed",
			error: failure,
			stdout: "",
			stderr: "working",
		});
	});
});
