import {
	Crust,
	CrustError,
	defineContext,
	defineExtension,
	defineExtensionId,
} from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";
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

const disposeFails = defineContext("resource").setup(() => ({
	[Symbol.dispose]() {
		throw new Error("dispose");
	},
}));

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
