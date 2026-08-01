import { describe, expect, it } from "bun:test";

import { context } from "../api/context.ts";
import { extension } from "../api/extension.ts";
import type { CommandDefinitionBuilder } from "./crust.ts";
import { Crust, defineCommand } from "./crust.ts";

type Assert<T extends true> = T;
type IsEqual<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

describe("command definitions", () => {
	it("stays inert and materializes a fresh named node for each mount", () => {
		let configured = 0;
		const definition = defineCommand()((command) => {
			configured++;
			return command.flags({ output: { type: "string" } });
		});

		expect(configured).toBe(0);
		const app = new Crust("cli").mount("build", definition).mount("compile", definition);

		expect(configured).toBe(2);
		expect(app._node.subCommands.build?.meta.name).toBe("build");
		expect(app._node.subCommands.compile?.meta.name).toBe("compile");
		expect(app._node.subCommands.build).not.toBe(app._node.subCommands.compile);
	});

	it("inherits flags and Contexts through nested definitions", async () => {
		const calls: string[] = [];
		const db = context("db", () => "database");
		const status = defineCommand<{
			flags: { verbose: { type: "boolean"; inherit: true } };
			ctx: { db: string };
		}>()((command) =>
			command.handle(({ flags, ctx }) => {
				calls.push(`${ctx.db}:${String(flags.verbose)}`);
			}),
		);
		const deploy = defineCommand<{
			flags: { verbose: { type: "boolean"; inherit: true } };
			ctx: { db: string };
		}>()((command) => command.mount("status", status));
		const app = new Crust("cli")
			.flags({ verbose: { type: "boolean", inherit: true } })
			.provide(db())
			.mount("deploy", deploy);

		await app.run(["deploy", "status", "--verbose"]);

		expect(calls).toEqual(["database:true"]);
	});

	it("clones annotations and isolates mounts across parents", () => {
		const annotation = Symbol("annotation");
		const definition = defineCommand()((command) => {
			const configured = command.meta({ description: "Reusable" });
			((configured as unknown as Crust)._node as unknown as Record<symbol, unknown>)[annotation] =
				"preserved";
			return configured;
		});

		const first = new Crust("first").mount("one", definition);
		const second = new Crust("second").mount("two", definition);
		const firstNode = first._node.subCommands.one;
		const secondNode = second._node.subCommands.two;

		expect(firstNode).not.toBe(secondNode);
		expect((firstNode as unknown as Record<symbol, unknown>)[annotation]).toBe("preserved");
		expect((secondNode as unknown as Record<symbol, unknown>)[annotation]).toBe("preserved");
	});

	it("rejects duplicate inherited Contexts during materialization", () => {
		const db = context("db", () => "database");
		const definition = defineCommand()((command) => command.provide(db()));

		expect(() => new Crust("cli").provide(db()).mount("users", definition)).toThrow(
			/Context "db" is already provided/,
		);
	});

	it("excludes non-inheritable parent flags from mounted commands", async () => {
		const definition = defineCommand()((command) => command.handle(() => {}));
		const app = new Crust("cli").flags({ secret: { type: "string" } }).mount("users", definition);

		await expect(app.run(["users", "--secret", "value"])).rejects.toThrow(/Unknown flag/);
	});

	it("runs mounted definitions through run and execute", async () => {
		let calls = 0;
		const definition = defineCommand()((command) =>
			command.handle(() => {
				calls++;
			}),
		);
		const app = new Crust("cli").mount("build", definition);

		await app.run(["build"]);
		await app.execute({ argv: ["build"] });

		expect(calls).toBe(2);
	});

	it("uses the same lineage checks for inline commands", () => {
		expect(() => new Crust("cli").command("bad", () => new Crust("foreign"))).toThrow(
			/same command builder/,
		);
	});

	it("validates canonical names and aliases on every mount", () => {
		const definition = defineCommand()((command) =>
			command.meta({ aliases: ["b"] }).handle(() => {}),
		);
		const app = new Crust("cli").mount("build", definition);

		expect(() => app.mount("build", definition)).toThrow(/already registered/);
		expect(() =>
			app.mount(
				"b",
				defineCommand()((command) => command),
			),
		).toThrow(/collides with alias of sibling "build"/);
		expect(() =>
			new Crust("cli")
				.mount(
					"b",
					defineCommand()((command) => command),
				)
				.mount("build", definition),
		).toThrow(/collides with sibling canonical name "b"/);
	});

	it("rejects unrelated returned builders and nested Extensions", () => {
		const unrelated = defineCommand()(() => new Crust("other") as never);
		expect(() => new Crust("cli").mount("bad", unrelated)).toThrow(/same command builder/);

		const nestedExtension = defineCommand()(
			(command) => (command as unknown as Crust).extend(extension("nested")) as never,
		);
		expect(() => new Crust("cli").mount("bad", nestedExtension)).toThrow(
			/Extensions cannot be registered inside command definitions/,
		);
	});

	it("checks requirements while preserving fluent handler types", () => {
		const verbose = { type: "boolean", inherit: true } as const;
		const auth = context("auth", () => ({ user: "yan" }));
		const definition = defineCommand<{
			flags: { verbose: typeof verbose };
			ctx: { auth: { user: string } };
		}>()((command) =>
			command
				.args([{ name: "target", type: "string", required: true }])
				.flags({ force: { type: "boolean", required: true } })
				.provide(context("region", () => "us-east-1")())
				.handle(({ args, flags, ctx }) => {
					type _Target = Assert<IsEqual<typeof args.target, string>>;
					type _Verbose = Assert<IsEqual<typeof flags.verbose, boolean | undefined>>;
					type _Force = Assert<IsEqual<typeof flags.force, boolean>>;
					type _Auth = Assert<IsEqual<typeof ctx.auth, { user: string }>>;
					type _Region = Assert<IsEqual<typeof ctx.region, string>>;
				}),
		);

		new Crust("cli").flags({ verbose }).provide(auth()).mount("deploy", definition);
		new Crust("other")
			.flags({ verbose: { ...verbose, required: true } })
			.provide(context("auth", () => ({ user: "other", admin: true }))())
			.mount("deploy", definition);

		const requiredToken = {
			type: "string",
			inherit: true,
			required: true,
			parse: (raw: string) => Number(raw),
		} as const;
		const strictDefinition = defineCommand<{
			flags: { token: typeof requiredToken };
		}>()((command) => command);
		new Crust("cli")
			.flags({
				token: {
					type: "string",
					inherit: true,
					required: true,
					parse: () => 1 as const,
				},
			})
			.mount("strict", strictDefinition);
		new Crust("cli")
			.flags({ token: { type: "string", inherit: true, parse: Number } })
			// @ts-expect-error -- an optional parent flag cannot satisfy a required requirement
			.mount("strict", strictDefinition);

		// @ts-expect-error -- missing inherited flags: verbose
		new Crust("cli").provide(auth()).mount("deploy", definition);
		new Crust("cli")
			.flags({ verbose: { type: "boolean" } })
			.provide(auth())
			// @ts-expect-error -- missing inherited flags: verbose
			.mount("deploy", definition);
		new Crust("cli")
			.flags({ verbose: { type: "string", inherit: true } })
			.provide(auth())
			// @ts-expect-error -- incompatible inherited flags: verbose
			.mount("deploy", definition);
		// @ts-expect-error -- missing Contexts: auth
		new Crust("cli").flags({ verbose }).mount("deploy", definition);
		new Crust("cli")
			.flags({ verbose })
			.provide(context("auth", () => "wrong")())
			// @ts-expect-error -- incompatible Contexts: auth
			.mount("deploy", definition);
	});

	it("keeps root-only methods off the definition builder", () => {
		type _NoExtend = Assert<
			IsEqual<"extend" extends keyof CommandDefinitionBuilder ? true : false, false>
		>;

		defineCommand()((command) => {
			// @ts-expect-error -- Extensions are root-only
			command.extend(extension("nested"));
			const configured = command
				.args([{ name: "target", type: "string" }])
				.flags({ force: { type: "boolean" } })
				.provide(context("region", () => "us")());
			type _StillNoExtend = Assert<
				IsEqual<"extend" extends keyof typeof configured ? true : false, false>
			>;
			return configured;
		});
	});

	it("checks nested requirements at the enclosing mount point", () => {
		const required = { type: "boolean", inherit: true } as const;
		const nested = defineCommand<{ flags: { verbose: typeof required } }>()((command) => command);

		defineCommand<{ flags: { verbose: typeof required } }>()((command) =>
			command.mount("nested", nested),
		);
		defineCommand()((command) => {
			// @ts-expect-error -- missing inherited flags: verbose
			return command.mount("nested", nested);
		});
	});
});
