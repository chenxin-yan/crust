import { describe, expect, it } from "bun:test";

import type { Equal, Expect } from "../../tests/helpers.ts";
import { defineContext } from "../api/context.ts";
import { defineExtension } from "../api/extension.ts";
import { defineFlag } from "../api/flags.ts";
import { defineExtensionId } from "../identity.ts";
import type { CommandDefinitionBuilder } from "./crust.ts";
import { Crust, defineCommand } from "./crust.ts";

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

		await new Crust("cli").add(definition).run(["copy"], {
			args: { source: "from", destination: "to" },
			flags: { verbose: true, output: "dist" },
		});
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
			command.use(auth).action(async ({ ctx }) => {
				calls.push(String((await ctx.auth).apiKey));
			}),
		);
		const outer = defineCommand("outer", (command) =>
			command.add(before).provide(auth()).add(after),
		);
		const app = new Crust("cli").add(outer);

		await expect(
			app.run(["outer", "before"], { flags: { "api-key": "secret" } } as never),
		).rejects.toThrow(/Unknown flag/);
		await app.run(["outer", "after"], { flags: { "api-key": "secret" } });
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

		await app.run(["deploy", "status"], { flags: { verbose: true } });

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

		await app.run(["status"]);

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

		await expect(app.run(["users"], { flags: { secret: "value" } } as never)).rejects.toThrow(
			/Unknown flag/,
		);
	});

	it("rejects a recipe-provided Context flag colliding with an ancestor Context's flag", () => {
		const db = defineContext("db", { flags: [{ name: "conn", type: "string" }] }, () => ({}));
		const cache = defineContext("cache", { flags: [{ name: "conn", type: "number" }] }, () => ({}));
		// Fully typed: the sealed recipe cannot see ancestor spellings, so this
		// compiles — the collision is caught when the definition materializes.
		const sub = defineCommand("sub", (cmd) => cmd.provide(cache()).action(() => {}));
		const app = new Crust("cli").provide(db());
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
		expect(() => new Crust("cli").provide(db()).add(sub)).toThrow(
			expect.objectContaining({
				code: "DEFINITION",
				details: { subject: "flag", name: "conn", reason: "flag-collision" },
			}),
		);
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

	it("infers pulled Context values while preserving fluent action types", () => {
		const auth = defineContext("auth", () => ({ user: "yan" }));
		const region = defineContext("region", () => "us-east-1");
		const definition = defineCommand("deploy", (command) =>
			command
				.use(auth)
				.args({ name: "target", type: "string", required: true })
				.flags({ name: "force", type: "boolean", required: true })
				.provide(region())
				.action(async ({ args, flags, ctx }) => {
					const identity = await ctx.auth;
					const location = await ctx.region;
					type _Target = Expect<Equal<typeof args.target, string>>;
					type _Force = Expect<Equal<typeof flags.force, boolean>>;
					type _Auth = Expect<Equal<typeof identity, { user: string }>>;
					type _Region = Expect<Equal<typeof location, string>>;
				}),
		);

		new Crust("cli").provide(auth()).add(definition);
	});

	it("keeps root-only methods off the definition builder", () => {
		type _NoExtend = Expect<
			Equal<"extend" extends keyof CommandDefinitionBuilder ? true : false, false>
		>;
		type _NoCommand = Expect<
			Equal<"command" extends keyof CommandDefinitionBuilder ? true : false, false>
		>;
		type _NoDerive = Expect<
			Equal<"derive" extends keyof CommandDefinitionBuilder ? true : false, false>
		>;
		// `.use()` is a recipe-builder surface; Crust's declared type omits it.
		type _HasUse = Expect<Equal<"use" extends keyof CommandDefinitionBuilder ? true : false, true>>;
		type _NoCrustUse = Expect<Equal<"use" extends keyof Crust ? true : false, false>>;
		// `.command()` is root-only: on Crust, not on the definition builder.
		type _CrustCommand = Expect<Equal<"command" extends keyof Crust ? true : false, true>>;

		defineCommand("configured", (command) => {
			// @ts-expect-error -- Extensions are root-only
			command.extend(defineExtension(defineExtensionId("nested")));
			const configured = command
				.args({ name: "target", type: "string" })
				.flags({ name: "force", type: "boolean" })
				.provide(defineContext("region", () => "us")());
			type _StillNoExtend = Expect<
				Equal<"extend" extends keyof typeof configured ? true : false, false>
			>;
			return configured;
		});
	});
});
