import { describe, expect, it } from "vite-plus/test";

import type { Equal, Expect } from "../../tests/helpers.ts";
import { unwrap } from "../../tests/helpers.ts";
import { defineContext } from "../api/context.ts";
import { defineExtension } from "../api/extension.ts";
import { defineFlag } from "../api/flags.ts";
import { CrustError } from "../errors.ts";
import { defineExtensionId } from "../identity.ts";
import { type CommandDefinitionBuilder, Crust, defineCommand } from "./crust.ts";
import { subCommandsOf } from "./node.ts";

describe("command definitions", () => {
	it("stays inert until first use and materializes once per addition", async () => {
		let configured = 0;
		const definition = defineCommand("build", (command) => {
			configured++;
			return command.flags({ output: { type: "string" } });
		});

		expect(configured).toBe(0);
		const app = new Crust("cli").add(definition, definition.as("compile"));

		expect(configured).toBe(0);
		const snapshot = await app.snapshot();
		expect(configured).toBe(2);
		await app.snapshot();
		expect(configured).toBe(2);
		expect(snapshot.subCommands.build?.meta.name).toBe("build");
		expect(snapshot.subCommands.compile?.meta.name).toBe("compile");
	});

	it("rejects a later batch recipe returning an earlier recipe's fluent builder", async () => {
		const events: string[] = [];
		let retained: CommandDefinitionBuilder<{ "from-first": { type: "boolean" } }, []> | undefined;
		const base = new Crust("cli");
		const receiver = base.add(defineCommand("existing", (command) => command));
		const first = defineCommand("first", (command) => {
			events.push("first");
			retained = command.flags({ "from-first": { type: "boolean" } }).action(() => {});
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

		const app = receiver.add(first, second, later);
		expect(events).toEqual([]);
		await expect(app.snapshot()).rejects.toMatchObject({
			code: "DEFINITION",
			message: 'Command "second" definition must return the same command builder it received',
			details: { subject: "command", name: "second", reason: "foreign-command-builder" },
		});
		expect(events).toEqual(["first", "second"]);
		expect(Object.keys(subCommandsOf(base._node))).toEqual([]);
		expect(Object.keys(subCommandsOf(receiver._node))).toEqual(["existing"]);
		expect(Object.keys((await receiver.snapshot()).subCommands)).toEqual(["existing"]);
	});

	it("rejects Extensions registered inside command definitions", async () => {
		const nestedExtension = defineCommand("bad", (command) => {
			// SAFETY: deliberately escape the sealed recipe surface to verify its runtime guard.
			return (command as unknown as Crust).extend(
				defineExtension(defineExtensionId("nested")),
			) as never;
		});

		await expect(new Crust("cli").add(nestedExtension).snapshot()).rejects.toThrow(
			/Command "bad" cannot register Extensions inside command definitions/,
		);
	});

	it("propagates Context-owned flags only to definitions added after provide()", async () => {
		const calls: string[] = [];
		const apiKey = defineFlag({ type: "string" });
		const auth = defineContext("auth")
			.flags({ "api-key": apiKey })
			.setup(({ flags }) => ({
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
			// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
			unwrap(app.run(["outer", "before"], { flags: { "api-key": "secret" } })),
		).rejects.toThrow(/Unknown flag/);
		await unwrap(app.run(["outer", "after"], { flags: { "api-key": "secret" } }));
		expect(calls).toEqual(["secret"]);
	});

	it("inherits capabilities through nested definitions", async () => {
		const calls: string[] = [];
		const verbose = defineFlag({ type: "boolean" });
		const logging = defineContext("logging")
			.flags({ verbose })
			.setup(({ flags }) => ({
				verbose: flags.verbose === true,
			}));
		const db = defineContext("db").setup(() => "database");
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
		const logging = defineContext("logging").setup(() => ({ verbose: true }));
		const db = defineContext("db").setup(() => "database");
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

	it("rejects a recipe-provided Context flag colliding with an ancestor Context's flag", async () => {
		const db = defineContext("db")
			.flags({ conn: { type: "string" } })
			.setup(() => ({}));
		const cache = defineContext("cache")
			.flags({ conn: { type: "number" } })
			.setup(() => ({}));
		// Checked attachment validates the sealed recipe against this destination.
		const sub = defineCommand("sub", (cmd) => cmd.provide(cache()).action(() => {}));
		const app = new Crust("cli").provide(db());
		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
		const invalid = app.add(sub);
		await expect(invalid.snapshot()).rejects.toThrow(
			'Flag "conn" collides with existing flag "conn" on command "sub"',
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

		const app = receiver.add(first, throwing, later);
		await expect(app.snapshot()).rejects.toBe(failure);
		expect(events).toEqual(["first", "throwing"]);
		expect(Object.keys(subCommandsOf(base._node))).toEqual([]);
		expect(Object.keys(subCommandsOf(receiver._node))).toEqual(["existing"]);
		expect(Object.keys((await receiver.snapshot()).subCommands)).toEqual(["existing"]);
	});

	it.each(["first", "existing"])(
		"checks a batch duplicate of %s before any recipe runs and stops registration",
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
			expect(events).toEqual([]);
			expect(Object.keys(subCommandsOf(base._node))).toEqual([]);
			expect(Object.keys(subCommandsOf(receiver._node))).toEqual(["existing"]);
			expect(Object.keys((await receiver.snapshot()).subCommands)).toEqual(["existing"]);
		},
	);

	it.each([
		["z", ["first"]],
		["f", []],
		["z", ["e"]],
		["e", []],
	])(
		"rejects batch name %s with aliases %j colliding with an existing or earlier spelling",
		(name: string, aliases: string[]) => {
			const receiver = new Crust("cli").add(
				defineCommand("existing", { aliases: ["e"] }, (command) => command),
			);
			const first = defineCommand("first", { aliases: ["f"] }, (command) => command);
			const duplicate = defineCommand(name, { aliases }, (command) => command);

			expect(() => receiver.add(first, duplicate)).toThrow(
				expect.objectContaining({
					message: `Command name "${name}" is already registered on this command`,
					details: { subject: "command", name, reason: "command-collision" },
				}),
			);
		},
	);

	it("runs only the routed command's recipe, so a broken sibling fails only when used", async () => {
		const configured: string[] = [];
		const good = defineCommand("good", (command) => {
			configured.push("good");
			return command.action(() => "ok");
		});
		const failure = new Error("broken recipe");
		const bad = defineCommand("bad", () => {
			configured.push("bad");
			throw failure;
		});
		const app = new Crust("cli").add(good, bad);

		expect(await unwrap(app.run(["good"]))).toMatchObject({ status: "completed", result: "ok" });
		expect(configured).toEqual(["good"]);
		expect(await app.run(["bad"])).toMatchObject({ status: "failed", error: failure });
		await expect(app.snapshot()).rejects.toBe(failure);
		expect(await unwrap(app.run(["good"]))).toMatchObject({ status: "completed", result: "ok" });
		expect(configured).toEqual(["good", "bad", "bad"]);
	});

	it("reports an unknown command without building its siblings, even a broken one", async () => {
		const configured: string[] = [];
		const failure = new Error("broken recipe");
		const app = new Crust("cli").add(
			defineCommand("good", { description: "Good", aliases: ["g"] }, (command) => {
				configured.push("good");
				return command.flags({ name: "force", type: "boolean" }).action(() => "ok");
			}),
			defineCommand("bad", () => {
				configured.push("bad");
				throw failure;
			}),
			defineCommand("hidden", { hidden: true }, (command) => command),
		);
		// Explicit reads: a deep matcher would walk, and build, every sibling's body.
		const notFound = (error: unknown) => {
			if (!(error instanceof CrustError) || !error.is("COMMAND_NOT_FOUND")) throw error;
			expect(error.details.input).toBe("typo");
			expect(error.details.available).toEqual(["good", "bad"]);
			return error.details.parentCommand;
		};

		const outcome = await app.run(["typo"] as never);
		if (outcome.status !== "failed") throw new Error("expected a failure");
		const parentCommand = notFound(outcome.error);
		let thrown: unknown;
		try {
			app.at(["typo"] as never);
		} catch (error) {
			thrown = error;
		}
		notFound(thrown);
		expect(configured).toEqual([]);

		// Child metadata is static, so reading it does not run the recipe; the body does.
		const good = parentCommand.subCommands.good!;
		expect(good.meta).toMatchObject({ name: "good", description: "Good", aliases: ["g"] });
		expect(configured).toEqual([]);
		expect(Object.keys(good.flags)).toEqual(["force"]);
		expect(configured).toEqual(["good"]);
	});

	it("keeps nested siblings deferred through recipe cloning and alias routing", async () => {
		const configured: string[] = [];
		const failure = new Error("broken nested recipe");
		const app = new Crust("cli").command("group", (command) =>
			command.add(
				defineCommand("good", { aliases: ["g"] }, (child) => {
					configured.push("good");
					return child.action(() => "ok");
				}),
				defineCommand("bad", () => {
					configured.push("bad");
					throw failure;
				}),
			),
		);

		expect(await unwrap(app.run(["group", "g"]))).toMatchObject({ result: "ok" });
		expect(configured).toEqual(["good"]);
		expect(await app.run(["group", "bad"])).toMatchObject({ status: "failed", error: failure });
		await expect(app.snapshot()).rejects.toBe(failure);
	});

	it("keeps recipes deferred through extension provider replacement and descendant shadowing", async () => {
		const configured: string[] = [];
		const context = defineContext("value").setup((_, value: string) => value);
		const options = defineContext("options")
			.flags({ name: "value", type: "string" })
			.setup(({ flags }) => flags.value);
		const id = defineExtensionId("provider");
		const group = defineCommand("group", (command) => {
			configured.push("group");
			return command
				.use(context, options)
				.command("inherited", (child) => {
					configured.push("inherited");
					return child
						.use(context, options)
						.action(async ({ ctx }) => `${await ctx.value}:${await ctx.options}`);
				})
				.command("shadowed", (child) => {
					configured.push("shadowed");
					return child
						.provide(context("local"))
						.use(options)
						.action(async ({ ctx }) => `${await ctx.value}:${await ctx.options}`);
				})
				.command("bad", () => {
					configured.push("bad");
					throw new Error("broken recipe");
				});
		});
		const base = new Crust("cli")
			.extend(defineExtension(id).provide(context("old"), options()))
			.add(group);
		const app = base
			.extend(defineExtension(defineExtensionId("noop")))
			// @ts-expect-error -- branded ids cannot prove same-id replacement at compile time.
			.extend(defineExtension(id).provide(context("new"), options()));

		expect(configured).toEqual([]);
		expect(
			await unwrap(app.run(["group", "inherited"], { flags: { value: "flag" } })),
		).toMatchObject({
			result: "new:flag",
		});
		expect(configured).toEqual(["group", "inherited"]);
		expect(
			await unwrap(app.run(["group", "shadowed"], { flags: { value: "flag" } })),
		).toMatchObject({
			result: "local:flag",
		});
		expect(configured).toEqual(["group", "inherited", "shadowed"]);
		// `base` has a different provider, so its recipes run again, against that one.
		expect(
			await unwrap(base.run(["group", "inherited"], { flags: { value: "flag" } })),
		).toMatchObject({
			result: "old:flag",
		});
		expect(configured).toEqual(["group", "inherited", "shadowed", "group", "inherited"]);
		await expect(app.snapshot()).rejects.toThrow("broken recipe");
	});

	it("runs root recipes once across apps that share the final Extension list", async () => {
		let configured = 0;
		const value = defineContext("value").setup(() => "extension");
		const app = new Crust("cli")
			.extend(defineExtension(defineExtensionId("provider")).provide(value()))
			.add(
				defineCommand("child", (command) => {
					configured++;
					return command.use(value).action(async ({ ctx }) => await ctx.value);
				}),
			);
		const derived = app.flags({ name: "verbose", type: "boolean" });

		expect(await unwrap(app.run(["child"]))).toMatchObject({ result: "extension" });
		expect(await unwrap(derived.run(["child"]))).toMatchObject({ result: "extension" });
		await derived.snapshot();
		expect(configured).toBe(1);
	});

	it("defers unused Extension command recipes", async () => {
		const configured: string[] = [];
		const app = new Crust("cli").extend(
			defineExtension(defineExtensionId("first")).add(
				defineCommand("bad", () => {
					configured.push("bad");
					throw new Error("broken Extension recipe");
				}),
			),
			defineExtension(defineExtensionId("last")).add(
				defineCommand("good", { aliases: ["g"] }, (command) => {
					configured.push("good");
					return command.action(() => "ok");
				}),
			),
		);

		expect(configured).toEqual([]);
		expect(await app.execute({ argv: ["g"] })).toBe(0);
		expect(await app.execute({ argv: ["good"] })).toBe(0);
		expect(configured).toEqual(["good"]);
		await expect(app.snapshot()).rejects.toThrow("broken Extension recipe");
	});

	it("projects rootCommand children on read, sharing the routed command's snapshot", async () => {
		const configured: string[] = [];
		const command = (name: string) =>
			defineCommand(name, (c) => {
				configured.push(name);
				// Read the context lazily: destructuring would project rootCommand up front.
				return c.action((context) => {
					const before = [...configured];
					const same = context.rootCommand.subCommands[name] === context.command;
					const afterRead = [...configured];
					const listed = Object.keys(context.rootCommand.subCommands);
					const afterKeys = [...configured];
					// Listing reads static metadata only; a child's body builds it.
					for (const child of Object.values(context.rootCommand.subCommands)) void child.meta.name;
					const afterWalk = [...configured];
					for (const child of Object.values(context.rootCommand.subCommands)) void child.flags;
					return {
						before,
						same,
						afterRead,
						listed,
						afterKeys,
						afterWalk,
						afterBodies: [...configured],
					};
				});
			});
		const app = new Crust("cli").add(command("a"), command("b"), command("c"));

		expect(await unwrap(app.run(["b"]))).toMatchObject({
			status: "completed",
			result: {
				before: ["b"],
				same: true,
				afterRead: ["b"],
				listed: ["a", "b", "c"],
				afterKeys: ["b"],
				afterWalk: ["b"],
				afterBodies: ["b", "a", "c"],
			},
		});
	});

	it("keeps chained .add() branches from a shared builder independent", async () => {
		const command = (name: string) => defineCommand(name, (c) => c.action(() => name));
		const base = new Crust("cli").add(command("a"));
		const left = base.add(command("b"));
		// `left` took over base's sibling index; `right` must not inherit "b" from it.
		const right = base.add(command("c")).add(command("b"));

		expect(Object.keys(subCommandsOf(left._node))).toEqual(["a", "b"]);
		expect(Object.keys(subCommandsOf(right._node))).toEqual(["a", "c", "b"]);
		expect(Object.keys(subCommandsOf(base._node))).toEqual(["a"]);
		expect(() => left.add(command("b"))).toThrow('Command name "b" is already registered');
		expect(() => right.add(command("c"))).toThrow('Command name "c" is already registered');
		expect(await unwrap(right.run(["c"]))).toMatchObject({ status: "completed", result: "c" });
	});

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

		expect(configured).toEqual([]);
		expect(Object.keys(subCommandsOf(base._node))).toEqual([]);
		expect(Object.keys(subCommandsOf(receiver._node))).toEqual(["existing"]);
		expect(Object.keys(subCommandsOf(app._node))).toEqual(["existing", "build", "publish"]);
		expect(configured).toEqual(["build", "publish"]);
		expect(subCommandsOf(app._node)).not.toBe(subCommandsOf(receiver._node));

		await unwrap(app.run(["build"]));
		await unwrap(app.run(["publish"]));

		expect(ran).toEqual(["build", "publish"]);
		expect(configured).toEqual(["build", "publish"]);
	});
});
