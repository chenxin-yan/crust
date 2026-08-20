import { describe, expect, it } from "bun:test";

import type { StandardSchema } from "@crustjs/utils/schema";

import { defineExtension, type Extension } from "../api/extension.ts";
import { defineExtensionId } from "../identity.ts";
import type { CommandPath, CommandShapeAt, RunInput, RunOutcome } from "./crust.ts";
import { Crust, defineCommand } from "./crust.ts";

type Expect<T extends true> = T;
type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// "root" plus 14 "next" segments — a path exactly at the depth-15 cap.
type FifteenDeep = readonly [
	"root",
	"next",
	"next",
	"next",
	"next",
	"next",
	"next",
	"next",
	"next",
	"next",
	"next",
	"next",
	"next",
	"next",
	"next",
];

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

	it("surfaces Extension preparation failures before typed dispatch", async () => {
		const replacement = defineExtension(defineExtensionId("replacement"), {
			flags: [{ name: "mode", type: "boolean" }],
		});
		const app = new Crust("cli")
			.flags({ name: "mode", type: "string" })
			.extend(replacement as never)
			.action(() => {});

		await expect(app.run([])).rejects.toThrow(
			'Extension flag "mode" collides with a flag already defined on command "cli"',
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

	it("serializes structured input through routing and the parser", async () => {
		let received: unknown;
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
		const app = new Crust("git").add(remoteAdd);

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

	it("rejects positional holes and option-like positional values before dispatch", async () => {
		const app = new Crust("cli")
			.args({ name: "source", type: "string" }, { name: "destination", type: "string" })
			.action(() => {});

		await expect(app.run([], { args: { destination: "out" } })).rejects.toMatchObject({
			code: "PARSE",
			details: { reason: "positional-gap" },
		});
		await expect(app.run([], { args: { source: "-unsafe" } })).rejects.toMatchObject({
			code: "PARSE",
			details: { reason: "option-like-positional" },
		});
	});

	it("rejects positional values that collide with subcommand names or aliases", async () => {
		let ran = "";
		const app = new Crust("cli")
			.args({ name: "target", type: "string" })
			.action(() => {
				ran = "root";
			})
			.add(
				defineCommand("build", { aliases: ["compile"] }, (command) =>
					command.action(() => {
						ran = "build";
					}),
				),
			);

		await expect(app.run([], { args: { target: "build" } })).rejects.toMatchObject({
			code: "PARSE",
			details: { reason: "ambiguous-positional" },
		});
		await expect(app.run([], { args: { target: "compile" } })).rejects.toMatchObject({
			code: "PARSE",
			details: { reason: "ambiguous-positional" },
		});
		expect(ran).toBe("");

		await app.run([], { args: { target: "other" } });
		expect(ran).toBe("root");
	});

	it("keeps arrays scalar for non-multiple json flags and non-variadic json args", async () => {
		let received: unknown;
		const app = new Crust("cli")
			.args({ name: "payload", type: "json" })
			.flags({ name: "config", type: "json" })
			.action(({ args, flags }) => {
				received = { args, flags };
			});

		await app.run([], { args: { payload: [1, 2] }, flags: { config: [3, 4] } });

		expect(received).toEqual({ args: { payload: [1, 2] }, flags: { config: [3, 4] } });
	});

	it("rejects unserializable JSON input values", async () => {
		const app = new Crust("cli").flags({ name: "config", type: "json" }).action(() => {});

		await expect(app.run([], { flags: { config: undefined } })).resolves.toEqual({
			status: "completed",
			result: undefined,
		});
		await expect(app.run([], { flags: { config: (() => {}) as never } })).rejects.toMatchObject({
			code: "PARSE",
			details: { reason: "unserializable-json" },
		});
		// JSON.stringify throws for these instead of returning undefined.
		await expect(app.run([], { flags: { config: 1n as never } })).rejects.toMatchObject({
			code: "PARSE",
			details: { reason: "unserializable-json" },
		});
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		await expect(app.run([], { flags: { config: cyclic } })).rejects.toMatchObject({
			code: "PARSE",
			details: { reason: "unserializable-json" },
		});
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
		const app = new Crust("cli").args({ name: "source", type: "string" }).action(() => {});

		await expect(app.run(["missing"] as never)).rejects.toMatchObject({
			code: "COMMAND_NOT_FOUND",
			details: { input: "missing" },
		});
	});

	it("preserves command aliases and pre-parse input types", () => {
		const rawNumber: StandardSchema<string | undefined, number> = {
			"~standard": {
				version: 1,
				vendor: "test",
				validate: (value) => ({ value: Number(value) }),
			},
		};
		const deploy = defineCommand("deploy", { aliases: ["ship"] }, (command) =>
			command
				.args(
					{ name: "target", type: "string", required: true },
					{ name: "port", schema: rawNumber },
					{ name: "region", type: "string", required: true, default: "us" },
				)
				.flags(
					{ name: "mode", type: "string", choices: ["dev", "prod"], required: true },
					{ name: "retries", type: "string", parse: Number },
					{ name: "color", type: "boolean", default: true },
					{ name: "env", type: "string", required: true, default: "prod" },
					{ name: "version", type: "boolean", noNegate: true },
				)
				.action(() => {}),
		);
		const release = defineCommand("release-now", (command) => command.add(deploy));
		const app = new Crust("cli").add(release);

		type Path = CommandPath<(typeof app)["_types"]["tree"]>;
		type _nestedPath = Expect<readonly ["release-now", "deploy"] extends Path ? true : false>;
		type _aliasPath = Expect<readonly ["release-now", "ship"] extends Path ? true : false>;
		type _kebabPath = Expect<readonly ["release-now"] extends Path ? true : false>;
		type DeployShape = CommandShapeAt<
			(typeof app)["_types"]["shape"],
			readonly ["release-now", "deploy"]
		>;
		type DeployInput = RunInput<DeployShape>;
		const valid: DeployInput = {
			args: { target: "prod", port: "8080" },
			flags: { mode: "prod", retries: "2", version: true },
		};
		// Defaulted flags/args remain optional in pre-parse input, even when
		// declared `required: true` — the default satisfies requiredness at parse time.
		const withoutDefault: DeployInput = { args: { target: "prod" }, flags: { mode: "dev" } };

		// @ts-expect-error -- required positional argument is missing
		const missingArg: DeployInput = { flags: { mode: "dev" } };
		const unknownArg: DeployInput = {
			// @ts-expect-error -- unknown argument name
			args: { target: "prod", host: "localhost" },
			flags: { mode: "dev" },
		};
		// @ts-expect-error -- choices remain a literal union
		const invalidChoice: DeployInput = { args: { target: "prod" }, flags: { mode: "staging" } };
		const invalidNegation: DeployInput = {
			args: { target: "prod" },
			// @ts-expect-error -- noNegate booleans accept only true
			flags: { mode: "dev", version: false },
		};
		void [valid, withoutDefault, missingArg, unknownArg, invalidChoice, invalidNegation];
		expect(true).toBe(true);
	});

	it("keeps wide command trees tractable for the checker", () => {
		type Index =
			| 1
			| 2
			| 3
			| 4
			| 5
			| 6
			| 7
			| 8
			| 9
			| 10
			| 11
			| 12
			| 13
			| 14
			| 15
			| 16
			| 17
			| 18
			| 19
			| 20
			| 21
			| 22
			| 23
			| 24
			| 25
			| 26
			| 27
			| 28
			| 29
			| 30;
		type WideTree = {
			[K in `command-${Index}`]: { args: []; flags: {}; children: {}; result: void };
		};
		type Paths = CommandPath<WideTree>;
		type _includesLast = Expect<readonly ["command-30"] extends Paths ? true : false>;
		type _rejectsUnknown = Expect<
			Equal<readonly ["command-31"] extends Paths ? true : false, false>
		>;
		expect(true).toBe(true);
	});

	it("widens paths past the 15-level depth cap instead of failing the checker", () => {
		type Nest<
			Depth extends number,
			Acc extends readonly unknown[] = [],
		> = Acc["length"] extends Depth
			? { args: []; flags: {}; children: {}; result: void }
			: {
					args: [];
					flags: {};
					children: { next: Nest<Depth, readonly [...Acc, unknown]> };
					result: void;
				};
		type DeepTree = { root: Nest<16> };
		type Paths = CommandPath<DeepTree>;
		// Below the cap, paths stay exact; at the cap the tail widens to strings
		// so deep-but-valid applications keep compiling (TS2589 escape hatch).
		type _exactShallow = Expect<readonly ["root", "next"] extends Paths ? true : false>;
		type _rejectsShallowTypo = Expect<
			Equal<readonly ["root", "nope"] extends Paths ? true : false, false>
		>;
		// Segment 16 sits past the cap, so any string is accepted there.
		type _widenedDeep = Expect<
			readonly [...FifteenDeep, "not-a-command"] extends Paths ? true : false
		>;
		expect(true).toBe(true);
	});

	it("resolves action results for literal paths past the depth cap", () => {
		type Nest<
			Depth extends number,
			Acc extends readonly unknown[] = [],
		> = Acc["length"] extends Depth
			? { args: []; flags: {}; children: {}; result: "deep-result" }
			: {
					args: [];
					flags: {};
					children: { next: Nest<Depth, readonly [...Acc, unknown]> };
					result: "mid";
				};
		type DeepTree = { root: Nest<16> };
		type Root = { args: []; flags: {}; children: DeepTree; result: "root-result" };
		// The depth-15 cap only widens the CommandPath constraint; `const Path` still
		// infers the literal tuple, and CommandShapeAt (uncapped) resolves it fully.
		type SeventeenDeep = readonly [...FifteenDeep, "next", "next"];
		type _deepResult = Expect<Equal<CommandShapeAt<Root, SeventeenDeep>["result"], "deep-result">>;
		// A path variable widened past the cap cannot name its command statically,
		// so the shape (and its result) widens to unknown instead of an ancestor's.
		type _widenedResult = Expect<
			Equal<CommandShapeAt<Root, readonly ["root", ...string[]]>["result"], unknown>
		>;
		// A CommandPath<Tree>-typed variable (union of literal tuples and widened
		// arrays) never resolves to never, and a widened head widens instead.
		type _pathVariable = CommandShapeAt<Root, CommandPath<DeepTree>>["result"];
		type _pathVariableSound = Expect<Equal<[_pathVariable] extends [never] ? true : false, false>>;
		type _widenedHead = Expect<
			Equal<CommandShapeAt<Root, readonly [string, ...string[]]>["result"], unknown>
		>;
		expect(true).toBe(true);
	});
});
