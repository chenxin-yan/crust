import { describe, expect, it } from "bun:test";

import type { StandardSchema } from "@crustjs/utils/schema";

import type { CommandPath, CommandShapeAt, RunInput } from "./crust.ts";
import { Crust, defineCommand } from "./crust.ts";

type Expect<T extends true> = T;
type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

describe("typed programmatic invocation", () => {
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

		await expect(app.run([], { flags: { config: undefined } })).resolves.toBeUndefined();
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
		type WideTree = { [K in `command-${Index}`]: { args: []; flags: {}; children: {} } };
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
			? { args: []; flags: {}; children: {} }
			: { args: []; flags: {}; children: { next: Nest<Depth, readonly [...Acc, unknown]> } };
		type DeepTree = { root: Nest<16> };
		type Paths = CommandPath<DeepTree>;
		// Below the cap, paths stay exact; at the cap the tail widens to strings
		// so deep-but-valid applications keep compiling (TS2589 escape hatch).
		type _exactShallow = Expect<readonly ["root", "next"] extends Paths ? true : false>;
		type _rejectsShallowTypo = Expect<
			Equal<readonly ["root", "nope"] extends Paths ? true : false, false>
		>;
		// Segment 16 sits past the cap, so any string is accepted there.
		type Fifteen = readonly [
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
		type _widenedDeep = Expect<readonly [...Fifteen, "not-a-command"] extends Paths ? true : false>;
		expect(true).toBe(true);
	});
});
