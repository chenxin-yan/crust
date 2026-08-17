import { describe, expect, it } from "bun:test";

import { defineContext } from "../api/context.ts";
import { defineExtension } from "../api/extension.ts";
import { defineFlag } from "../api/flags.ts";
import type { CommandDefinitionBuilder } from "./crust.ts";
import { Crust, defineCommand } from "./crust.ts";

type Assert<T extends true> = T;
type IsEqual<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

describe("command definitions", () => {
	it("stays inert and materializes each time it is added", async () => {
		let configured = 0;
		const definition = defineCommand("build", (command) => {
			configured++;
			return command.flags({ name: "output", type: "string" });
		});

		expect(configured).toBe(0);
		const app = new Crust("cli").add(definition, definition.as("compile"));

		expect(configured).toBe(2);
		const snapshot = await app.snapshot();
		expect(snapshot.subCommands.build?.meta.name).toBe("build");
		expect(snapshot.subCommands.compile?.meta.name).toBe("compile");
	});

	it("accumulates chained flags and args on the definition builder", async () => {
		let received:
			| {
					args: { source: string; destination: string };
					flags: { verbose: boolean | undefined; output: string | undefined };
			  }
			| undefined;
		const definition = defineCommand("copy", (command) =>
			command
				.flags({ name: "verbose", type: "boolean" })
				.flags({ name: "output", type: "string" })
				.args({ name: "source", type: "string", required: true })
				.args({ name: "destination", type: "string", required: true })
				.action(({ args, flags }) => {
					type _Source = Assert<IsEqual<typeof args.source, string>>;
					type _Output = Assert<IsEqual<typeof flags.output, string | undefined>>;
					received = { args, flags };
				}),
		);

		await new Crust("cli").add(definition).run(["copy"], {
			args: { source: "from", destination: "to" },
			flags: { verbose: true, output: "dist" },
		});
		expect(received).toEqual({
			args: { source: "from", destination: "to" },
			flags: { verbose: true, output: "dist" },
		});
	});

	it("accumulates flag spellings across builder calls for compile-time collision checks", () => {
		// The CommandDefinitionBuilder interface mirrors Crust's Sp accumulator
		// type-only; this pins the recipe path so the mirror cannot drift. The
		// widened call in between proves Sp retains earlier literals instead of
		// recomputing from the (now-widened) Flags.
		const dynamicDefs: { name: string; type: "boolean" }[] = [{ name: "dynamic", type: "boolean" }];
		const definition = defineCommand("serve", (command) =>
			command
				.flags({ name: "verbose", type: "boolean", short: "v" })
				.flags(...dynamicDefs)
				.args({ name: "file", type: "string" })
				.flags(
					// @ts-expect-error -- "v" collides with the earlier .flags() call
					{ name: "version", type: "boolean", short: "v" },
				)
				.action(() => {}),
		);
		expect(() => new Crust("cli").add(definition)).toThrow(
			/spelling "v" collides with flag "--verbose"/,
		);
	});

	it("accumulates Context-owned spellings for later .flags() calls on the builder", () => {
		const owner = defineContext(
			"owner",
			{ flags: [defineFlag("vv", { type: "boolean", short: "v" })] },
			() => ({}),
		);
		const definition = defineCommand("serve", (command) =>
			command
				.provide(owner())
				.flags(
					// @ts-expect-error -- short "v" collides with the Context-owned flag provided earlier
					{ name: "version", type: "boolean", short: "v" },
				)
				.action(() => {}),
		);
		expect(() => new Crust("cli").add(definition)).toThrow(
			/spelling "v" collides with flag "--vv"/,
		);
	});

	it("rejects a second action on the definition builder", () => {
		const definition = defineCommand("duplicate", (command) =>
			command.action(() => {}).action(() => {}),
		);
		expect(() => new Crust("cli").add(definition)).toThrow(/already has an action/);
	});

	it(".as() renames without mutating the original definition", () => {
		const definition = defineCommand("build", (command) => command.action(() => {}));
		const renamed = definition.as("compile");

		expect(definition.name).toBe("build");
		expect(renamed.name).toBe("compile");
		expect(renamed).not.toBe(definition);
		type _PreservesRenamedLiteral = Assert<IsEqual<typeof renamed.name, "compile">>;

		expect(() => definition.as("  ")).toThrow(/non-empty/);
	});

	it("rejects an empty definition name", () => {
		expect(() => defineCommand("", (command) => command)).toThrow(/non-empty/);
		expect(() => defineCommand("   ", (command) => command)).toThrow(/non-empty/);
	});

	it("does not backfill nested definitions with later inheritable flags", async () => {
		const nested = defineCommand("nested", (command) => command.action(() => {}));
		const outer = defineCommand("outer", (command) =>
			command.add(nested).flags({ name: "late", type: "boolean" }),
		);
		const app = new Crust("cli").add(outer);

		await expect(app.run(["outer", "nested"], { flags: { late: true } } as never)).rejects.toThrow(
			/Unknown flag/,
		);
	});

	it("propagates Context-owned flags only to definitions added after provide()", async () => {
		const calls: string[] = [];
		const apiKey = defineFlag("api-key", { type: "string" });
		const auth = defineContext("auth", { flags: [apiKey] }, ({ flags }) => ({
			apiKey: flags["api-key"],
		}));
		const before = defineCommand("before", (command) => command.action(() => {}));
		const after = defineCommand("after", (command) =>
			command.action(async ({ ctx }) => {
				calls.push(String((await ctx.use(auth)).apiKey));
			}),
		);
		const outer = defineCommand("outer", (command) =>
			command.add(before).provide(auth()).add(after),
		);
		const app = new Crust("cli").add(outer);

		await expect(
			app.run(["outer", "before"], { flags: { "api-key": "secret" } } as never),
		).rejects.toThrow(/Unknown flag/);
		await app.run(["outer", "after"], { flags: { "api-key": "secret" } } as never);
		expect(calls).toEqual(["secret"]);
	});

	it("inherits capabilities through nested definitions", async () => {
		const calls: string[] = [];
		const verbose = defineFlag("verbose", { type: "boolean" });
		const logging = defineContext("logging", { flags: [verbose] }, ({ flags }) => ({
			verbose: flags.verbose === true,
		}));
		const db = defineContext("db", () => "database");
		const status = defineCommand("status", (command) =>
			command.action(async ({ ctx }) => {
				calls.push(`${await ctx.use(db)}:${String((await ctx.use(logging)).verbose)}`);
			}),
		);
		const deploy = defineCommand("deploy", (command) => command.add(status));
		const app = new Crust("cli").provide(logging(), db()).add(deploy);

		await app.run(["deploy", "status"], { flags: { verbose: true } } as never);

		expect(calls).toEqual(["database:true"]);
	});

	it("clones annotations and isolates materializations across parents", async () => {
		const annotation = Symbol("annotation");
		const definition = defineCommand("one", { description: "Reusable" }, (command) => {
			((command as unknown as Crust)._node as unknown as Record<symbol, unknown>)[annotation] =
				"preserved";
			return command;
		});

		const first = await new Crust("first").add(definition).snapshot();
		const second = await new Crust("second").add(definition.as("two")).snapshot();

		expect((first.subCommands.one as unknown as Record<symbol, unknown>)[annotation]).toBe(
			"preserved",
		);
		expect((second.subCommands.two as unknown as Record<symbol, unknown>)[annotation]).toBe(
			"preserved",
		);
	});

	it("rejects duplicate inherited Contexts during materialization", () => {
		const db = defineContext("db", () => "database");
		const definition = defineCommand("users", (command) => command.provide(db()));

		expect(() => new Crust("cli").provide(db()).add(definition)).toThrow(
			/Context "db" is already provided/,
		);
	});

	it("excludes parent local flags from added commands", async () => {
		const definition = defineCommand("users", (command) => command.action(() => {}));
		const app = new Crust("cli").flags({ name: "secret", type: "string" }).add(definition);

		await expect(app.run(["users"], { flags: { secret: "value" } } as never)).rejects.toThrow(
			/Unknown flag/,
		);
	});

	it("runs added definitions through run and execute", async () => {
		let calls = 0;
		const definition = defineCommand("build", (command) =>
			command.action(() => {
				calls++;
			}),
		);
		const app = new Crust("cli").add(definition);

		await app.run(["build"]);
		await app.execute({ argv: ["build"] });

		expect(calls).toBe(2);
	});

	it("adds multiple definitions in one variadic call", async () => {
		const ran: string[] = [];
		const build = defineCommand("build", (command) =>
			command.action(() => {
				ran.push("build");
			}),
		);
		const publish = defineCommand("publish", (command) =>
			command.action(() => {
				ran.push("publish");
			}),
		);
		const app = new Crust("cli").add(build, publish);

		await app.run(["build"]);
		await app.run(["publish"]);

		expect(ran).toEqual(["build", "publish"]);
	});

	it("uses the same lineage checks for inline definitions", () => {
		expect(() =>
			new Crust("cli").add(defineCommand("bad", () => new Crust("foreign") as never)),
		).toThrow(/same command builder/);
	});

	it("validates canonical names and aliases on every add", () => {
		const definition = defineCommand("build", { aliases: ["b"] }, (command) =>
			command.action(() => {}),
		);
		const app = new Crust("cli").add(definition);

		expect(() => {
			// @ts-expect-error -- runtime twin rejects duplicate definitions for plain-JS consumers
			app.add(definition);
		}).toThrow(/already registered/);
		expect(() => {
			// @ts-expect-error -- runtime twin rejects a name colliding with a sibling alias
			app.add(defineCommand("b", (command) => command));
		}).toThrow(/collides with alias of sibling "build"/);
		expect(() => {
			const withB = new Crust("cli").add(defineCommand("b", (command) => command));
			// @ts-expect-error -- runtime twin rejects an alias colliding with a sibling name
			withB.add(definition);
		}).toThrow(/collides with sibling canonical name "b"/);
	});

	it("rejects unrelated returned builders and nested Extensions", () => {
		const unrelated = defineCommand("bad", () => new Crust("other") as never);
		expect(() => new Crust("cli").add(unrelated)).toThrow(/same command builder/);

		const nestedExtension = defineCommand(
			"bad",
			(command) => (command as unknown as Crust).extend(defineExtension("nested")) as never,
		);
		expect(() => new Crust("cli").add(nestedExtension)).toThrow(
			/Command "bad" cannot register Extensions inside command definitions/,
		);
	});

	it("rejects values that are not command definitions", () => {
		for (const bad of [{}, null, undefined, "definition"]) {
			expect(() => new Crust("cli").add(bad as never)).toThrow(
				/requires a command definition created by defineCommand/,
			);
		}
	});

	it("rejects a missing recipe at definition time", () => {
		expect(() => (defineCommand as (name: string, recipe?: unknown) => unknown)("bad")).toThrow(
			/requires a recipe function/,
		);
	});

	it("infers pulled Context values while preserving fluent action types", () => {
		const auth = defineContext("auth", () => ({ user: "yan" }));
		const region = defineContext("region", () => "us-east-1");
		const definition = defineCommand("deploy", (command) =>
			command
				.args({ name: "target", type: "string", required: true })
				.flags({ name: "force", type: "boolean", required: true })
				.provide(region())
				.action(async ({ args, flags, ctx }) => {
					const identity = await ctx.use(auth);
					const location = await ctx.use(region);
					type _Target = Assert<IsEqual<typeof args.target, string>>;
					type _Force = Assert<IsEqual<typeof flags.force, boolean>>;
					type _Auth = Assert<IsEqual<typeof identity, { user: string }>>;
					type _Region = Assert<IsEqual<typeof location, string>>;
				}),
		);

		new Crust("cli").provide(auth()).add(definition);
	});

	it("keeps root-only methods off the definition builder", () => {
		type _NoExtend = Assert<
			IsEqual<"extend" extends keyof CommandDefinitionBuilder ? true : false, false>
		>;
		type _NoCommand = Assert<
			IsEqual<"command" extends keyof CommandDefinitionBuilder ? true : false, false>
		>;
		type _NoDerive = Assert<
			IsEqual<"derive" extends keyof CommandDefinitionBuilder ? true : false, false>
		>;

		defineCommand("configured", (command) => {
			// @ts-expect-error -- Extensions are root-only
			command.extend(defineExtension("nested"));
			const configured = command
				.args({ name: "target", type: "string" })
				.flags({ name: "force", type: "boolean" })
				.provide(defineContext("region", () => "us")());
			type _StillNoExtend = Assert<
				IsEqual<"extend" extends keyof typeof configured ? true : false, false>
			>;
			return configured;
		});
	});
});
