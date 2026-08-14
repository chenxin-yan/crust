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
				)
				.flags(
					{ name: "mode", type: "string", choices: ["dev", "prod"], required: true },
					{ name: "retries", type: "string", parse: Number },
					{ name: "color", type: "boolean", default: true },
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
		// Defaulted flags remain optional in pre-parse input.
		const withoutDefault: DeployInput = { args: { target: "prod" }, flags: { mode: "dev" } };

		// @ts-expect-error -- required positional argument is missing
		const missingArg: DeployInput = { flags: { mode: "dev" } };
		// @ts-expect-error -- unknown argument name
		const unknownArg: DeployInput = {
			args: { target: "prod", host: "localhost" },
			flags: { mode: "dev" },
		};
		// @ts-expect-error -- choices remain a literal union
		const invalidChoice: DeployInput = { args: { target: "prod" }, flags: { mode: "staging" } };
		// @ts-expect-error -- noNegate booleans accept only true
		const invalidNegation: DeployInput = {
			args: { target: "prod" },
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
});
