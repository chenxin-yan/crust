import { describe, expect, it } from "bun:test";

import type { Equal, Expect } from "../../tests/helpers.ts";
import { unwrap } from "../../tests/helpers.ts";
import { defineContext } from "../api/context.ts";
import { defineExtension } from "../api/extension.ts";
import { defineFlag } from "../api/flags.ts";
import { defineExtensionId } from "../identity.ts";
import { type CommandDefinitionBuilder, Crust, defineCommand } from "./crust.ts";

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

	it("rejects a recipe that returns an unrelated builder", () => {
		const unrelated = defineCommand("bad", () => new Crust("other") as never);

		expect(() => new Crust("cli").add(unrelated)).toThrow(/same command builder/);
	});

	it("rejects a later batch recipe returning an earlier recipe's fluent builder", async () => {
		const events: string[] = [];
		let retained: CommandDefinitionBuilder<{ "from-first": { type: "boolean" } }, []> | undefined;
		const base = new Crust("cli");
		const receiver = base.add(defineCommand("existing", (command) => command));
		const first = defineCommand("first", (command) => {
			events.push("first");
			retained = command.flags({ name: "from-first", type: "boolean" }).action(() => {});
			return retained;
		});
		const second = defineCommand("second", () => {
			events.push("second");
			if (!retained) throw new Error("first recipe has not run");
			return retained;
		});
		const later = defineCommand("later", (command) => {
			events.push("later");
			return command;
		});

		expect(() => receiver.add(first, second, later)).toThrow(
			expect.objectContaining({
				code: "DEFINITION",
				message: 'Command "second" definition must return the same command builder it received',
				details: { subject: "command", name: "second", reason: "foreign-command-builder" },
			}),
		);
		expect(events).toEqual(["first", "second"]);
		expect(Object.keys(base._node.subCommands)).toEqual([]);
		expect(Object.keys(receiver._node.subCommands)).toEqual(["existing"]);
		expect(Object.keys((await receiver.snapshot()).subCommands)).toEqual(["existing"]);
	});

	it("rejects Extensions registered inside command definitions", () => {
		const nestedExtension = defineCommand("bad", (command) => {
			// SAFETY: deliberately escape the sealed recipe surface to verify its runtime guard.
			// oxlint-disable-next-line anti-slop/no-chained-type-assertions -- Crust's declared type omits the builder-only `.use()`, so the escape must pass through unknown.
			return (command as unknown as Crust).extend(
				defineExtension(defineExtensionId("nested")),
			) as never;
		});

		expect(() => new Crust("cli").add(nestedExtension)).toThrow(
			/Command "bad" cannot register Extensions inside command definitions/,
		);
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
					type _Source = Expect<Equal<typeof args.source, string>>;
					type _Output = Expect<Equal<typeof flags.output, string | undefined>>;
					received = { args, flags };
				}),
		);

		await unwrap(
			new Crust("cli").add(definition).run(["copy"], {
				args: { source: "from", destination: "to" },
				flags: { verbose: true, output: "dist" },
			}),
		);
		expect(received).toEqual({
			args: { source: "from", destination: "to" },
			flags: { verbose: true, output: "dist" },
		});
	});

	it("does not backfill nested definitions with later inheritable flags", async () => {
		const nested = defineCommand("nested", (command) => command.action(() => {}));
		const outer = defineCommand("outer", (command) =>
			command.add(nested).flags({ name: "late", type: "boolean" }),
		);
		const app = new Crust("cli").add(outer);

		await expect(unwrap(app.run(["outer", "nested"], { flags: { late: true } }))).rejects.toThrow(
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
			command.use(auth).action(async ({ ctx }) => {
				calls.push(String((await ctx.auth).apiKey));
			}),
		);
		const outer = defineCommand("outer", (command) =>
			command.add(before).provide(auth()).add(after),
		);
		const app = new Crust("cli").add(outer);

		await expect(
			unwrap(app.run(["outer", "before"], { flags: { "api-key": "secret" } })),
		).rejects.toThrow(/Unknown flag/);
		await unwrap(app.run(["outer", "after"], { flags: { "api-key": "secret" } }));
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
			command
				.use(db)
				.use(logging)
				.action(async ({ ctx }) => {
					calls.push(`${await ctx.db}:${String((await ctx.logging).verbose)}`);
				}),
		);
		const deploy = defineCommand("deploy", (command) => command.use(db).use(logging).add(status));
		const app = new Crust("cli").provide(logging(), db()).add(deploy);

		await unwrap(app.run(["deploy", "status"], { flags: { verbose: true } }));

		expect(calls).toEqual(["database:true"]);
	});

	it("accepts multiple factories in one variadic .use() call", async () => {
		const calls: string[] = [];
		const logging = defineContext("logging", () => ({ verbose: true }));
		const db = defineContext("db", () => "database");
		const status = defineCommand("status", (command) =>
			command.use(db, logging).action(async ({ ctx }) => {
				const database = await ctx.db;
				type _Db = Expect<Equal<typeof database, string>>;
				calls.push(`${database}:${String((await ctx.logging).verbose)}`);
			}),
		);
		const app = new Crust("cli").provide(logging(), db()).add(status);

		await unwrap(app.run(["status"]));

		expect(calls).toEqual(["database:true"]);

		const missingDep = () => {
			// @ts-expect-error -- variadic .use() declares every factory as a dependency; "db" is not provided
			new Crust("cli").provide(logging()).add(status);
		};
		void missingDep;

		// .use() is type-only, so calls that contribute no types are compile errors:
		const rejectedForms = () => {
			const widened = [db, logging];
			defineCommand("w", (command) =>
				// @ts-expect-error -- widened spreads lose the factory tuple and would declare nothing
				command.use(...widened).action(() => {}),
			);
			defineCommand("e", (command) =>
				// @ts-expect-error -- empty .use() would be a silent no-op
				command.use().action(() => {}),
			);
		};
		void rejectedForms;
	});

	it("excludes parent local flags from added commands", async () => {
		const definition = defineCommand("users", (command) => command.action(() => {}));
		const app = new Crust("cli").flags({ name: "secret", type: "string" }).add(definition);

		await expect(unwrap(app.run(["users"], { flags: { secret: "value" } }))).rejects.toThrow(
			/Unknown flag/,
		);
	});

	it("rejects a recipe-provided Context flag colliding with an ancestor Context's flag", () => {
		const db = defineContext("db", { flags: [{ name: "conn", type: "string" }] }, () => ({}));
		const cache = defineContext("cache", { flags: [{ name: "conn", type: "number" }] }, () => ({}));
		// Checked attachment validates the sealed recipe against this destination.
		const sub = defineCommand("sub", (cmd) => cmd.provide(cache()).action(() => {}));
		const app = new Crust("cli").provide(db());
		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
		expect(() => app.add(sub)).toThrow(
			'Flag "conn" collides with existing flag "conn" on command "sub"',
		);
	});

	it("rejects re-providing a colliding owned flag along a child path", () => {
		const db = defineContext("db", { flags: [{ name: "conn", type: "string" }] }, () => ({
			kind: "real",
		}));
		const sub = defineCommand("sub", (cmd) =>
			cmd.provide(db.of({ kind: "double" })).action(() => {}),
		);
		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
		expect(() => new Crust("cli").provide(db()).add(sub)).toThrow(
			expect.objectContaining({
				code: "DEFINITION",
				details: { subject: "flag", name: "conn", reason: "flag-collision" },
			}),
		);
	});

	it("keeps retained builders unchanged when a batch recipe throws", async () => {
		const events: string[] = [];
		const base = new Crust("cli");
		const receiver = base.add(defineCommand("existing", (command) => command));
		const first = defineCommand("first", (command) => {
			events.push("first");
			return command;
		});
		const failure = new Error("recipe failed");
		const throwing = defineCommand("throwing", () => {
			events.push("throwing");
			throw failure;
		});
		const later = defineCommand("later", (command) => {
			events.push("later");
			return command;
		});

		expect(() => receiver.add(first, throwing, later)).toThrow(failure);
		expect(events).toEqual(["first", "throwing"]);
		expect(Object.keys(base._node.subCommands)).toEqual([]);
		expect(Object.keys(receiver._node.subCommands)).toEqual(["existing"]);
		expect(Object.keys((await receiver.snapshot()).subCommands)).toEqual(["existing"]);
	});

	it.each(["first", "existing"])(
		"checks a batch duplicate of %s before its recipe and stops registration",
		async (name: string) => {
			const events: string[] = [];
			const base = new Crust("cli");
			const receiver = base.add(defineCommand("existing", (command) => command));
			const first = defineCommand("first", (command) => {
				events.push("first");
				return command;
			});
			const duplicate = defineCommand(name, (command) => {
				events.push("duplicate");
				return command;
			});
			const later = defineCommand("later", (command) => {
				events.push("later");
				return command;
			});

			expect(() => receiver.add(first, duplicate, later)).toThrow(
				expect.objectContaining({
					code: "DEFINITION",
					message: `Command name "${name}" is already registered on this command`,
					details: { subject: "command", name, reason: "command-collision" },
				}),
			);
			expect(events).toEqual(["first"]);
			expect(Object.keys(base._node.subCommands)).toEqual([]);
			expect(Object.keys(receiver._node.subCommands)).toEqual(["existing"]);
			expect(Object.keys((await receiver.snapshot()).subCommands)).toEqual(["existing"]);
		},
	);

	it("adds multiple definitions in argument order without mutating retained builders", async () => {
		const configured: string[] = [];
		const ran: string[] = [];
		const build = defineCommand("build", (command) => {
			configured.push("build");
			return command.action(() => {
				ran.push("build");
			});
		});
		const publish = defineCommand("publish", (command) => {
			configured.push("publish");
			return command.action(() => {
				ran.push("publish");
			});
		});
		const base = new Crust("cli");
		const receiver = base.add(defineCommand("existing", (command) => command));
		const app = receiver.add(build, publish);

		expect(configured).toEqual(["build", "publish"]);
		expect(Object.keys(base._node.subCommands)).toEqual([]);
		expect(Object.keys(receiver._node.subCommands)).toEqual(["existing"]);
		expect(Object.keys(app._node.subCommands)).toEqual(["existing", "build", "publish"]);
		expect(app._node.subCommands).not.toBe(receiver._node.subCommands);

		await unwrap(app.run(["build"]));
		await unwrap(app.run(["publish"]));

		expect(ran).toEqual(["build", "publish"]);
		expect(configured).toEqual(["build", "publish"]);
	});
});
