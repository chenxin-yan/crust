import { describe, expect, it } from "bun:test";

import type { Equal, Expect } from "../../tests/helpers.ts";
import { defineExtension, type Extension } from "../api/extension.ts";
import { defineExtensionId } from "../identity.ts";
import type { CommandShapeAt, RunInput, RunOutcome } from "./crust.ts";
import { Crust, defineCommand } from "./crust.ts";
interface StructuredRunCapture {
	args: { name: string; count: number; files: string[] };
	flags: {
		fetch: boolean | undefined;
		tag: string[] | undefined;
		config: unknown;
		offset: number | undefined;
	};
	rawArgs: string[];
}
interface JsonRunCapture {
	args: { payload: unknown };
	flags: { config: unknown };
}
describe("typed programmatic invocation", () => {
	it("returns the selected action result with path-specific types", async () => {
		const inspect = defineCommand("inspect", (command) =>
			command.action(() => ({ kind: "child" as const, size: 42 })),
		);
		const app = new Crust("cli").action(() => ({ kind: "root" as const })).add(inspect);

		const rootResult = app.run([]);
		const childResult = app.run(["inspect"]);
		type _root = Expect<Equal<typeof rootResult, Promise<RunOutcome<{ kind: "root" }>>>>;
		type _child = Expect<
			Equal<typeof childResult, Promise<RunOutcome<{ kind: "child"; size: number }>>>
		>;

		expect(await rootResult).toEqual({ status: "completed", result: { kind: "root" } });
		expect(await childResult).toEqual({
			status: "completed",
			result: { kind: "child", size: 42 },
		});
	});

	it("runs statically known Extension commands, aliases, flags, and typed results", async () => {
		const tools = defineExtension(defineExtensionId("tools"), {
			flags: [
				{ name: "trace", type: "boolean" },
				{ name: "version", type: "boolean", recursive: false },
			],
			commands: [
				defineCommand("inspect", { aliases: ["scan"] }, (command) =>
					command.action(() => ({ kind: "extension" as const })),
				),
			],
		});
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
		expect(await pending).toEqual({ status: "completed", result: { kind: "extension" } });
	});

	it("keeps widened Extension commands runtime-only", async () => {
		let ran = false;
		const dynamic: Extension = defineExtension(defineExtensionId("dynamic"), {
			commands: [
				defineCommand("generated", (command) =>
					command.action(() => {
						ran = true;
					}),
				),
			],
		});
		const app = new Crust("cli").extend(dynamic);

		function typecheckHarness() {
			// @ts-expect-error -- widened Extension commands are not statically known paths
			void app.run(["generated"]);
		}
		void typecheckHarness;

		await app.execute({ argv: ["generated"] });
		expect(ran).toBe(true);
	});

	it("keeps a widened Extension from degrading a literal sibling's typed shape", async () => {
		const lit = defineExtension(defineExtensionId("lit"), {
			commands: [
				defineCommand("inspect", (command) => command.action(() => ({ kind: "lit" as const }))),
			],
		});
		const widened: Extension = defineExtension(defineExtensionId("dyn"), {
			commands: [defineCommand("generated", (command) => command.action(() => {}))],
		});
		const app = new Crust("cli").extend(lit, widened);

		const pending = app.run(["inspect"]);
		type _result = Expect<Equal<typeof pending, Promise<RunOutcome<{ kind: "lit" }>>>>;
		expect(await pending).toEqual({ status: "completed", result: { kind: "lit" } });
	});

	it("surfaces Extension preparation failures before typed dispatch", async () => {
		const replacement = defineExtension(defineExtensionId("replacement"), {
			flags: [{ name: "mode", type: "boolean" }],
		});
		const app = new Crust("cli")
			.flags({ name: "mode", type: "string" })
			.extend(replacement as never)
			.action(() => {});

		await expect(app.run([])).rejects.toThrow(
			'Flag "mode" collides with existing flag "mode" on command "cli"',
		);
	});

	it("awaits async action results", async () => {
		const app = new Crust("cli").action(async () => ({ ok: true as const }));
		const pending = app.run([]);
		type _result = Expect<Equal<typeof pending, Promise<RunOutcome<{ ok: true }>>>>;

		expect(await pending).toEqual({ status: "completed", result: { ok: true } });
	});

	it("returns the finishing Extension when preRun finishes before the action", async () => {
		const gateId = defineExtensionId("gate");
		const gate = defineExtension(gateId, {
			hooks: { preRun: (ctx) => ctx.finish() },
		});
		const app = new Crust("cli").extend(gate).action(() => ({ ran: true as const }));
		const pending = app.run([]);
		type _result = Expect<Equal<typeof pending, Promise<RunOutcome<{ ran: true }>>>>;

		expect(await pending).toEqual({ status: "finished", by: gateId });
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
				.flags(
					{ name: "fetch", type: "boolean" },
					{ name: "tag", type: "string", multiple: true },
					{ name: "config", type: "json" },
					{ name: "offset", type: "number" },
				)
				.action(({ args, flags, rawArgs }) => {
					received = { args, flags, rawArgs };
				}),
		);
		const app = new Crust("git").add(remoteAdd).extend(
			defineExtension(defineExtensionId("argv"), {
				hooks: {
					preRun: (ctx) => {
						expect(ctx.argv).toEqual(["remote-add"]);
					},
				},
			}),
		);

		await app.run(["remote-add"], {
			args: { name: "origin", count: 2, files: ["a.ts", "b.ts"] },
			flags: { fetch: true, tag: ["one", "-two"], config: { force: true }, offset: -3 },
			raw: ["--literal"],
		});

		expect(received).toEqual({
			args: { name: "origin", count: 2, files: ["a.ts", "b.ts"] },
			flags: { fetch: true, tag: ["one", "-two"], config: { force: true }, offset: -3 },
			rawArgs: ["--literal"],
		});
	});

	it("rejects positional holes before dispatch", async () => {
		const app = new Crust("cli")
			.args({ name: "source", type: "string" }, { name: "destination", type: "string" })
			.action(() => {});

		await expect(app.run([], { args: { destination: "out" } })).rejects.toMatchObject({
			code: "PARSE",
			details: { reason: "positional-gap" },
		});
	});

	it("accepts positional values beginning with a dash", async () => {
		const app = new Crust("cli")
			.args({ name: "source", type: "string" })
			.action(({ args }) => args.source);
		expect(await app.run([], { args: { source: "-unsafe" } })).toEqual({
			status: "completed",
			result: "-unsafe",
		});
	});

	it("selects commands only from the typed path, not positional names or aliases", async () => {
		let ran = "";
		const app = new Crust("cli")
			.args({ name: "target", type: "string" })
			.action(({ args }) => {
				ran = "root";
				return args.target;
			})
			.add(
				defineCommand("build", { aliases: ["compile"] }, (command) =>
					command.action(() => {
						ran = "build";
					}),
				),
			);
		for (const target of ["build", "compile"]) {
			expect(await app.run([], { args: { target } })).toEqual({
				status: "completed",
				result: target,
			});
			expect(ran).toBe("root");
		}
		await app.run(["build"]);
		expect(ran).toBe("build");
	});

	it("keeps arrays scalar for non-multiple json flags and non-variadic json args", async () => {
		let received: JsonRunCapture | undefined;
		const app = new Crust("cli")
			.args({ name: "payload", type: "json" })
			.flags({ name: "config", type: "json" })
			.action(({ args, flags }) => {
				received = { args, flags };
			});

		await app.run([], {
			args: { payload: [1, 2] as const },
			flags: { config: [3, 4] as const },
		});

		expect(received).toEqual({ args: { payload: [1, 2] }, flags: { config: [3, 4] } });
	});

	it("passes JSON values through by reference and treats undefined as omitted", async () => {
		const app = new Crust("cli")
			.flags({ name: "config", type: "json" })
			.action(({ flags }) => flags.config);
		await expect(app.run([], { flags: { config: undefined } })).resolves.toEqual({
			status: "completed",
			result: undefined,
		});
		const payload = { nested: [1, 2] };
		const outcome = await app.run([], { flags: { config: payload } });
		expect(outcome.status).toBe("completed");
		if (outcome.status === "completed") expect(outcome.result).toBe(payload);
	});

	it("treats empty multiple flag arrays as omitted", async () => {
		const app = new Crust("cli")
			.flags(
				{ name: "optional", type: "string", multiple: true },
				{ name: "defaulted", type: "string", multiple: true, default: ["fallback"] },
			)
			.action(({ flags }) => flags);
		expect(await app.run([], { flags: { optional: [], defaulted: [] } })).toEqual({
			status: "completed",
			result: { optional: undefined, defaulted: ["fallback"] },
		});
		const required = new Crust("cli")
			.flags({ name: "tag", type: "string", multiple: true, required: true })
			.action(() => {});
		await expect(required.run([], { flags: { tag: [] } })).rejects.toThrow(
			'Missing required flag "--tag"',
		);
	});

	it("rejects unknown structured arguments and flags", async () => {
		const app = new Crust("cli").args({ name: "source", type: "string" }).action(() => {});

		await expect(app.run([], { args: { bogus: "x" } } as never)).rejects.toMatchObject({
			code: "PARSE",
			details: { reason: "unknown-argument", argument: "bogus" },
		});
		await expect(app.run([], { flags: { bogus: true } } as never)).rejects.toMatchObject({
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

		await expect(app.run(["missing"] as never)).rejects.toMatchObject({
			code: "COMMAND_NOT_FOUND",
			details: { input: "missing", available: ["visible"] },
		});
	});
});
