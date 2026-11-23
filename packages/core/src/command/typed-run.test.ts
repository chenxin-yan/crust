import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { Equal, Expect } from "../../tests/helpers.ts";
import { lineSink, unwrap } from "../../tests/helpers.ts";
import { defineExtension, type Extension } from "../api/extension.ts";
import { defineExtensionId } from "../identity.ts";
import { Crust, defineCommand } from "./crust.ts";
import type { CommandShapeAt, RunInput, RunOutcome } from "./typed-run.ts";

// A command whose type is not statically known may be an async generator action.
type OpenEvents = readonly unknown[] | undefined;
interface StructuredRunCapture {
	args: { name: string; count: number; files: string[] };
	flags: {
		fetch: boolean | undefined;
		tag: string[] | undefined;
		config: unknown;
		offset: number | undefined;
	};
}
describe("typed programmatic invocation", () => {
	it("runs statically known Extension commands, aliases, flags, and typed results", async () => {
		const tools = defineExtension(defineExtensionId("tools"))
			.flags({ trace: { type: "boolean" }, version: { type: "boolean", recursive: false } })
			.add(
				defineCommand("inspect", { aliases: ["scan"] }, (command) =>
					command.action(() => ({ kind: "extension" as const })),
				),
			);
		const local = defineCommand("local", (command) => command.action(() => {}));
		const app = new Crust("cli").extend(tools).add(local);

		type RootInput = RunInput<(typeof app)["_types"]["shape"]>;
		type InspectInput = RunInput<
			CommandShapeAt<(typeof app)["_types"]["shape"], readonly ["inspect"]>
		>;
		type LocalInput = RunInput<CommandShapeAt<(typeof app)["_types"]["shape"], readonly ["local"]>>;
		const rootFlags: RootInput = { flags: { trace: true, version: true } };
		const commandFlags: InspectInput = { flags: { trace: true } };
		const localFlags: LocalInput = { flags: { trace: true } };
		const rootOnlyOnChild: LocalInput = {
			flags: {
				// @ts-expect-error -- recursive:false Extension flags stay on the root input
				version: true,
			},
		};
		void [rootFlags, commandFlags, localFlags, rootOnlyOnChild];

		const pending = app.run(["scan"], { flags: { trace: true } });
		type _result = Expect<Equal<typeof pending, Promise<RunOutcome<{ kind: "extension" }>>>>;
		expect(await pending).toMatchObject({ status: "completed", result: { kind: "extension" } });
	});

	it("opens child results when a later Extension can replace any canonical child", async () => {
		const lit = defineExtension(defineExtensionId("lit")).add(
			defineCommand("inspect", (command) => command.action(() => ({ kind: "lit" as const }))),
		);
		const widened: Extension = defineExtension(defineExtensionId("dyn")).add(
			defineCommand("generated", (command) => command.action(() => {})),
		);
		const app = new Crust("cli").extend(lit, widened);

		const pending = app.run(["inspect"], {});
		type _result = Expect<Equal<typeof pending, Promise<RunOutcome<unknown, OpenEvents>>>>;
		expect(await pending).toMatchObject({ status: "completed", result: { kind: "lit" } });
	});

	it("runtime-checks paths below commands a widened tree can no longer see into", async () => {
		const nested = defineExtension(defineExtensionId("nested")).add(
			defineCommand("bar", (command) =>
				command.command("sub", (sub) => sub.action(() => "sub-s" as const)),
			),
		);
		const widened: Extension = defineExtension(defineExtensionId("dyn")).add(
			defineCommand("generated", (command) => command.action(() => {})),
		);
		const trace = defineExtension(defineExtensionId("trace")).flags({
			trace: { type: "boolean" },
		});
		const app = new Crust("cli").extend(nested).extend(widened);

		const sub = app.run(["bar", "sub"]);
		type _sub = Expect<Equal<typeof sub, Promise<RunOutcome<unknown, OpenEvents>>>>;
		expect(await sub).toMatchObject({ status: "completed", result: "sub-s" });
		const handle = app.at(["bar", "sub"]).run();
		type _handle = Expect<Equal<typeof handle, Promise<RunOutcome<unknown, OpenEvents>>>>;
		expect(await handle).toMatchObject({ status: "completed", result: "sub-s" });
		// Inherited recursive flags rewrite the open entries' flags but leave them open.
		const traced = app.extend(trace).run(["bar", "sub"], { flags: { trace: true } });
		type _traced = Expect<Equal<typeof traced, Promise<RunOutcome<unknown, OpenEvents>>>>;
		expect(await traced).toMatchObject({ status: "completed", result: "sub-s" });
		const missing = app.run(["anything", "nested"]);
		type _missing = Expect<Equal<typeof missing, Promise<RunOutcome<unknown, OpenEvents>>>>;
		expect(await missing).toMatchObject({
			status: "failed",
			error: { code: "COMMAND_NOT_FOUND" },
		});
	});

	it("surfaces delayed Extension recipe failures only when the command is used", async () => {
		const app = new Crust("cli").extend(
			defineExtension(defineExtensionId("failure")).add(
				defineCommand("child", () => {
					throw new Error("recipe failed");
				}),
			),
		);
		// Listing a missing command reads only the child's static metadata.
		expect(await app.run([])).toMatchObject({
			status: "failed",
			error: { code: "VALIDATION", message: "Missing command. Available: child" },
		});
		await expect(unwrap(app.run(["child"]))).rejects.toThrow("recipe failed");
		await expect(app.snapshot()).rejects.toThrow("recipe failed");
	});

	it("binds structured input directly against the selected command", async () => {
		let received: StructuredRunCapture | undefined;
		const remoteAdd = defineCommand("remote-add", (command) =>
			command
				.args(
					{ name: "name", type: "string", required: true },
					{ name: "count", type: "number", required: true },
					{ name: "files", type: "string", variadic: true },
				)
				.flags({
					fetch: { type: "boolean" },
					tag: { type: "string", multiple: true },
					config: { type: "json" },
					offset: { type: "number" },
				})
				.action(({ args, flags }) => {
					received = { args, flags };
				}),
		);
		const app = new Crust("git").add(remoteAdd).extend(
			defineExtension(defineExtensionId("argv")).preRun((ctx) => {
				expect(ctx.argv).toEqual(["remote-add"]);
			}),
		);

		await unwrap(
			app.run(["remote-add"], {
				args: { name: "origin", count: 2, files: ["a.ts", "b.ts"] },
				flags: { fetch: true, tag: ["one", "-two"], config: { force: true }, offset: -3 },
			}),
		);

		expect(received).toEqual({
			args: { name: "origin", count: 2, files: ["a.ts", "b.ts"] },
			flags: { fetch: true, tag: ["one", "-two"], config: { force: true }, offset: -3 },
		});
	});

	describe("flag env bindings", () => {
		afterEach(() => vi.unstubAllEnvs());

		const app = new Crust("cli")
			.flags({
				token: { type: "string", env: { name: "CRUST_TEST_TOKEN" }, required: true },
				port: { type: "number", env: { name: "CRUST_TEST_PORT" }, default: 1 },
			})
			.action(({ flags }) => flags);

		it("fill omitted flags from process.env, after supplied values and before defaults", async () => {
			vi.stubEnv("CRUST_TEST_TOKEN", "s3cret");
			// `token` is optional in typed input: its variable may supply it.
			expect(await app.run([], {})).toMatchObject({
				status: "completed",
				result: { token: "s3cret", port: 1 },
			});
			expect(await app.run([], { flags: { token: "given" } })).toMatchObject({
				result: { token: "given" },
			});
			vi.stubEnv("CRUST_TEST_PORT", "many");
			await expect(unwrap(app.run([], {}))).rejects.toThrow(
				"Expected a number for --port (from $CRUST_TEST_PORT).",
			);
			vi.stubEnv("CRUST_TEST_TOKEN", undefined);
			vi.stubEnv("CRUST_TEST_PORT", undefined);
			await expect(unwrap(app.run([], { flags: { port: 2 } }))).rejects.toThrow(
				'Missing required flag "--token"',
			);
		});

		it("let execute() read process.env", async () => {
			vi.stubEnv("CRUST_TEST_TOKEN", "from-shell");
			const echo = new Crust("cli")
				.flags({ token: { type: "string", env: { name: "CRUST_TEST_TOKEN" }, required: true } })
				.action(({ flags, stdout }) => stdout(flags.token));
			const output: string[] = [];
			const io = { stdout: lineSink(output), stderr: lineSink(output) };
			const exitCode = process.exitCode;
			try {
				expect(await echo.execute({ argv: [], io })).toBe(0);
				vi.stubEnv("CRUST_TEST_TOKEN", undefined);
				expect(await echo.execute({ argv: [], io })).toBe(2);
			} finally {
				process.exitCode = exitCode;
			}
			expect(output[0]).toBe("from-shell");
			expect(output.join("\n")).toContain('Missing required flag "--token"');
		});
	});

	it("rejects unknown structured arguments and flags", async () => {
		const app = new Crust("cli").args({ name: "source", type: "string" }).action(() => {});

		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
		await expect(unwrap(app.run([], { args: { bogus: "x" } }))).rejects.toMatchObject({
			code: "PARSE",
			details: { reason: "unknown-argument", argument: "bogus" },
		});
		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
		await expect(unwrap(app.run([], { flags: { bogus: true } }))).rejects.toMatchObject({
			code: "PARSE",
			details: { reason: "unknown-flag", flag: "bogus" },
		});
	});

	it("throws COMMAND_NOT_FOUND for path elements the router cannot consume", async () => {
		const app = new Crust("cli")
			.args({ name: "source", type: "string" })
			.action(() => {})
			.add(
				defineCommand("visible", (command) => command.action(() => {})),
				defineCommand("internal", { hidden: true }, (command) => command.action(() => {})),
			);

		// @ts-expect-error -- deliberately exercise an unknown command path.
		await expect(unwrap(app.run(["missing"]))).rejects.toMatchObject({
			code: "COMMAND_NOT_FOUND",
			details: { input: "missing", available: ["visible"] },
		});
	});
});

describe('variadic: "afterDoubleDash" arguments', () => {
	function taskRunner() {
		const received: unknown[] = [];
		const binder = defineExtension(defineExtensionId("dd-binder"))
			.flags({ bind: { type: "boolean" } })
			.preRun((ctx) => {
				if (ctx.flags.bind) ctx.bindInput({ args: { extra: ["--bound"] } });
			});
		const app = new Crust("mono").extend(binder).add(
			defineCommand("run", (command) =>
				command
					.args(
						{ name: "task", type: "string", required: true },
						{ name: "pkgs", type: "string", variadic: true },
						{ name: "extra", type: "string", variadic: "afterDoubleDash" },
					)
					.action(({ args }) => {
						type _extra = Expect<Equal<typeof args.extra, string[]>>;
						received.push(args);
					}),
			),
		);
		return { app, received };
	}

	it("splits `run <task> [pkgs...] -- <extra...>` on argv", async () => {
		const { app, received } = taskRunner();
		const stderr: string[] = [];
		const io = { stdout: { write() {} }, stderr: lineSink(stderr) };
		expect(await app.execute({ argv: ["run", "build", "core", "--", "--watch", "src"], io })).toBe(
			0,
		);
		expect(await app.execute({ argv: ["run", "--", "build"], io })).toBe(2);
		expect(stderr.join("\n")).toContain('Missing required argument "<task>"');
		expect(received).toEqual([{ task: "build", pkgs: ["core"], extra: ["--watch", "src"] }]);
	});

	it("takes it by name from run() and bindInput, with earlier arguments omitted", async () => {
		const { app, received } = taskRunner();
		expect(await app.run(["run"], { args: { task: "build", extra: ["--watch"] } })).toMatchObject({
			status: "completed",
		});
		expect(
			await app.execute({ argv: ["run", "build", "--bind"], io: { stdout: { write() {} } } }),
		).toBe(0);
		expect(received).toEqual([
			{ task: "build", pkgs: [], extra: ["--watch"] },
			{ task: "build", pkgs: [], extra: ["--bound"] },
		]);
	});
});
