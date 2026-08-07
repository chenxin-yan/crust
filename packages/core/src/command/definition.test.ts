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
	it("stays inert and materializes a fresh node for each mount", () => {
		let configured = 0;
		const definition = defineCommand("build", (command) => {
			configured++;
			return command.flags({ name: "output", type: "string" });
		});

		expect(configured).toBe(0);
		const app = new Crust("cli").mount(definition, definition.as("compile"));

		expect(configured).toBe(2);
		expect(app._node.subCommands.build?.meta.name).toBe("build");
		expect(app._node.subCommands.compile?.meta.name).toBe("compile");
		expect(app._node.subCommands.build).not.toBe(app._node.subCommands.compile);
	});

	it(".as() renames without mutating the original definition", () => {
		const definition = defineCommand("build", (command) => command.handle(() => {}));
		const renamed = definition.as("compile");

		expect(definition.name).toBe("build");
		expect(renamed.name).toBe("compile");
		expect(renamed).not.toBe(definition);
		type _SameRequirements = Assert<IsEqual<typeof renamed, typeof definition>>;

		expect(() => definition.as("  ")).toThrow(/non-empty/);
	});

	it("rejects an empty definition name", () => {
		expect(() => defineCommand("", (command) => command)).toThrow(/non-empty/);
		expect(() => defineCommand("   ", (command) => command)).toThrow(/non-empty/);
	});

	it("does not backfill nested definitions with later inheritable flags", async () => {
		const nested = defineCommand("nested", (command) => command.handle(() => {}));
		const outer = defineCommand("outer", (command) =>
			command.mount(nested).flags({ name: "late", type: "boolean", inherit: true }),
		);
		const app = new Crust("cli").mount(outer);

		await expect(app.run(["outer", "nested", "--late"])).rejects.toThrow(/Unknown flag/);
	});

	it("propagates Context-owned flags only to definitions mounted after provide()", async () => {
		const calls: string[] = [];
		const apiKey = defineFlag("api-key", { type: "string" });
		const auth = defineContext("auth", { flags: [apiKey] }, ({ flags }) => ({
			apiKey: flags["api-key"],
		}));
		const before = defineCommand("before", (command) => command.handle(() => {}));
		const after = defineCommand(
			"after",
			{ requires: { flags: [apiKey], ctx: [auth] } },
			(command) =>
				command.handle(({ flags, ctx }) => {
					calls.push(`${flags["api-key"]}:${ctx.auth.apiKey}`);
				}),
		);
		const outer = defineCommand("outer", (command) =>
			command.mount(before).provide(auth()).mount(after),
		);
		const app = new Crust("cli").mount(outer);

		await expect(app.run(["outer", "before", "--api-key", "secret"])).rejects.toThrow(
			/Unknown flag/,
		);
		await app.run(["outer", "after", "--api-key", "secret"]);
		expect(calls).toEqual(["secret:secret"]);
	});

	it("inherits flags and Contexts through nested definitions", async () => {
		const calls: string[] = [];
		const verbose = defineFlag("verbose", { type: "boolean", inherit: true });
		const db = defineContext("db", () => "database");
		const status = defineCommand(
			"status",
			{ requires: { flags: [verbose], ctx: [db] } },
			(command) =>
				command.handle(({ flags, ctx }) => {
					calls.push(`${ctx.db}:${String(flags.verbose)}`);
				}),
		);
		const deploy = defineCommand(
			"deploy",
			{ requires: { flags: [verbose], ctx: [db] } },
			(command) => command.mount(status),
		);
		const app = new Crust("cli").flags(verbose).provide(db()).mount(deploy);

		await app.run(["deploy", "status", "--verbose"]);

		expect(calls).toEqual(["database:true"]);
	});

	it("clones annotations and isolates mounts across parents", () => {
		const annotation = Symbol("annotation");
		const definition = defineCommand("one", (command) => {
			const configured = command.meta({ description: "Reusable" });
			((configured as unknown as Crust)._node as unknown as Record<symbol, unknown>)[annotation] =
				"preserved";
			return configured;
		});

		const first = new Crust("first").mount(definition);
		const second = new Crust("second").mount(definition.as("two"));
		const firstNode = first._node.subCommands.one;
		const secondNode = second._node.subCommands.two;

		expect(firstNode).not.toBe(secondNode);
		expect((firstNode as unknown as Record<symbol, unknown>)[annotation]).toBe("preserved");
		expect((secondNode as unknown as Record<symbol, unknown>)[annotation]).toBe("preserved");
	});

	it("rejects duplicate inherited Contexts during materialization", () => {
		const db = defineContext("db", () => "database");
		const definition = defineCommand("users", (command) => command.provide(db()));

		expect(() => new Crust("cli").provide(db()).mount(definition)).toThrow(
			/Context "db" is already provided/,
		);
	});

	it("excludes non-inheritable parent flags from mounted commands", async () => {
		const definition = defineCommand("users", (command) => command.handle(() => {}));
		const app = new Crust("cli").flags({ name: "secret", type: "string" }).mount(definition);

		await expect(app.run(["users", "--secret", "value"])).rejects.toThrow(/Unknown flag/);
	});

	it("runs mounted definitions through run and execute", async () => {
		let calls = 0;
		const definition = defineCommand("build", (command) =>
			command.handle(() => {
				calls++;
			}),
		);
		const app = new Crust("cli").mount(definition);

		await app.run(["build"]);
		await app.execute({ argv: ["build"] });

		expect(calls).toBe(2);
	});

	it("mounts multiple definitions in one variadic call", async () => {
		const ran: string[] = [];
		const build = defineCommand("build", (command) =>
			command.handle(() => {
				ran.push("build");
			}),
		);
		const publish = defineCommand("publish", (command) =>
			command.handle(() => {
				ran.push("publish");
			}),
		);
		const app = new Crust("cli").mount(build, publish);

		await app.run(["build"]);
		await app.run(["publish"]);

		expect(ran).toEqual(["build", "publish"]);
	});

	it("uses the same lineage checks for inline definitions", () => {
		expect(() =>
			new Crust("cli").mount(defineCommand("bad", () => new Crust("foreign") as never)),
		).toThrow(/same command builder/);
	});

	it("validates canonical names and aliases on every mount", () => {
		const definition = defineCommand("build", (command) =>
			command.meta({ aliases: ["b"] }).handle(() => {}),
		);
		const app = new Crust("cli").mount(definition);

		expect(() => app.mount(definition)).toThrow(/already registered/);
		expect(() => app.mount(defineCommand("b", (command) => command))).toThrow(
			/collides with alias of sibling "build"/,
		);
		expect(() =>
			new Crust("cli").mount(defineCommand("b", (command) => command)).mount(definition),
		).toThrow(/collides with sibling canonical name "b"/);
	});

	it("rejects unrelated returned builders and nested Extensions", () => {
		const unrelated = defineCommand("bad", () => new Crust("other") as never);
		expect(() => new Crust("cli").mount(unrelated)).toThrow(/same command builder/);

		const nestedExtension = defineCommand(
			"bad",
			(command) => (command as unknown as Crust).extend(defineExtension("nested")) as never,
		);
		expect(() => new Crust("cli").mount(nestedExtension)).toThrow(
			/Extensions cannot be registered inside command definitions/,
		);
	});

	it("rejects values that are not command definitions", () => {
		for (const bad of [{}, null, undefined, "definition"]) {
			expect(() => new Crust("cli").mount(bad as never)).toThrow(
				/requires a command definition created by defineCommand/,
			);
		}
	});

	it("rejects a missing recipe at definition time", () => {
		expect(() => (defineCommand as (name: string, recipe?: unknown) => unknown)("bad")).toThrow(
			/requires a recipe function/,
		);
	});

	it("checks Context requirement names at the mount call at runtime", () => {
		const db = defineContext("db", () => "database");
		const definition = defineCommand("users", { requires: { ctx: [db] } }, (command) =>
			command.handle(() => {}),
		);

		expect(() => new Crust("cli").provide(db()).mount(definition)).not.toThrow();
		expect(() => new Crust("cli").mount(definition as never)).toThrow(
			/Command "users" requires Context "db"/,
		);
	});

	it("checks requirements while preserving fluent handler types", () => {
		const verbose = defineFlag("verbose", { type: "boolean", inherit: true });
		const auth = defineContext("auth", () => ({ user: "yan" }));
		const definition = defineCommand(
			"deploy",
			{ requires: { flags: [verbose], ctx: [auth] } },
			(command) =>
				command
					.args({ name: "target", type: "string", required: true })
					.flags({ name: "force", type: "boolean", required: true })
					.provide(defineContext("region", () => "us-east-1")())
					.handle(({ args, flags, ctx }) => {
						type _Target = Assert<IsEqual<typeof args.target, string>>;
						type _Verbose = Assert<IsEqual<typeof flags.verbose, boolean | undefined>>;
						type _Force = Assert<IsEqual<typeof flags.force, boolean>>;
						type _Auth = Assert<IsEqual<typeof ctx.auth, { user: string }>>;
						type _Region = Assert<IsEqual<typeof ctx.region, string>>;
					}),
		);

		new Crust("cli").flags(verbose).provide(auth()).mount(definition);
		new Crust("other")
			.flags({ ...verbose, required: true })
			.provide(defineContext("auth", () => ({ user: "other", admin: true }))())
			.mount(definition);

		const requiredToken = defineFlag("token", {
			type: "string",
			inherit: true,
			required: true,
			parse: (raw: string) => Number(raw),
		});
		const strictDefinition = defineCommand(
			"strict",
			{ requires: { flags: [requiredToken] } },
			(command) => command,
		);
		new Crust("cli")
			.flags({
				name: "token",
				type: "string",
				inherit: true,
				required: true,
				parse: () => 1 as const,
			})
			.mount(strictDefinition);
		new Crust("cli")
			.flags({ name: "token", type: "string", inherit: true, parse: Number })
			// @ts-expect-error -- an optional parent flag cannot satisfy a required requirement
			.mount(strictDefinition);

		expect(() =>
			// @ts-expect-error -- missing inherited flags: verbose
			new Crust("cli").provide(auth()).mount(definition),
		).toThrow(/requires flag "--verbose"/);
		expect(() =>
			new Crust("cli")
				.flags({ name: "verbose", type: "boolean" })
				.provide(auth())
				// @ts-expect-error -- missing inherited flags: verbose
				.mount(definition),
		).toThrow(/requires flag "--verbose"/);
		new Crust("cli")
			.flags({ name: "verbose", type: "string", inherit: true })
			.provide(auth())
			// @ts-expect-error -- incompatible inherited flags: verbose
			.mount(definition);
		expect(() =>
			// @ts-expect-error -- missing Contexts: auth
			new Crust("cli").flags(verbose).mount(definition),
		).toThrow(/requires Context "auth"/);
		new Crust("cli")
			.flags(verbose)
			.provide(defineContext("auth", () => "wrong")())
			// @ts-expect-error -- incompatible Contexts: auth
			.mount(definition);
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

	it("checks nested requirements at the enclosing mount point", () => {
		const required = defineFlag("verbose", { type: "boolean", inherit: true });
		const nested = defineCommand(
			"nested",
			{ requires: { flags: [required] } },
			(command) => command,
		);

		defineCommand("outer", { requires: { flags: [required] } }, (command) => command.mount(nested));
		defineCommand("outer", (command) => {
			// @ts-expect-error -- missing inherited flags: verbose
			return command.mount(nested);
		});
	});
});
