import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { StandardSchema } from "@crustjs/utils/schema";
import { getAmbientTerminalIO } from "@crustjs/utils/terminal";

import { defineContext } from "../api/context.ts";
import { defineExtension } from "../api/extension.ts";
import { defineFlag } from "../api/flags.ts";
import { CrustError } from "../errors.ts";
import { defineExtensionId } from "../identity.ts";
import {
	type CommandDefinitionBuilder,
	Crust,
	defineCommand,
	type CrustCommandContext,
	BUILD_OUT_DIR_ENV,
	SNAPSHOT_PATH_ENV,
} from "./crust.ts";

// ────────────────────────────────────────────────────────────────────────────
// Type-level test utilities
// ────────────────────────────────────────────────────────────────────────────

type Expect<T extends true> = T;
type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// ────────────────────────────────────────────────────────────────────────────
// Constructor
// ────────────────────────────────────────────────────────────────────────────

describe("Crust constructor", () => {
	it("creates builder with name and optional metadata", async () => {
		const snapshot = await new Crust("my-cli", {
			description: "A test CLI",
			usage: "my-cli [options]",
		}).snapshot();
		expect(snapshot.meta).toEqual({
			name: "my-cli",
			description: "A test CLI",
			usage: "my-cli [options]",
		});
	});

	it("does not carry sibling-only metadata onto the root", async () => {
		const snapshot = await new Crust("my-cli", {
			// @ts-expect-error -- aliases belong to defineCommand() config
			aliases: ["cli"],
		}).snapshot();
		expect(snapshot.meta.aliases).toBeUndefined();
	});

	it("throws CrustError DEFINITION on empty name", () => {
		try {
			new Crust("");
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("DEFINITION");
			expect((err as CrustError).message).toContain("meta.name must be a non-empty string");
		}
	});

	it("throws CrustError DEFINITION on whitespace-only name", () => {
		try {
			new Crust("   ");
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("DEFINITION");
		}
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Builder methods — immutability + non-mutation invariants
// ────────────────────────────────────────────────────────────────────────────

describe("Crust builder methods — immutability + non-mutation", () => {
	type BuilderCase = readonly [name: string, apply: (app: Crust) => Crust];

	const builderCases: readonly BuilderCase[] = [
		[".flags()", (app) => app.flags({ name: "verbose", type: "boolean" }) as Crust],
		[".args()", (app) => app.args({ name: "file", type: "string" }) as Crust],
		[
			".provide()",
			(app) =>
				app.provide(
					defineContext("auth", { flags: [{ name: "api-key", type: "string" }] }, () => ({}))(),
				) as Crust,
		],
		[".add()", (app) => app.add(defineCommand("sub", (command) => command)) as Crust],
		[".action()", (app) => app.action(() => {}) as Crust],
	];

	it.each(builderCases)("%s returns a new instance", (_name, apply) => {
		const app = new Crust("test");
		expect(apply(app)).not.toBe(app);
	});

	it.each(builderCases)("%s does not mutate the original builder", async (_name, apply) => {
		const app = new Crust("test");
		const before = await app.snapshot();
		apply(app);
		expect(await app.snapshot()).toEqual(before);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// .flags()
// ────────────────────────────────────────────────────────────────────────────

describe("Crust .flags()", () => {
	it("returns new instance with correct flags", async () => {
		const app = new Crust("test");
		const withFlags = app.flags(
			{ name: "verbose", type: "boolean", short: "v" },
			{ name: "port", type: "number", default: 3000 },
		);

		const snapshot = await withFlags.snapshot();
		expect(snapshot.flags).toEqual({
			verbose: { type: "boolean", short: "v" },
			port: { type: "number", default: 3000 },
		});
	});

	it("deep copies flag definitions (decoupled from caller)", async () => {
		const flagDef = {
			name: "verbose" as const,
			type: "boolean" as const,
			short: "v",
		};

		const app = new Crust("test").flags(flagDef);

		// Mutating the original def should not affect the builder
		flagDef.short = "V";
		expect((await app.snapshot()).flags.verbose?.short).toBe("v");
	});

	it("throws CrustError DEFINITION at definition time on flag name starting with no-", () => {
		try {
			new Crust("test").flags({ name: "no-cache", type: "boolean" } as never);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("DEFINITION");
			expect((err as CrustError).message).toMatch(
				/Command "test" flag "--no-cache" must not use "no-" prefix/,
			);
		}
	});

	it("throws CrustError DEFINITION at definition time on aliases starting with no-", () => {
		try {
			new Crust("test").flags({ name: "cache", type: "boolean", aliases: ["no-store"] } as never);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("DEFINITION");
			expect((err as CrustError).message).toMatch(
				/Command "test" alias "--no-store" on "--cache" must not use "no-" prefix/,
			);
		}
	});

	it("throws CrustError DEFINITION at definition time on short aliases starting with no-", () => {
		try {
			new Crust("test").flags({ name: "cache", type: "boolean", short: "no-c" } as never);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("DEFINITION");
			expect((err as CrustError).message).toMatch(
				/Command "test" short alias "-no-c" on "--cache" must not use "no-" prefix/,
			);
		}
	});

	it("repeated .flags() calls accumulate runtime and action types", async () => {
		let received: { first: boolean | undefined; second: string | undefined } | undefined;
		const app = new Crust("test")
			.flags({ name: "first", type: "boolean" })
			.flags({ name: "second", type: "string" })
			.action(({ flags }) => {
				type _First = Expect<Equal<typeof flags.first, boolean | undefined>>;
				type _Second = Expect<Equal<typeof flags.second, string | undefined>>;
				received = flags;
			});

		await app.run([], { flags: { first: true, second: "value" } });
		expect(received).toEqual({ first: true, second: "value" });
		expect((await app.snapshot()).flags).toEqual({
			first: { type: "boolean" },
			second: { type: "string" },
		});
	});

	it("throws CrustError DEFINITION on flag collisions across .flags() calls", () => {
		expect(() =>
			new Crust("test").flags({ name: "verbose", type: "boolean" }).flags(
				// @ts-expect-error -- canonical name collides with a flag from an earlier call
				{ name: "verbose", type: "string" },
			),
		).toThrow(/Flag "--verbose" is already defined/);

		expect(() =>
			new Crust("test").flags({ name: "verbose", type: "boolean", short: "v" }).flags(
				// @ts-expect-error -- short alias collides with a flag from an earlier call
				{ name: "version", type: "boolean", short: "v" },
			),
		).toThrow(/spelling "v" collides with flag "--verbose"/);

		expect(() =>
			new Crust("test").flags({ name: "output", type: "string", aliases: ["out"] }).flags(
				// @ts-expect-error -- long alias collides with a flag from an earlier call
				{ name: "other", type: "string", aliases: ["out"] },
			),
		).toThrow(/spelling "out" collides with flag "--output"/);
	});

	it("throws CrustError DEFINITION on duplicate names within one .flags() call", () => {
		expect(() =>
			new Crust("test").flags(
				// @ts-expect-error -- canonical name repeated within one call
				{ name: "verbose", type: "boolean" },
				{ name: "verbose", type: "string" },
			),
		).toThrow(/already defined/);
	});

	it("falls back to runtime validation for widened flag names", () => {
		// No @ts-expect-error: widened names opt out of compile-time checks,
		// so the duplicate must be caught by the runtime twin instead.
		const dynamic = "verbose" as string;
		const app = new Crust("test").flags({ name: dynamic, type: "boolean" });
		expect(() => app.flags({ name: dynamic, type: "string" })).toThrow(
			/Flag "--verbose" is already defined/,
		);
	});

	it("retains known spellings across widened definitions and other fluent calls", () => {
		const dynamicDefs: { name: string; type: "boolean" }[] = [{ name: "dynamic", type: "boolean" }];
		const app = new Crust("test")
			.flags({ name: "verbose", type: "boolean", short: "v" })
			.flags(...dynamicDefs)
			.args({ name: "file", type: "string" })
			.extend(defineExtension(defineExtensionId("noop")));

		// Sp retention is pinned by the @ts-expect-error collision checks below:
		// if the accumulator dropped "v", they would become unused and fail the
		// typecheck.
		expect(() =>
			app.flags(
				// @ts-expect-error -- the accumulator retains "v" from before the widened call
				{ name: "version", type: "boolean", short: "v" },
			),
		).toThrow(/spelling "v" collides with flag "--verbose"/);

		const colliding = defineContext(
			"colliding",
			{ flags: [defineFlag("vv", { type: "boolean", short: "v" })] },
			() => ({}),
		);
		expect(() =>
			app.provide(
				// @ts-expect-error -- Context-owned short "v" collides with the retained spelling
				colliding(),
			),
		).toThrow(/spelling "v" collides with flag "--verbose"/);
	});

	it("accumulates Context-owned spellings for later .flags() collision checks", () => {
		const owner = defineContext(
			"owner",
			{ flags: [defineFlag("vv", { type: "boolean", short: "v" })] },
			() => ({}),
		);
		const app = new Crust("test").provide(owner());
		expect(() =>
			app.flags(
				// @ts-expect-error -- short "v" collides with the Context-owned flag provided earlier
				{ name: "version", type: "boolean", short: "v" },
			),
		).toThrow(/spelling "v" collides with flag "--vv"/);
	});

	it("throws CrustError DEFINITION on short/alias collisions within one .flags() call", () => {
		// Typed callers are caught by ValidateFlagAliases at compile time; the
		// expect-error markers simulate dynamic/untyped construction, which must
		// fail at normalization rather than at first invocation.
		expect(() =>
			new Crust("test").flags(
				// @ts-expect-error -- short "v" claimed twice in one call
				{ name: "verbose", type: "boolean", short: "v" },
				{ name: "version", type: "boolean", short: "v" },
			),
		).toThrow(/spelling "v" collides with flag "--verbose"/);

		expect(() =>
			new Crust("test").flags(
				{ name: "output", type: "string" },
				// @ts-expect-error -- alias duplicates a sibling's canonical name
				{ name: "outfile", type: "string", aliases: ["output"] },
			),
		).toThrow(/spelling "output" collides with flag "--output"/);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// .args()
// ────────────────────────────────────────────────────────────────────────────

describe("Crust .args()", () => {
	it("returns new instance with correct args", async () => {
		const app = new Crust("test");
		const withArgs = app.args(
			{ name: "file", type: "string", required: true },
			{ name: "count", type: "number", default: 1 },
		);

		expect((await withArgs.snapshot()).args).toEqual([
			{ name: "file", type: "string", required: true },
			{ name: "count", type: "number", default: 1 },
		]);
	});

	it("deep copies arg definitions (decoupled from caller)", async () => {
		const argDef = {
			name: "file" as const,
			type: "string" as const,
			description: "orig",
		};
		const app = new Crust("test").args(argDef);

		argDef.description = "changed";
		expect((await app.snapshot()).args[0]?.description).toBe("orig");
	});

	it("repeated .args() calls append in positional order and preserve action types", async () => {
		let received: { source: string; destination: string } | undefined;
		const app = new Crust("copy")
			.args({ name: "source", type: "string", required: true })
			.args({ name: "destination", type: "string", required: true })
			.action(({ args }) => {
				type _Source = Expect<Equal<typeof args.source, string>>;
				type _Destination = Expect<Equal<typeof args.destination, string>>;
				received = args;
			});

		await app.run([], { args: { source: "from", destination: "to" } });
		expect(received).toEqual({ source: "from", destination: "to" });
		expect((await app.snapshot()).args.map((arg) => arg.name)).toEqual(["source", "destination"]);
	});

	it("throws CrustError DEFINITION on an arg definition without a name", () => {
		expect(() =>
			new Crust("test").args(
				// @ts-expect-error -- missing name is also guarded at runtime
				{ type: "string" },
			),
		).toThrow(/Every argument definition must carry a non-empty name/);
	});

	it("throws CrustError DEFINITION on duplicate arg names", () => {
		expect(() =>
			new Crust("test").args({ name: "file", type: "string" }).args(
				// @ts-expect-error -- duplicate name from an earlier .args() call
				{ name: "file", type: "string" },
			),
		).toThrow(/Argument "file" is already defined/);
		expect(() =>
			new Crust("test").args(
				// @ts-expect-error -- duplicate names within one .args() call
				{ name: "file", type: "string" },
				{ name: "file", type: "string" },
			),
		).toThrow(/Argument "file" is already defined/);
	});

	it("falls back to runtime validation for widened arg names", () => {
		// No @ts-expect-error: widened names opt out of compile-time checks,
		// so the duplicate must be caught by the runtime twin instead.
		const dynamic = "file" as string;
		const app = new Crust("test").args({ name: dynamic, type: "string" });
		expect(() => app.args({ name: dynamic, type: "string" })).toThrow(
			/Argument "file" is already defined/,
		);
	});

	it("throws CrustError DEFINITION when an arg follows a variadic from an earlier call", () => {
		const app = new Crust("test").args({
			name: "files",
			type: "string",
			variadic: true,
		});
		expect(() =>
			app.args(
				// @ts-expect-error -- the variadic position is also guarded at runtime
				{ name: "destination", type: "string" },
			),
		).toThrow(/only the last positional argument can be variadic/);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Chaining .flags().args()
// ────────────────────────────────────────────────────────────────────────────

describe("Crust chaining", () => {
	it(".args().flags() preserves both on the final builder", async () => {
		const app = new Crust("test")
			.args({ name: "file", type: "string" })
			.flags({ name: "verbose", type: "boolean" });

		const snapshot = await app.snapshot();
		expect(snapshot.flags.verbose).toBeDefined();
		expect(snapshot.args).toHaveLength(1);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Command metadata
// ────────────────────────────────────────────────────────────────────────────

describe("command metadata", () => {
	it("preserves root metadata through builder calls", async () => {
		const app = new Crust("test", {
			description: "A test command",
			usage: "test [options]",
		})
			.flags({ name: "verbose", type: "boolean" })
			.args({ name: "file", type: "string" });

		expect(await app.snapshot()).toMatchObject({
			meta: {
				name: "test",
				description: "A test command",
				usage: "test [options]",
			},
			flags: { verbose: { type: "boolean" } },
			args: [{ name: "file", type: "string" }],
		});
	});

	it("applies definition metadata from config", async () => {
		const app = new Crust("cli").add(
			defineCommand(
				"sub",
				{ description: "A subcommand", usage: "cli sub [options]" },
				(command) => command,
			),
		);

		expect((await app.snapshot()).subCommands.sub?.meta).toEqual({
			name: "sub",
			description: "A subcommand",
			usage: "cli sub [options]",
		});
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Type-level tests — .flags()
// ────────────────────────────────────────────────────────────────────────────

describe("Crust type-level tests", () => {
	it(".flags() updates Flags generic", () => {
		const app = new Crust("test").flags(
			{ name: "verbose", type: "boolean", short: "v" },
			{ name: "port", type: "number", default: 3000 },
		);

		// Extract the Flags type from the phantom _types property
		type AppFlags = (typeof app)["_types"]["flags"];

		type _checkVerbose = Expect<
			Equal<AppFlags["verbose"], { readonly type: "boolean"; readonly short: "v" }>
		>;
		type _checkPort = Expect<
			Equal<AppFlags["port"], { readonly type: "number"; readonly default: 3000 }>
		>;
	});

	it(".args() updates A generic", () => {
		const app = new Crust("test").args(
			{ name: "file", type: "string", required: true },
			{ name: "count", type: "number", default: 1 },
		);

		type AppArgs = (typeof app)["_types"]["args"];

		type _checkIsReadonly = Expect<
			Equal<
				AppArgs,
				readonly [
					{
						readonly name: "file";
						readonly type: "string";
						readonly required: true;
					},
					{
						readonly name: "count";
						readonly type: "number";
						readonly default: 1;
					},
				]
			>
		>;
	});

	it("chaining .flags().args() preserves both generics", () => {
		const app = new Crust("test")
			.flags(
				{ name: "verbose", type: "boolean", short: "v" },
				{ name: "port", type: "number", default: 3000 },
			)
			.args({ name: "file", type: "string", required: true });

		// Verify the Flags generic is preserved
		type AppFlags = (typeof app)["_types"]["flags"];
		type _checkVerbose = Expect<
			Equal<AppFlags["verbose"], { readonly type: "boolean"; readonly short: "v" }>
		>;

		// Verify args A generic is preserved
		type AppArgs = (typeof app)["_types"]["args"];
		type _checkArgs = Expect<
			Equal<
				AppArgs,
				readonly [
					{
						readonly name: "file";
						readonly type: "string";
						readonly required: true;
					},
				]
			>
		>;
	});
});

// ────────────────────────────────────────────────────────────────────────────
// .add() — Runtime tests
// ────────────────────────────────────────────────────────────────────────────

describe("Crust .add() with inline definitions", () => {
	it("subcommand exposes its flags", async () => {
		const app = new Crust("cli").add(
			defineCommand("sub", (cmd) => cmd.flags({ name: "output", type: "string" })),
		);

		expect((await app.snapshot()).subCommands.sub?.flags).toEqual({
			output: { type: "string" },
		});
	});

	it("subcommand effective flags include Context-owned and local flags only", async () => {
		const verbose = defineFlag("verbose", { type: "boolean" });
		const logging = defineContext("logging", { flags: [verbose] }, () => ({}));
		const app = new Crust("cli")
			.flags({ name: "port", type: "number" })
			.provide(logging())
			.add(defineCommand("sub", (cmd) => cmd.flags({ name: "output", type: "string" })));

		expect((await app.snapshot()).subCommands.sub?.flags).toEqual({
			verbose: { type: "boolean" },
			output: { type: "string" },
		});
	});

	it("throws CrustError DEFINITION on duplicate subcommand name", () => {
		const app = new Crust("cli").add(defineCommand("sub", (cmd) => cmd));
		try {
			// @ts-expect-error -- runtime twin rejects duplicate sibling names for plain-JS consumers
			app.add(defineCommand("sub", (cmd) => cmd));
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("DEFINITION");
			expect((err as CrustError).message).toContain("already registered");
		}
	});

	it("callback receives a fresh child builder (not the parent)", async () => {
		let receivedBuilder: CommandDefinitionBuilder | undefined;

		const app = new Crust("cli").flags({ name: "verbose", type: "boolean" }).add(
			defineCommand("sub", (cmd) => {
				receivedBuilder = cmd;
				return cmd;
			}),
		);

		expect(receivedBuilder).toBeDefined();
		expect(receivedBuilder).not.toBe(app);
		const runtimeBuilder = receivedBuilder as unknown as Crust;
		expect(await runtimeBuilder.snapshot()).toMatchObject({
			meta: { name: "sub" },
			flags: {},
		});
	});

	it("multiple subcommands can be registered", async () => {
		const app = new Crust("cli")
			.add(defineCommand("sub1", (cmd) => cmd.flags({ name: "a", type: "string" })))
			.add(defineCommand("sub2", (cmd) => cmd.flags({ name: "b", type: "number" })));

		const subCommands = (await app.snapshot()).subCommands;
		expect(subCommands.sub1?.flags.a).toBeDefined();
		expect(subCommands.sub2?.flags.b).toBeDefined();
	});
});

// ────────────────────────────────────────────────────────────────────────────
// .add() — Type-level tests
// ────────────────────────────────────────────────────────────────────────────

describe("Crust .add() type-level tests", () => {
	it("rejects sibling command spelling collisions at the call site", () => {
		const issue = defineCommand("issue", { aliases: ["issues", "i"] }, (command) => command);
		const app = new Crust("cli").add(issue);

		const typecheckCollisions = () => {
			// @ts-expect-error -- duplicate sibling canonical name across .add() calls
			app.add(defineCommand("issue", (command) => command));
			// @ts-expect-error -- alias collides with a sibling canonical name
			app.add(defineCommand("info", { aliases: ["issue"] }, (command) => command));
			// @ts-expect-error -- canonical name collides with a sibling alias
			app.add(defineCommand("i", (command) => command));
			// @ts-expect-error -- .as() preserves aliases, including their collisions
			app.add(issue.as("ticket"));
			new Crust("cli").add(
				// @ts-expect-error -- collisions are checked against earlier definitions in the batch
				defineCommand("build", { aliases: ["b"] }, (command) => command),
				defineCommand("b", (command) => command),
			);
		};
		void typecheckCollisions;

		const dynamicName = "dynamic" as string;
		const dynamic = defineCommand(dynamicName, (command) => command);
		new Crust("cli").add(dynamic).add(defineCommand("static", (command) => command));

		expect(true).toBe(true);
	});

	it("rejects invalid command alias shapes at defineCommand()", () => {
		const typecheckAliasShapes = () => {
			// @ts-expect-error -- aliases must be non-empty
			defineCommand("issue", { aliases: [""] }, (command) => command);
			// @ts-expect-error -- aliases must not start with a dash
			defineCommand("issue", { aliases: ["-i"] }, (command) => command);
			// @ts-expect-error -- aliases must not contain spaces
			defineCommand("issue", { aliases: ["my issue"] }, (command) => command);
			// @ts-expect-error -- aliases must not contain tabs
			defineCommand("issue", { aliases: ["my\tissue"] }, (command) => command);
			// @ts-expect-error -- aliases must differ from their own canonical name
			defineCommand("issue", { aliases: ["issue"] }, (command) => command);
		};
		void typecheckAliasShapes;

		expect(true).toBe(true);
	});

	it("types pulled capabilities and local values in actions", () => {
		const verbose = defineFlag("verbose", { type: "boolean" });
		const logging = defineContext("logging", { flags: [verbose] }, ({ flags }) => ({
			verbose: flags.verbose === true,
		}));
		new Crust("cli")
			.flags({ name: "rootOnly", type: "string" })
			.provide(logging())
			.add(
				defineCommand("level1", { uses: [logging] }, (command) =>
					command.add(
						defineCommand("level2", { uses: [logging] }, (child) =>
							child
								.args({ name: "target", type: "string", required: true })
								.action(async ({ args, flags, ctx }) => {
									const log = await ctx.logging;
									type _target = Expect<Equal<typeof args.target, string>>;
									type _verbose = Expect<Equal<typeof log.verbose, boolean>>;
									// @ts-expect-error -- ancestor-owned flags are parsed but not action-visible
									void flags.verbose;
									// @ts-expect-error -- root-local flags do not propagate
									void flags.rootOnly;
								}),
						),
					),
				),
			);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// .action() — Runtime tests
// ────────────────────────────────────────────────────────────────────────────

describe("Crust .action()", () => {
	it("runs the action with parsed context", async () => {
		let receivedCtx: CrustCommandContext | undefined;
		const app = new Crust("test")
			.flags({ name: "verbose", type: "boolean" })
			.args({ name: "file", type: "string", required: true })
			.action((context) => {
				receivedCtx = context as unknown as CrustCommandContext;
			});

		await app.run([], { args: { file: "test.txt" }, flags: { verbose: true } });

		expect(receivedCtx).toMatchObject({
			args: { file: "test.txt" },
			flags: { verbose: true },
		});
	});

	it("throws CrustError DEFINITION instead of replacing an existing action", () => {
		const app = new Crust("test").action(() => {});
		let error: unknown;
		try {
			app.action(() => {});
		} catch (cause) {
			error = cause;
		}
		expect(error).toMatchObject({
			code: "DEFINITION",
			message: 'Command "test" already has an action',
			details: { subject: "command", name: "test", reason: "duplicate-action" },
		});
	});

	it("preserves the definition and can follow .add()", async () => {
		const app = new Crust("cli")
			.flags({ name: "verbose", type: "boolean" })
			.args({ name: "file", type: "string" })
			.add(defineCommand("sub", (command) => command))
			.action(() => {});

		expect(await app.snapshot()).toMatchObject({
			hasAction: true,
			flags: { verbose: { type: "boolean" } },
			args: [{ name: "file", type: "string" }],
			subCommands: { sub: { meta: { name: "sub" } } },
		});
	});
});

// ────────────────────────────────────────────────────────────────────────────
// .action() — Type-level tests
// ────────────────────────────────────────────────────────────────────────────

describe("Crust .action() type-level tests", () => {
	it("action receives InferArgs<A> for args", () => {
		new Crust("test")
			.args(
				{ name: "file", type: "string", required: true },
				{ name: "count", type: "number", default: 5 },
			)
			.action((_ctx) => {
				type CtxArgs = typeof _ctx.args;
				type _checkFile = Expect<Equal<CtxArgs["file"], string>>;
				type _checkCount = Expect<Equal<CtxArgs["count"], number>>;
			});
	});

	it("variadic args resolve to array type in action", () => {
		new Crust("test").args({ name: "files", type: "string", variadic: true }).action((_ctx) => {
			type CtxArgs = typeof _ctx.args;
			type _checkFiles = Expect<Equal<CtxArgs["files"], string[]>>;
		});
	});

	it("multiple flag resolves to array type in action", () => {
		new Crust("test")
			.flags({ name: "tags", type: "string", multiple: true, required: true })
			.action((_ctx) => {
				type CtxFlags = typeof _ctx.flags;
				type _checkTags = Expect<Equal<CtxFlags["tags"], string[]>>;
			});
	});

	it("optional flag resolves to union with undefined in action", () => {
		new Crust("test").flags({ name: "port", type: "number" }).action((_ctx) => {
			type CtxFlags = typeof _ctx.flags;
			type _checkPort = Expect<Equal<CtxFlags["port"], number | undefined>>;
		});
	});

	it("required flag resolves to non-optional type in action", () => {
		new Crust("test").flags({ name: "name", type: "string", required: true }).action((_ctx) => {
			type CtxFlags = typeof _ctx.flags;
			type _checkName = Expect<Equal<CtxFlags["name"], string>>;
		});
	});

	it("flag with default resolves to non-optional type in action", () => {
		new Crust("test").flags({ name: "port", type: "number", default: 3000 }).action((_ctx) => {
			type CtxFlags = typeof _ctx.flags;
			type _checkPort = Expect<Equal<CtxFlags["port"], number>>;
		});
	});
});

// ────────────────────────────────────────────────────────────────────────────
// .extend() — Runtime tests
// ────────────────────────────────────────────────────────────────────────────

describe("Crust .extend()", () => {
	it("runs Extensions in registration order", async () => {
		const calls: string[] = [];
		const extension = (name: string) =>
			defineExtension(defineExtensionId(name), {
				hooks: {
					preRun: () => {
						calls.push(name);
					},
				},
			});
		const app = new Crust("test")
			.extend(extension("one"))
			.extend(extension("two"), extension("three"))
			.action(() => {});

		await app.run([]);
		expect(calls).toEqual(["one", "two", "three"]);
	});

	it("throws CrustError DEFINITION on duplicate Extension names", () => {
		const first = defineExtension(defineExtensionId("duplicate"));
		const second = defineExtension(defineExtensionId("duplicate"));

		expect(() => new Crust("test").extend(first).extend(second)).toThrow(
			/Extension "duplicate" is already registered/,
		);
		expect(() => new Crust("test").extend(first, second)).toThrow(
			/Extension "duplicate" is already registered/,
		);
	});

	it("defineExtension() returns a frozen plain config", () => {
		const ext = defineExtension(defineExtensionId("frozen"), {
			flags: [{ name: "x", type: "boolean" }],
		});

		expect(Object.isFrozen(ext)).toBe(true);
		expect(ext.id as string).toBe("frozen");
		expect(ext.flags).toEqual({ x: { type: "boolean" } });
	});

	it("infers Extension-owned flags in hook contexts", () => {
		const ext = defineExtension(defineExtensionId("typed-flags"), {
			flags: [
				{ name: "verbose", type: "boolean", default: false },
				{ name: "rootPort", type: "number", default: 3000, recursive: false },
				{ name: "token", type: "string", required: true },
				{
					name: "endpoint",
					type: "string",
					schema: {} as StandardSchema<string | undefined, URL>,
				},
				{
					name: "tags",
					type: "string",
					multiple: true,
					schema: {} as StandardSchema<string[], string[]>,
				},
			],
			hooks: {
				preRun(ctx) {
					type _verbose = Expect<Equal<typeof ctx.flags.verbose, boolean>>;
					type _rootPort = Expect<Equal<typeof ctx.flags.rootPort, number | undefined>>;
					// Hooks run before validation, so a required flag may still be absent.
					type _token = Expect<Equal<typeof ctx.flags.token, string | undefined>>;
					// Schema flags reflect the raw syntax token, not the schema output.
					type _endpoint = Expect<Equal<typeof ctx.flags.endpoint, string | undefined>>;
					type _tags = Expect<Equal<typeof ctx.flags.tags, string[] | undefined>>;
					type _commandFlag = Expect<Equal<typeof ctx.flags.commandFlag, unknown>>;
					const commandFlag: unknown = ctx.flags.commandFlag;
					void commandFlag;
				},
			},
		});

		expect(ext.id as string).toBe("typed-flags");
	});

	it("infers defineFlag() values attached to an Extension", () => {
		const trace = defineFlag("trace", { type: "boolean", default: false });
		const ext = defineExtension(defineExtensionId("defined-flags"), {
			flags: [trace],
			hooks: {
				preRun(ctx) {
					type _trace = Expect<Equal<typeof ctx.flags.trace, boolean>>;
				},
			},
		});

		expect(ext.flags?.trace).toEqual({ type: "boolean", default: false });
	});

	it("defineExtension() rejects duplicate owned flag names at define time", () => {
		const flags = [
			{ name: "mode", type: "string" },
			{ name: "mode", type: "number" },
		] as const;
		const define = () =>
			defineExtension(defineExtensionId("duplicate-flags"), { flags: flags as never });

		expect(define).toThrow(CrustError);
		try {
			define();
			expect.unreachable();
		} catch (error) {
			expect(error).toMatchObject({
				code: "DEFINITION",
				message:
					'Extension "duplicate-flags" flag "--mode" spelling "mode" collides with flag "--mode"',
			});
		}
	});

	it("defineExtension() surfaces intra-extension spelling collisions at define time", () => {
		const flags = [
			{ name: "loud", type: "boolean", short: "v" },
			{ name: "verbose", type: "boolean", short: "v" },
		] as const;

		expect(() =>
			defineExtension(defineExtensionId("short-clash"), { flags: flags as never }),
		).toThrow('Extension "short-clash" flag "--verbose" spelling "v" collides with flag "--loud"');
	});

	it("defineExtension() rejects a flag definition without a name", () => {
		expect(() =>
			defineExtension(defineExtensionId("nameless"), { flags: [{ type: "boolean" }] as never }),
		).toThrow("Every flag definition must carry a non-empty name");
	});

	it("defineExtension() rejects mixing a schema with core options", () => {
		const flags = [
			{
				name: "endpoint",
				type: "string",
				schema: {} as StandardSchema<string | undefined, URL>,
				default: "http://localhost",
			},
		] as const;

		expect(() =>
			defineExtension(defineExtensionId("schema-mix"), { flags: flags as never }),
		).toThrow(/schema exclusively owns/);
	});

	it("preserves the command definition when extending", async () => {
		const app = new Crust("test")
			.flags({ name: "verbose", type: "boolean" })
			.args({ name: "file", type: "string" })
			.add(defineCommand("sub", (command) => command))
			.action(() => {})
			.extend(defineExtension(defineExtensionId("test-extension")));

		expect(await app.snapshot()).toMatchObject({
			hasAction: true,
			flags: { verbose: { type: "boolean" } },
			args: [{ name: "file", type: "string" }],
			subCommands: { sub: { meta: { name: "sub" } } },
		});
	});

	it("intermediate builders retain independent Extension lists", async () => {
		const calls: string[] = [];
		const extension = (name: string) =>
			defineExtension(defineExtensionId(name), {
				hooks: {
					preRun: () => {
						calls.push(name);
					},
				},
			});
		const base = new Crust("test").extend(extension("one")).action(() => {});
		const extended = base.extend(extension("two"));

		await base.run([]);
		expect(calls).toEqual(["one"]);
		calls.length = 0;
		await extended.run([]);
		expect(calls).toEqual(["one", "two"]);
	});
});

describe("Extension application at prepare time", () => {
	it("recursive Extension flags reach every command, including Extension commands", async () => {
		const seen: Record<string, unknown>[] = [];
		const debug = defineExtension(defineExtensionId("debug"), {
			flags: [{ name: "debug", type: "boolean" }],
		});

		const app = new Crust("cli").extend(debug).add(
			defineCommand("sub", (cmd) =>
				cmd.action(({ flags }) => {
					seen.push(flags);
				}),
			),
		);

		await app.execute({ argv: ["sub", "--debug"] });

		expect(seen[0]?.debug).toBe(true);
	});

	it("non-recursive Extension flags stay on the root", async () => {
		const version = defineExtension(defineExtensionId("version"), {
			flags: [{ name: "version", type: "boolean", recursive: false }],
		});

		let ran = false;
		const app = new Crust("cli")
			.extend(version)
			.add(defineCommand("sub", (cmd) => cmd.action(() => {})))
			.action(({ flags }) => {
				ran = (flags as Record<string, unknown>).version === true;
			});

		// Extension flags only exist on the prepared tree, so this must go through
		// execute(): --version parses on the root but is unknown on the subcommand.
		const stderr: string[] = [];
		const originalExitCode = process.exitCode;
		try {
			await app.execute({ argv: ["--version"], io: { stderr: (text) => stderr.push(text) } });
			expect(ran).toBe(true);
			await app.execute({
				argv: ["sub", "--version"],
				io: { stderr: (text) => stderr.push(text) },
			});
		} finally {
			process.exitCode = originalExitCode;
		}
		expect(stderr.join("\n")).toContain("--version");
	});

	it("Extension flag colliding with an application flag is a DEFINITION error", async () => {
		const clash = defineExtension(defineExtensionId("clash"), {
			flags: [{ name: "verbose", type: "boolean" }],
		});
		const app = new Crust("cli")
			.flags({ name: "verbose", type: "boolean" })
			.extend(clash)
			.action(() => {});

		await expect(app.run([])).rejects.toMatchObject({ code: "DEFINITION" });
	});

	it("Extension flag short/alias collisions are DEFINITION errors at prepare time", async () => {
		const clash = defineExtension(defineExtensionId("clash"), {
			flags: [{ name: "loud", type: "boolean", short: "v" }],
		});
		const app = new Crust("cli")
			.flags({ name: "verbose", type: "boolean", short: "v" })
			.extend(clash)
			.action(() => {});

		await expect(app.run([])).rejects.toMatchObject({ code: "DEFINITION" });
	});

	it("Extension flag colliding with another Extension's flag is a DEFINITION error", async () => {
		const a = defineExtension(defineExtensionId("a"), {
			flags: [{ name: "shared", type: "boolean" }],
		});
		const b = defineExtension(defineExtensionId("b"), {
			flags: [{ name: "shared", type: "boolean" }],
		});
		const app = new Crust("cli").extend(a, b).action(() => {});

		await expect(app.run([])).rejects.toMatchObject({ code: "DEFINITION" });
	});

	it("Extension command definitions are routable, validated, and receive recursive flags", async () => {
		const lines: string[] = [];
		const errors: string[] = [];
		const completion = defineExtension(defineExtensionId("completion"), {
			commands: [
				defineCommand("completion", (command) =>
					command
						.args({
							name: "shell",
							type: "string",
							required: true,
							choices: ["bash", "zsh"],
						})
						.action(({ args, flags, rootCommand }) => {
							lines.push(
								`completion:${args.shell}:${(flags as Record<string, unknown>).verbose}:${rootCommand.meta.name}`,
							);
						}),
				),
			],
			hooks: {
				onError(error) {
					errors.push((error as CrustError).code);
					return true;
				},
			},
		});
		const verbose = defineExtension(defineExtensionId("verbose"), {
			flags: [{ name: "verbose", type: "boolean" }],
		});

		const app = new Crust("cli").extend(completion, verbose).action(() => {});

		const originalExitCode = process.exitCode;
		try {
			await app.execute({ argv: ["completion", "bash", "--verbose"] });
			await app.execute({ argv: ["completion", "fish"] });
			await app.execute({ argv: ["completion"] });
		} finally {
			process.exitCode = originalExitCode;
		}
		expect(lines).toEqual(["completion:bash:true:cli"]);
		expect(errors).toEqual(["PARSE", "VALIDATION"]);
	});

	it("Extension command colliding with an application command is a DEFINITION error", async () => {
		const clash = defineExtension(defineExtensionId("clash"), {
			commands: [defineCommand("sub", (command) => command.action(() => {}))],
		});
		const app = new Crust("cli")
			.add(defineCommand("sub", (cmd) => cmd.action(() => {})))
			.extend(clash);

		await expect(app.run(["sub"])).rejects.toMatchObject({
			code: "DEFINITION",
		});
	});

	it("rejects non-definition Extension commands", async () => {
		const invalid = defineExtension(defineExtensionId("invalid"), { commands: [{} as never] });

		await expect(new Crust("cli").extend(invalid).run([])).rejects.toMatchObject({
			code: "DEFINITION",
			message: 'Extension "invalid" requires a command definition created by defineCommand()',
		});
	});

	it("attributes foreign builders returned by Extension command definitions", async () => {
		const invalid = defineExtension(defineExtensionId("invalid"), {
			commands: [defineCommand("foreign", () => new Crust("other") as never)],
		});

		await expect(new Crust("cli").extend(invalid).run([])).rejects.toMatchObject({
			code: "DEFINITION",
			message:
				'Extension "invalid" command "foreign" definition must return the same command builder it received',
			details: {
				subject: "extension",
				name: "invalid",
				reason: "foreign-command-builder",
			},
		});
	});

	it("attributes nested Extensions inside Extension command definitions", async () => {
		const invalid = defineExtension(defineExtensionId("invalid"), {
			commands: [
				defineCommand(
					"nested",
					(command) =>
						(command as unknown as Crust).extend(
							defineExtension(defineExtensionId("nested-extension")),
						) as never,
				),
			],
		});

		await expect(new Crust("cli").extend(invalid).run([])).rejects.toMatchObject({
			code: "DEFINITION",
			message:
				'Extension "invalid" command "nested" cannot register Extensions inside command definitions',
			details: {
				subject: "extension",
				name: "invalid",
				reason: "nested-command-extension",
			},
		});
	});

	it("reuses one application across executions while running hooks each time", async () => {
		const calls: string[] = [];
		const debug = defineExtension(defineExtensionId("debug"), {
			flags: [{ name: "debug", type: "boolean" }],
			hooks: {
				preRun: () => {
					calls.push("pre");
				},
				postRun: () => {
					calls.push("post");
				},
			},
		});
		const app = new Crust("repeat").extend(debug).action(({ flags }) => {
			if ((flags as Record<string, unknown>).debug) calls.push("action");
		});

		await app.execute({ argv: ["--debug"] });
		await app.execute({ argv: ["--debug"] });

		expect(calls).toEqual(["pre", "action", "post", "pre", "action", "post"]);
	});

	it("builders derived after a run see their own commands without affecting the original", async () => {
		const calls: string[] = [];
		const app = new Crust("derive").action(() => {
			calls.push("root");
		});

		await app.run([]);

		const derived = app.add(
			defineCommand("extra", (command) =>
				command.action(() => {
					calls.push("extra");
				}),
			),
		);

		await derived.run(["extra"]);
		// the original builder must not see the derived command: its typed tree
		// has no "extra" path, so the forced path fails to resolve
		await expect(app.run(["extra"] as never)).rejects.toMatchObject({
			code: "COMMAND_NOT_FOUND",
			details: { input: "extra" },
		});

		expect(calls).toEqual(["root", "extra"]);
	});

	it("materializes Extension command recipes once per builder across runs", async () => {
		let materialized = 0;
		const calls: string[] = [];
		const tools = defineExtension(defineExtensionId("tools"), {
			commands: [
				defineCommand("sub", (command) => {
					materialized++;
					return command.action(() => {
						calls.push("sub");
					});
				}),
			],
		});
		const app = new Crust("cli").extend(tools).action(() => {});

		await app.execute({ argv: ["sub"] });
		await app.execute({ argv: ["sub"] });

		// The action still runs per dispatch, but the recipe that builds the
		// command tree runs once per builder instance (prepared tree is cached).
		expect(calls).toEqual(["sub", "sub"]);
		expect(materialized).toBe(1);
	});

	it("does not cache a failed preparation: a throwing recipe is retried", async () => {
		let attempts = 0;
		const flaky = defineExtension(defineExtensionId("flaky"), {
			commands: [
				defineCommand("sub", (command) => {
					attempts++;
					if (attempts === 1) throw new Error("recipe boom");
					return command.action(() => {});
				}),
			],
		});
		const app = new Crust("cli").extend(flaky).action(() => {});

		await expect(app.snapshot()).rejects.toThrow("recipe boom");
		await app.snapshot();

		expect(attempts).toBe(2);
	});

	it("extending a builder after a cached run affects only the derived builder", async () => {
		const calls: string[] = [];
		const audit = defineExtension(defineExtensionId("audit"), {
			hooks: {
				preRun: () => {
					calls.push("audit");
				},
			},
		});
		const app = new Crust("cli").action(() => {
			calls.push("root");
		});

		await app.run([]);
		const derived = app.extend(audit);
		await derived.run([]);
		await app.run([]);

		expect(calls).toEqual(["root", "audit", "root", "root"]);
	});
});

describe("Extension named hooks", () => {
	it("runs pre-run hooks in extension order and finish skips later hooks and the action", async () => {
		const order: string[] = [];
		const first = defineExtension(defineExtensionId("first"), {
			hooks: {
				preRun: () => {
					order.push("first");
				},
			},
		});
		const gate = defineExtension(defineExtensionId("gate"), {
			hooks: {
				preRun(ctx) {
					order.push("gate");
					return ctx.finish();
				},
			},
		});
		const last = defineExtension(defineExtensionId("last"), {
			hooks: {
				preRun: () => {
					order.push("last");
				},
			},
		});
		const app = new Crust("cli")
			.args({ name: "file", type: "string", required: true })
			.extend(first, gate, last)
			.action(() => {
				order.push("action");
			});

		await app.run([], { args: { file: "unused" } });
		expect(order).toEqual(["first", "gate"]);
	});

	it("runs post-run hooks LIFO for completed, failed, and finished invocations", async () => {
		const outcomes: string[] = [];
		const first = defineExtension(defineExtensionId("first"), {
			hooks: {
				postRun: (_ctx, outcome) => {
					outcomes.push(`first:${outcome.status}`);
				},
			},
		});
		const second = defineExtension(defineExtensionId("second"), {
			hooks: {
				postRun: (_ctx, outcome) => {
					outcomes.push(`second:${outcome.status}`);
				},
			},
		});

		await new Crust("cli")
			.extend(first, second)
			.action(() => {})
			.run([]);
		expect(outcomes).toEqual(["second:completed", "first:completed"]);

		outcomes.length = 0;
		await expect(
			new Crust("cli")
				.extend(first, second)
				.action(() => {
					throw new Error("boom");
				})
				.run([]),
		).rejects.toThrow("boom");
		expect(outcomes).toEqual(["second:failed", "first:failed"]);

		outcomes.length = 0;
		const gate = defineExtension(defineExtensionId("gate"), {
			hooks: { preRun: (ctx) => ctx.finish() },
		});
		await new Crust("cli")
			.extend(first, gate, second)
			.action(() => {})
			.run([]);
		expect(outcomes).toEqual(["second:finished", "first:finished"]);
	});

	it("reports the finishing Extension and exposes parsed snapshots before validation", async () => {
		let outcomeBy = "";
		let seenPort: unknown;
		const gate = defineExtension(defineExtensionId("gate"), {
			hooks: {
				preRun(ctx) {
					seenPort = ctx.flags.port;
					return ctx.finish();
				},
				postRun(_ctx, outcome) {
					outcomeBy = outcome.status === "finished" ? outcome.by : "";
				},
			},
		});
		await new Crust("cli")
			.flags({ name: "port", type: "number", required: true })
			.extend(gate)
			.action(() => {})
			.run([], { flags: { port: 8080 } });

		expect(seenPort).toBe(8080);
		expect(outcomeBy).toBe("gate");
	});

	it("does not run hooks for routing failures and exposes frozen snapshots with injected io", async () => {
		let preRunCalled = false;
		const lines: string[] = [];
		const probe = defineExtension(defineExtensionId("probe"), {
			hooks: {
				preRun(ctx) {
					preRunCalled = true;
					expect(Object.isFrozen(ctx.rootCommand)).toBe(true);
					expect(Object.isFrozen(ctx.command)).toBe(true);
					expect(() => structuredClone(ctx.rootCommand)).not.toThrow();
					ctx.stdout(`probe:${ctx.command.meta.name}`);
				},
			},
		});
		const app = new Crust("cli")
			.extend(probe)
			.add(defineCommand("known", (cmd) => cmd.action(() => {})));

		await app.run(["known"], undefined, { stdout: (line) => lines.push(line) });
		expect(lines).toEqual(["probe:known"]);
		preRunCalled = false;
		await expect(app.run(["unknown"] as never)).rejects.toMatchObject({
			code: "COMMAND_NOT_FOUND",
		});
		expect(preRunCalled).toBe(false);
	});

	it("preserves a failed invocation over post-run errors and fails success with the first cleanup error", async () => {
		const original = new Error("original");
		const cleanup = defineExtension(defineExtensionId("cleanup"), {
			hooks: {
				postRun() {
					throw new Error("cleanup");
				},
			},
		});
		await expect(
			new Crust("cli")
				.extend(cleanup)
				.action(() => {
					throw original;
				})
				.run([]),
		).rejects.toBe(original);

		const calls: string[] = [];
		const first = defineExtension(defineExtensionId("first"), {
			hooks: {
				postRun() {
					calls.push("first");
					throw new Error("first cleanup");
				},
			},
		});
		const second = defineExtension(defineExtensionId("second"), {
			hooks: {
				postRun() {
					calls.push("second");
					throw new Error("second cleanup");
				},
			},
		});
		await expect(
			new Crust("cli")
				.extend(first, second)
				.action(() => {})
				.run([]),
		).rejects.toThrow("second cleanup");
		expect(calls).toEqual(["second", "first"]);
	});

	it("passes the application root snapshot to app and Extension command actions", async () => {
		const roots: string[] = [];
		const extension = defineExtension(defineExtensionId("extension"), {
			commands: [
				defineCommand("owned", (command) =>
					command.action(({ rootCommand }) => {
						roots.push(rootCommand.meta.name);
					}),
				),
			],
		});
		const app = new Crust("cli").extend(extension).action(({ rootCommand }) => {
			roots.push(rootCommand.meta.name);
		});

		await app.run([]);
		await app.execute({ argv: ["owned"] });
		expect(roots).toEqual(["cli", "cli"]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// .execute() — Full execution pipeline tests
// ────────────────────────────────────────────────────────────────────────────

describe("Extension onError hooks", () => {
	let originalLog: typeof console.log;
	let originalError: typeof console.error;
	let originalExitCode: number | string | null | undefined;
	let stderrChunks: string[];

	beforeEach(() => {
		originalLog = console.log;
		originalError = console.error;
		originalExitCode = process.exitCode;
		stderrChunks = [];
		console.error = (...args: unknown[]) => {
			stderrChunks.push(args.map(String).join(" "));
		};
		process.exitCode = 0;
	});

	afterEach(() => {
		console.log = originalLog;
		console.error = originalError;
		process.exitCode = originalExitCode;
	});

	const failing = () =>
		new Crust("cli").action(() => {
			throw new Error("boom");
		});

	it("stops at the first truthy result and retains the nonzero exit status", async () => {
		const order: string[] = [];
		const first = defineExtension(defineExtensionId("first"), {
			hooks: { onError: () => (order.push("first"), undefined) },
		});
		const presenter = defineExtension(defineExtensionId("presenter"), {
			hooks: {
				onError(error, ctx) {
					order.push("presenter");
					ctx.stderr(`pretty: ${(error as Error).message}`);
					return true;
				},
			},
		});
		const never = defineExtension(defineExtensionId("never"), {
			hooks: {
				onError: () => {
					order.push("never");
				},
			},
		});

		await failing().extend(first, presenter, never).execute({ argv: [] });
		expect(order).toEqual(["first", "presenter"]);
		expect(stderrChunks.join("\n")).toContain("pretty: boom");
		expect(stderrChunks.join("\n")).not.toContain("Error: boom");
		expect(process.exitCode).toBe(1);
	});

	it("keeps invocation Contexts live through onError and disposes them afterwards", async () => {
		let disposed = false;
		let pulled = false;
		const resource = defineContext("resource", () => ({
			[Symbol.dispose]() {
				disposed = true;
			},
		}));
		const observer = defineExtension(defineExtensionId("observer"), {
			uses: [resource],
			hooks: {
				async onError(_error, ctx) {
					await ctx.ctx.resource;
					pulled = true;
					return true;
				},
			},
		});
		const app = new Crust("cli")
			.provide(resource())
			.extend(observer)
			.action(async ({ ctx }) => {
				await ctx.resource;
				throw new Error("boom");
			});

		await app.execute({ argv: [] });
		expect(pulled).toBe(true);
		expect(disposed).toBe(true);
	});

	it("passes the same context identity from preRun to onError", async () => {
		let preRunContext: unknown;
		let onErrorContext: unknown;
		const observer = defineExtension(defineExtensionId("observer"), {
			hooks: {
				preRun(ctx) {
					preRunContext = ctx;
				},
				onError(_error, ctx) {
					onErrorContext = ctx;
					return true;
				},
			},
		});

		await failing().extend(observer).execute({ argv: [] });
		expect(onErrorContext).toBe(preRunContext);
	});

	it("attributes handled and core-rendered failures before postRun", async () => {
		const handled: unknown[] = [];
		const unhandled: unknown[] = [];
		const presenterId = defineExtensionId("presenter");
		const presenter = defineExtension(presenterId, {
			hooks: {
				onError: () => true,
				postRun: (_ctx, outcome) => void handled.push(outcome),
			},
		});
		const observer = defineExtension(defineExtensionId("observer"), {
			hooks: { postRun: (_ctx, outcome) => void unhandled.push(outcome) },
		});

		await failing().extend(presenter).execute({ argv: [] });
		await failing().extend(observer).execute({ argv: [] });
		expect(handled[0]).toMatchObject({ status: "failed", by: presenterId });
		expect(Object.isFrozen(handled[0])).toBe(true);
		expect(unhandled[0]).toMatchObject({ status: "failed" });
		expect(unhandled[0]).not.toHaveProperty("by");
	});

	it("falls through to Core's renderer without attribution when an onError hook throws", async () => {
		let laterRan = false;
		const outcomes: unknown[] = [];
		const thrower = defineExtension(defineExtensionId("thrower"), {
			hooks: {
				onError: () => {
					throw new Error("renderer broke");
				},
				postRun: (_ctx, outcome) => void outcomes.push(outcome),
			},
		});
		const later = defineExtension(defineExtensionId("later"), {
			hooks: {
				onError: () => {
					laterRan = true;
					return true;
				},
			},
		});

		await failing().extend(thrower, later).execute({ argv: [] });
		expect(laterRan).toBe(false);
		expect(stderrChunks.join("\n")).toContain("Error: boom");
		expect(outcomes[0]).toMatchObject({ status: "failed" });
		expect(outcomes[0]).not.toHaveProperty("by");
		expect(process.exitCode).toBe(1);
	});

	it("falls through to Core's default renderer and never runs for run()", async () => {
		let onErrorRan = false;
		const observer = defineExtension(defineExtensionId("observer"), {
			hooks: {
				onError() {
					onErrorRan = true;
				},
			},
		});

		await failing().extend(observer).execute({ argv: [] });
		expect(stderrChunks.join("\n")).toContain("Error: boom");
		expect(onErrorRan).toBe(true);

		onErrorRan = false;
		stderrChunks = [];
		await expect(failing().extend(observer).run([])).rejects.toThrow("boom");
		expect(onErrorRan).toBe(false);
		expect(stderrChunks).toEqual([]);
	});
});

describe("Crust .run()", () => {
	let originalExitCode: number | string | null | undefined;

	beforeEach(() => {
		originalExitCode = process.exitCode;
		process.exitCode = 0;
	});

	afterEach(() => {
		process.exitCode = originalExitCode;
	});

	it("throws the original CrustError without rendering or setting exitCode", async () => {
		const stderrLines: string[] = [];
		const app = new Crust("test").flags({ name: "port", type: "number" }).action(() => {});

		await expect(
			app.run([], { flags: { unknown: true } } as never, {
				stderr: (text) => stderrLines.push(text),
			}),
		).rejects.toMatchObject({ code: "PARSE" });
		expect(stderrLines).toEqual([]);
		// run() never touches process status
		expect(process.exitCode).toBe(0);
	});

	it("throws the original action error unwrapped", async () => {
		const boom = new Error("action exploded");
		const app = new Crust("test").action(() => {
			throw boom;
		});

		await expect(app.run([])).rejects.toBe(boom);
		// run() never touches process status
		expect(process.exitCode).toBe(0);
	});

	it("injected stdout/stderr callbacks reach the Command Action", async () => {
		const out: string[] = [];
		const err: string[] = [];
		const app = new Crust("test").action((ctx) => {
			ctx.stdout("to out");
			ctx.stderr("to err");
		});

		await app.run([], undefined, {
			stdout: (t) => out.push(t),
			stderr: (t) => err.push(t),
		});

		expect(out).toEqual(["to out"]);
		expect(err).toEqual(["to err"]);
	});

	it("makes explicitly injected run IO ambient during the invocation", async () => {
		const stdout = () => {};
		const stderr = () => {};
		let observed: ReturnType<typeof getAmbientTerminalIO>;
		const app = new Crust("test").action(() => {
			observed = getAmbientTerminalIO();
		});

		await app.run([], undefined, { stdout, stderr });

		expect(observed?.stdout).toBe(stdout);
		expect(observed?.stderr).toBe(stderr);
		expect(getAmbientTerminalIO()).toBeUndefined();
	});

	it("does not create an ambient terminal scope when run IO is omitted", async () => {
		let observed: ReturnType<typeof getAmbientTerminalIO>;
		const app = new Crust("test").action(() => {
			observed = getAmbientTerminalIO();
		});

		await app.run([]);

		expect(observed).toBeUndefined();
	});
});

describe("Crust .execute()", () => {
	// Save/restore console and process.exitCode around each test
	let originalLog: typeof console.log;
	let originalError: typeof console.error;
	let originalWarn: typeof console.warn;
	let originalExitCode: number | string | null | undefined;
	let stdoutChunks: string[];
	let stderrChunks: string[];

	beforeEach(() => {
		originalLog = console.log;
		originalError = console.error;
		originalWarn = console.warn;
		originalExitCode = process.exitCode;
		stdoutChunks = [];
		stderrChunks = [];
		console.log = (...args: unknown[]) => {
			stdoutChunks.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
		};
		console.error = (...args: unknown[]) => {
			stderrChunks.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
		};
		console.warn = (...args: unknown[]) => {
			stderrChunks.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
		};
		// Reset exitCode — setting to 0 then deleting clears the value
		process.exitCode = 0;
	});

	afterEach(() => {
		console.log = originalLog;
		console.error = originalError;
		console.warn = originalWarn;
		// Restore original exit code (0 acts as "no error")
		process.exitCode = (originalExitCode as number) ?? 0;
	});

	it("runs root action with flags and args combined", async () => {
		let receivedCtx: CrustCommandContext | undefined;

		const app = new Crust("test")
			.flags({ name: "port", type: "number", default: 3000 }, { name: "verbose", type: "boolean" })
			.args({ name: "dir", type: "string", default: "." })
			.action((ctx) => {
				receivedCtx = ctx as unknown as CrustCommandContext;
			});

		await app.execute({ argv: ["public", "--port", "8080"] });

		expect(receivedCtx).toBeDefined();
		expect((receivedCtx as unknown as { args: Record<string, unknown> }).args.dir).toBe("public");
		expect((receivedCtx as unknown as { flags: Record<string, unknown> }).flags.port).toBe(8080);
	});

	it("routes to subcommand", async () => {
		let actionRan = "";

		const app = new Crust("cli")
			.action(() => {
				actionRan = "root";
			})
			.add(
				defineCommand("sub", (cmd) =>
					cmd.action(() => {
						actionRan = "sub";
					}),
				),
			);

		await app.execute({ argv: ["sub"] });

		expect(actionRan).toBe("sub");
	});

	it("passes Context-owned flags but not parent-local flags to subcommand actions", async () => {
		let subFlags: Record<string, unknown> = {};
		const verbose = defineFlag("verbose", { type: "boolean" });
		const logging = defineContext("logging", { flags: [verbose] }, () => ({}));

		const app = new Crust("cli")
			.flags({ name: "port", type: "number", default: 3000 })
			.provide(logging())
			.add(
				defineCommand("sub", (cmd) =>
					cmd.action((ctx) => {
						subFlags = ctx.flags;
					}),
				),
			);

		await app.execute({ argv: ["sub", "--verbose"] });

		expect(subFlags.verbose).toBe(true);
		// Parent-local flags never enter a descendant's parse surface.
		expect(subFlags.port).toBeUndefined();
	});

	it("dispatches a Context-owned flag written before the subcommand", async () => {
		let subFlags: Record<string, unknown> = {};
		const verbose = defineFlag("verbose", { type: "boolean" });
		const logging = defineContext("logging", { flags: [verbose] }, () => ({}));

		const app = new Crust("cli").provide(logging()).add(
			defineCommand("sub", (cmd) =>
				cmd.action((ctx) => {
					subFlags = ctx.flags;
				}),
			),
		);

		await app.execute({ argv: ["--verbose", "sub"] });

		expect(subFlags.verbose).toBe(true);
	});

	it("rejects a parent-local flag written before the subcommand", async () => {
		let subRan = false;

		const app = new Crust("cli").flags({ name: "quiet", type: "boolean" }).add(
			defineCommand("sub", (cmd) =>
				cmd.action(() => {
					subRan = true;
				}),
			),
		);

		await app.execute({ argv: ["--quiet", "sub"] });

		expect(subRan).toBe(false);
		expect(process.exitCode).toBe(1);
		expect(stderrChunks.join("\n")).toContain(
			'Flag "--quiet" cannot be used before subcommand "sub"',
		);
	});

	it("catches errors and sets exitCode", async () => {
		const app = new Crust("test").action(() => {
			throw new Error("execution failed");
		});

		await app.execute({ argv: [] });

		expect(process.exitCode).toBe(1);
		expect(stderrChunks.join("\n")).toContain("execution failed");
	});

	it("treats prompt cancellation as a silent user abort", async () => {
		const app = new Crust("test").action(() => {
			throw new DOMException("Prompt was cancelled.", "AbortError");
		});

		await app.execute({ argv: [] });

		expect(process.exitCode).toBe(130);
		expect(stderrChunks).toEqual([]);
	});

	it("offers AbortError to onError hooks before the silent default", async () => {
		const seen: unknown[] = [];
		const cancelRenderer = defineExtension(defineExtensionId("cancel-renderer"), {
			hooks: {
				onError(error, ctx) {
					seen.push(error);
					ctx.stderr("Operation cancelled");
					return true;
				},
			},
		});

		const app = new Crust("test").extend(cancelRenderer).action(() => {
			throw new DOMException("Prompt was cancelled.", "AbortError");
		});

		await app.execute({ argv: [] });

		expect(process.exitCode).toBe(130);
		expect(seen).toHaveLength(1);
		expect((seen[0] as Error).name).toBe("AbortError");
		expect(stderrChunks.join("\n")).toContain("Operation cancelled");
	});

	it("preserves the cancellation exit code after onError hooks", async () => {
		const exitCodeOverride = defineExtension(defineExtensionId("exit-code-override"), {
			hooks: {
				onError() {
					process.exitCode = 1;
				},
			},
		});

		const app = new Crust("test").extend(exitCodeOverride).action(() => {
			throw new DOMException("Prompt was cancelled.", "AbortError");
		});

		await app.execute({ argv: [] });

		expect(process.exitCode).toBe(130);
	});

	it("keeps cancellation silent when onError hooks decline it", async () => {
		let observed = false;
		const observer = defineExtension(defineExtensionId("observer"), {
			hooks: {
				onError() {
					observed = true;
					// Decline: Core's default for cancellation stays silent
				},
			},
		});

		const app = new Crust("test").extend(observer).action(() => {
			throw new DOMException("Prompt was cancelled.", "AbortError");
		});

		await app.execute({ argv: [] });

		expect(process.exitCode).toBe(130);
		expect(observed).toBe(true);
		expect(stderrChunks).toEqual([]);
	});

	it("handles unknown flag error", async () => {
		const app = new Crust("test").flags({ name: "verbose", type: "boolean" }).action(() => {});

		await app.execute({ argv: ["--unknown"] });

		expect(process.exitCode).toBe(1);
		expect(stderrChunks.join("\n")).toContain("Unknown flag");
	});

	it("handles missing required flag error", async () => {
		const app = new Crust("test")
			.flags({ name: "name", type: "string", required: true })
			.action(() => {});

		await app.execute({ argv: [] });

		expect(process.exitCode).toBe(1);
		expect(stderrChunks.join("\n")).toContain("Missing required");
	});

	it("command not found error with no run on parent", async () => {
		const app = new Crust("cli").add(defineCommand("sub", (cmd) => cmd.action(() => {})));

		await app.execute({ argv: ["unknown-sub"] });

		expect(process.exitCode).toBe(1);
		expect(stderrChunks.join("\n")).toContain("Unknown command");
	});

	it("no action is a no-op (no error)", async () => {
		const app = new Crust("test").flags({ name: "verbose", type: "boolean" });

		await app.execute({ argv: ["--verbose"] });

		// Should complete without error (exitCode stays 0)
		expect(process.exitCode).toBe(0);
	});

	it("Extension-owned command trees receive other Extensions' recursive flags", async () => {
		let receivedFlags: Record<string, unknown> = {};

		const helpLike = defineExtension(defineExtensionId("help-like"), {
			flags: [{ name: "help", type: "boolean" }],
		});
		const skillLike = defineExtension(defineExtensionId("inject-subcommand"), {
			commands: [
				defineCommand("skill", (command) =>
					command.add(
						defineCommand("update", (cmd) =>
							cmd.action((runCtx) => {
								receivedFlags = runCtx.flags as Record<string, unknown>;
							}),
						),
					),
				),
			],
		});

		const app = new Crust("test")
			.extend(helpLike)
			.extend(skillLike)
			.action(() => {});

		await app.execute({ argv: ["skill", "update", "--help"] });

		expect(receivedFlags.help).toBe(true);
	});

	it("deeply nested subcommand routing works", async () => {
		let actionRan = "";

		const app = new Crust("cli").flags({ name: "verbose", type: "boolean" }).add(
			defineCommand("level1", (cmd) =>
				cmd.add(
					defineCommand("level2", (cmd2) =>
						cmd2.add(
							defineCommand("level3", (cmd3) =>
								cmd3.action(() => {
									actionRan = "level3";
								}),
							),
						),
					),
				),
			),
		);

		await app.execute({ argv: ["level1", "level2", "level3"] });

		expect(actionRan).toBe("level3");
	});

	it("rawArgs are passed through", async () => {
		let receivedRawArgs: string[] = [];

		const app = new Crust("test").flags({ name: "verbose", type: "boolean" }).action((ctx) => {
			receivedRawArgs = ctx.rawArgs;
		});

		await app.execute({ argv: ["--verbose", "--", "extra1", "extra2"] });

		expect(receivedRawArgs).toEqual(["extra1", "extra2"]);
	});

	it("pre-run receives the resolved command and parsed input", async () => {
		let preRunName = "";
		let preRunFlags: Record<string, unknown> = {};

		const inspect = defineExtension(defineExtensionId("inspect"), {
			hooks: {
				preRun(ctx) {
					preRunName = ctx.command.meta.name;
					preRunFlags = { ...ctx.flags };
				},
			},
		});

		const app = new Crust("cli")
			.extend(inspect)
			.add(
				defineCommand("sub", (cmd) =>
					cmd.flags({ name: "output", type: "string", default: "stdout" }).action(() => {}),
				),
			);

		await app.execute({ argv: ["sub", "--output", "file.txt"] });

		expect(preRunName).toBe("sub");
		expect(preRunFlags.output).toBe("file.txt");
	});

	it("Context capabilities work across file-boundary pattern", async () => {
		let receivedVerbose = false;
		const verbose = defineFlag("verbose", { type: "boolean" });
		const logging = defineContext("logging", { flags: [verbose] }, ({ flags }) => ({
			verbose: flags.verbose === true,
		}));
		const sub = defineCommand("sub", { uses: [logging] }, (command) =>
			command.action(async ({ ctx }) => {
				receivedVerbose = (await ctx.logging).verbose;
			}),
		);
		const app = new Crust("cli").provide(logging()).add(sub);

		await app.execute({ argv: ["sub", "--verbose"] });

		expect(receivedVerbose).toBe(true);
	});

	it("default flag values work on subcommands", async () => {
		let receivedPort: number | undefined;
		const port = defineFlag("port", { type: "number", default: 3000 });

		const ports = defineContext("ports", { flags: [port] }, ({ flags }) => ({
			port: flags.port,
		}));
		const app = new Crust("cli").provide(ports()).add(
			defineCommand("sub", { uses: [ports] }, (cmd) =>
				cmd.action(async ({ ctx }) => {
					receivedPort = (await ctx.ports).port;
				}),
			),
		);

		await app.execute({ argv: ["sub"] });

		expect(receivedPort).toBe(3000);
	});

	it("Context-owned flag short alias works on subcommand", async () => {
		let receivedVerbose: boolean | undefined;
		const verbose = defineFlag("verbose", { type: "boolean", short: "v" });

		const logging = defineContext("logging", { flags: [verbose] }, ({ flags }) => ({
			verbose: flags.verbose,
		}));
		const app = new Crust("cli").provide(logging()).add(
			defineCommand("sub", { uses: [logging] }, (cmd) =>
				cmd.action(async ({ ctx }) => {
					receivedVerbose = (await ctx.logging).verbose;
				}),
			),
		);

		await app.execute({ argv: ["sub", "-v"] });

		expect(receivedVerbose).toBe(true);
	});

	it("Extension apply error is rendered and sets exitCode", async () => {
		const clash = defineExtension(defineExtensionId("clash"), {
			flags: [{ name: "verbose", type: "boolean" }],
		});
		const app = new Crust("test")
			.flags({ name: "verbose", type: "boolean" })
			.extend(clash)
			.action(() => {});

		await app.execute({ argv: [] });

		expect(process.exitCode).toBe(1);
		expect(stderrChunks.join("\n")).toContain("collides");
	});

	it("treats pre-run prompt cancellation as a silent user abort", async () => {
		const cancel = defineExtension(defineExtensionId("cancel"), {
			hooks: {
				preRun: () => {
					throw new DOMException("Prompt was cancelled.", "AbortError");
				},
			},
		});

		const app = new Crust("test").extend(cancel).action(() => {});

		await app.execute({ argv: [] });

		expect(process.exitCode).toBe(130);
		expect(stderrChunks).toEqual([]);
	});

	it("async action works", async () => {
		let result = "";

		const app = new Crust("test").action(async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
			result = "done";
		});

		await app.execute({ argv: [] });

		expect(result).toBe("done");
	});

	it("action context exposes stdout/stderr text callbacks", async () => {
		const app = new Crust("test").action((ctx) => {
			ctx.stdout("hello out");
			ctx.stderr("hello err");
		});

		await app.execute({ argv: [] });

		expect(stdoutChunks).toContain("hello out");
		expect(stderrChunks).toContain("hello err");
	});

	it("keeps extension hooks and the action inside explicitly injected IO", async () => {
		const stdout = () => {};
		const stderr = () => {};
		const observed: (ReturnType<typeof getAmbientTerminalIO> | undefined)[] = [];
		const observer = defineExtension(defineExtensionId("ambient-observer"), {
			hooks: {
				preRun: () => {
					observed.push(getAmbientTerminalIO());
				},
				postRun: () => {
					observed.push(getAmbientTerminalIO());
				},
				onError: () => {
					observed.push(getAmbientTerminalIO());
				},
			},
		});
		const app = new Crust("test").extend(observer).action(() => {
			observed.push(getAmbientTerminalIO());
			throw new Error("expected failure");
		});

		await app.execute({ argv: [], io: { stdout, stderr } });

		expect(observed).toHaveLength(4);
		for (const io of observed) {
			expect(io?.stdout).toBe(stdout);
			expect(io?.stderr).toBe(stderr);
		}
		expect(getAmbientTerminalIO()).toBeUndefined();
	});

	it("does not create an ambient terminal scope when execute IO is omitted", async () => {
		let observed: ReturnType<typeof getAmbientTerminalIO>;
		const app = new Crust("test").action(() => {
			observed = getAmbientTerminalIO();
		});

		await app.execute({ argv: [] });

		expect(observed).toBeUndefined();
	});

	it("command context contains a serializable snapshot of the resolved command", async () => {
		let receivedCommand: unknown;

		const app = new Crust("test").flags({ name: "verbose", type: "boolean" }).action((ctx) => {
			receivedCommand = ctx.command;
		});

		await app.execute({ argv: [] });

		expect(receivedCommand).toBeDefined();
		const snapshot = receivedCommand as {
			meta: { name: string };
			hasAction: boolean;
			flags: Record<string, unknown>;
		};
		expect(snapshot.meta.name).toBe("test");
		expect(snapshot.hasAction).toBe(true);
		expect(Object.keys(snapshot.flags)).toContain("verbose");
		// Serializable across boundaries — no functions anywhere in the snapshot
		expect(() => structuredClone(snapshot)).not.toThrow();
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Invocation pipeline internal seam — snapshot subprocess protocol
// ────────────────────────────────────────────────────────────────────────────

describe("Invocation pipeline internal seam — snapshot protocol", () => {
	const originalExit = process.exit;
	const originalConsoleError = console.error;
	let exitCalls: Array<number | undefined>;
	let errorCalls: string[];
	let tempDirs: string[];

	beforeEach(() => {
		exitCalls = [];
		errorCalls = [];
		tempDirs = [];
		process.exit = ((code?: number) => {
			exitCalls.push(code);
			throw new Error(`process.exit(${code ?? "undefined"}) was called during snapshot`);
		}) as typeof process.exit;
		console.error = (...values: unknown[]) => errorCalls.push(values.map(String).join(" "));
	});

	afterEach(async () => {
		process.exit = originalExit;
		console.error = originalConsoleError;
		delete process.env[SNAPSHOT_PATH_ENV];
		delete process.env[BUILD_OUT_DIR_ENV];
		await Promise.all(tempDirs.map((path) => rm(path, { recursive: true, force: true })));
	});

	async function snapshotPath(): Promise<string> {
		const directory = await mkdtemp(join(tmpdir(), "crust-core-snapshot-test-"));
		tempDirs.push(directory);
		return join(directory, "command.json");
	}

	it("writes a snapshot, exits zero, and skips dispatch", async () => {
		const path = await snapshotPath();
		process.env[SNAPSHOT_PATH_ENV] = path;
		let actionRan = false;
		let preRunRan = false;
		const spy = defineExtension(defineExtensionId("spy"), {
			hooks: {
				preRun: () => {
					preRunRan = true;
				},
			},
		});
		const app = new Crust("build-subprocess", { description: "Snapshot test" })
			.extend(spy)
			.action(() => {
				actionRan = true;
			});

		await expect(app.execute({ argv: [] })).rejects.toThrow("process.exit(0) was called");

		expect(exitCalls).toEqual([0]);
		expect(actionRan).toBe(false);
		expect(preRunRan).toBe(false);
		expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
			meta: { name: "build-subprocess", description: "Snapshot test" },
			hasAction: true,
		});
	});

	it("runs build hooks in registration order", async () => {
		const path = await snapshotPath();
		const outDir = join(dirname(path), "output");
		process.env[SNAPSHOT_PATH_ENV] = path;
		process.env[BUILD_OUT_DIR_ENV] = outDir;
		const calls: string[] = [];
		const app = new Crust("build-subprocess")
			.extend(
				defineExtension(defineExtensionId("first"), {
					build: ({ snapshot, outDir: receivedOutDir }) => {
						expect(Object.isFrozen(snapshot)).toBe(true);
						expect(snapshot.meta.name).toBe("build-subprocess");
						expect(receivedOutDir).toBe(outDir);
						calls.push("first");
					},
				}),
				defineExtension(defineExtensionId("runtime-only")),
				defineExtension(defineExtensionId("second"), {
					build: () => {
						calls.push("second");
					},
				}),
			)
			.action(() => {
				calls.push("action");
			});

		await expect(app.execute({ argv: [] })).rejects.toThrow("process.exit(0) was called");

		expect(calls).toEqual(["first", "second"]);
	});

	it("attributes build hook failures to the extension", async () => {
		const path = await snapshotPath();
		process.env[SNAPSHOT_PATH_ENV] = path;
		process.env[BUILD_OUT_DIR_ENV] = join(dirname(path), "output");
		const app = new Crust("build-subprocess").extend(
			defineExtension(defineExtensionId("broken"), {
				build: () => {
					throw new Error("disk full");
				},
			}),
		);

		await expect(app.execute({ argv: [] })).rejects.toThrow("process.exit(1) was called");

		expect(errorCalls).toEqual(['Extension "broken" build failed: disk full']);
	});

	it("prints validation errors and exits one without writing a snapshot", async () => {
		const path = await snapshotPath();
		process.env[SNAPSHOT_PATH_ENV] = path;
		const extension = defineExtension(defineExtensionId("collision"), {
			flags: [{ name: "verbose", type: "boolean" }],
		});
		const app = new Crust("cli").flags({ name: "verbose", type: "boolean" }).extend(extension);

		await expect(app.execute({ argv: [] })).rejects.toThrow("process.exit(1) was called");

		expect(exitCalls).toEqual([1]);
		expect(errorCalls.join("\n")).toContain("collides with flag");
		await expect(readFile(path, "utf8")).rejects.toThrow();
	});
});

describe("Crust.snapshot", () => {
	it("returns a frozen snapshot with Extension flags applied", async () => {
		const docs = defineExtension(defineExtensionId("doc-test"), {
			flags: [{ name: "extra", type: "boolean", description: "Injected for docs" }],
		});

		const app = new Crust("cli", { description: "Test" }).extend(docs);
		const root = await app.snapshot();
		expect(root.flags.extra).toMatchObject({
			type: "boolean",
			description: "Injected for docs",
		});
		expect(Object.isFrozen(root)).toBe(true);
		expect(() => structuredClone(root)).not.toThrow();
	});

	it("can be called multiple times", async () => {
		const app = new Crust("cli").action(() => {});
		const a = await app.snapshot();
		const b = await app.snapshot();
		expect(a.meta.name).toBe("cli");
		expect(b.meta.name).toBe("cli");
	});

	it("never calls Command Actions", async () => {
		let called = false;
		const app = new Crust("cli").action(() => {
			called = true;
		});
		await app.snapshot();
		expect(called).toBe(false);
	});
});

// ──────────────────────────────────────────────────────────────────────────────
// .add() aliases
// ──────────────────────────────────────────────────────────────────────────────

describe("Crust .add() aliases", () => {
	it("routes aliases from definition config and includes them in the snapshot", async () => {
		let calls = 0;
		const app = new Crust("cli").add(
			defineCommand("issue", { aliases: ["issues", "i"] }, (command) =>
				command.action(() => {
					calls++;
				}),
			),
		);

		await app.run(["issues"]);
		expect(calls).toBe(1);
		expect((await app.snapshot()).subCommands.issue?.meta.aliases).toEqual(["issues", "i"]);
	});

	it("throws DEFINITION when an alias collides with a sibling's canonical name", () => {
		const app = new Crust("cli").add(defineCommand("build", (cmd) => cmd.action(() => {})));
		expect(() => {
			// @ts-expect-error -- runtime twin rejects aliases colliding with sibling names
			app.add(defineCommand("compile", { aliases: ["build"] }, (cmd) => cmd.action(() => {})));
		}).toThrow(/collides with sibling canonical name "build"/);
	});

	it("throws DEFINITION when an alias collides with another sibling's alias", () => {
		const app = new Crust("cli").add(
			defineCommand("issue", { aliases: ["i"] }, (cmd) => cmd.action(() => {})),
		);
		expect(() => {
			// @ts-expect-error -- runtime twin rejects aliases colliding across siblings
			app.add(defineCommand("info", { aliases: ["i"] }, (cmd) => cmd.action(() => {})));
		}).toThrow(/collides with alias of sibling "issue"/);
	});

	it("throws DEFINITION on the reverse-order case (new canonical equals an existing alias)", () => {
		const app = new Crust("cli").add(
			defineCommand("issue", { aliases: ["i"] }, (cmd) => cmd.action(() => {})),
		);
		// Now try to register a *new* command whose canonical name == existing alias.
		expect(() => {
			// @ts-expect-error -- runtime twin rejects names colliding with sibling aliases
			app.add(defineCommand("i", (cmd) => cmd.action(() => {})));
		}).toThrow(/canonical name "i" collides with alias of sibling "issue"/);
	});

	it("throws DEFINITION on duplicate aliases within one subcommand's own list", () => {
		expect(() =>
			new Crust("cli").add(
				defineCommand("issue", { aliases: ["i", "i"] }, (cmd) => cmd.action(() => {})),
			),
		).toThrow(/lists alias "i" more than once/);
	});

	it("throws DEFINITION on an alias equal to its own canonical name", () => {
		expect(() =>
			new Crust("cli").add(
				// @ts-expect-error -- runtime twin rejects aliases equal to their canonical name
				defineCommand("issue", { aliases: ["issue"] }, (cmd) => cmd.action(() => {})),
			),
		).toThrow(/must not equal its own canonical name/);
	});

	it("throws DEFINITION on an empty alias", () => {
		expect(() =>
			new Crust("cli").add(
				// @ts-expect-error -- runtime twin rejects empty aliases
				defineCommand("issue", { aliases: [""] }, (cmd) => cmd.action(() => {})),
			),
		).toThrow(/must be a non-empty string/);
	});

	it("throws DEFINITION on an alias containing whitespace", () => {
		expect(() =>
			new Crust("cli").add(
				// @ts-expect-error -- runtime twin rejects whitespace in aliases
				defineCommand("issue", { aliases: ["my issue"] }, (cmd) => cmd.action(() => {})),
			),
		).toThrow(/must not contain whitespace/);
	});

	it("throws DEFINITION on an alias starting with '-'", () => {
		expect(() =>
			new Crust("cli").add(
				// @ts-expect-error -- runtime twin rejects aliases starting with a dash
				defineCommand("issue", { aliases: ["-i"] }, (cmd) => cmd.action(() => {})),
			),
		).toThrow(/must not start with "-"/);
	});

	it("keeps configured aliases when a definition is renamed with .as()", () => {
		const issue = defineCommand("issue", { aliases: ["i"] }, (command) => command.action(() => {}));
		const app = new Crust("cli").add(issue);

		expect(() => {
			// @ts-expect-error -- .as() preserves configured aliases in the sibling spelling set
			app.add(issue.as("ticket"));
		}).toThrow(/collides with alias of sibling "issue"/);
	});

	it("throws DEFINITION when .as() renames a definition to one of its own aliases", () => {
		// Deliberately runtime-only: the rename target is compared against the
		// definition's own aliases, which the type level does not cross-check.
		const issue = defineCommand("issue", { aliases: ["i"] }, (command) => command.action(() => {}));

		expect(() => new Crust("cli").add(issue.as("i"))).toThrow(
			/must not equal its own canonical name/,
		);
	});

	it("Extension command with a colliding alias is a DEFINITION error (no silent shadowing)", async () => {
		// Without this guard, an Extension could attach an alias that silently
		// changes routing for an existing user command.
		const rogue = defineExtension(defineExtensionId("rogue"), {
			commands: [defineCommand("info", { aliases: ["i"] }, (command) => command.action(() => {}))],
		});

		const app = new Crust("cli")
			.extend(rogue)
			.add(defineCommand("issue", { aliases: ["i"] }, (cmd) => cmd.action(() => {})));

		await expect(app.run(["i"])).rejects.toMatchObject({ code: "DEFINITION" });
	});

	it("normalizes flags of a hand-written Extension object at prepare time", async () => {
		// Extension is a public structural type, so a plain object that never
		// went through defineExtension() typechecks; its flags must still hit
		// the normalization boundary instead of being trusted as pre-validated.
		const rogue = {
			name: "rogue",
			flags: { mode: { type: "string", choices: ["a", "b"], default: "z" } },
		} as unknown as Parameters<Crust["extend"]>[0];

		await expect(
			new Crust("cli")
				.action(() => {})
				.extend(rogue)
				.run([]),
		).rejects.toMatchObject({
			code: "DEFINITION",
			message: 'Invalid default value "z" for --mode. Expected one of: a, b',
		});

		const asyncRogue = {
			name: "rogue",
			flags: { val: { type: "string", parse: async (raw: string) => raw } },
		} as unknown as Parameters<Crust["extend"]>[0];

		await expect(
			new Crust("cli")
				.action(() => {})
				.extend(asyncRogue)
				.run([]),
		).rejects.toMatchObject({
			code: "DEFINITION",
			message:
				"Async parse not supported for flag --val. Use a sync parser; do async work in run().",
		});
	});
});

describe("definition normalization timing", () => {
	it("rejects defaults outside choices when flags and args are defined", () => {
		try {
			new Crust("cli").flags({
				name: "mode",
				type: "string",
				choices: ["a", "b"],
				default: "z",
			});
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("DEFINITION");
			expect((err as CrustError).message).toBe(
				'Invalid default value "z" for --mode. Expected one of: a, b',
			);
		}
		try {
			new Crust("cli").args({
				name: "mode",
				type: "string",
				choices: ["a", "b"],
				default: "z",
			});
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("DEFINITION");
			expect((err as CrustError).message).toBe(
				'Invalid default value "z" for <mode>. Expected one of: a, b',
			);
		}
	});

	it("rejects array defaults outside choices for multiple flags", () => {
		try {
			new Crust("cli").flags({
				name: "mode",
				type: "string",
				multiple: true,
				choices: ["a", "b"],
				default: ["a", "z"],
			} as never);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("DEFINITION");
			expect((err as CrustError).message).toBe(
				'Invalid default value "z" for --mode. Expected one of: a, b',
			);
		}
	});

	it("rejects async parsers when flags and args are defined", () => {
		expect(() =>
			new Crust("cli").flags({
				name: "mode",
				type: "string",
				parse: async (raw: string) => raw,
			} as never),
		).toThrow(/Async parse not supported for flag --mode/);
		expect(() =>
			new Crust("cli").args({
				name: "mode",
				type: "string",
				parse: async (raw: string) => raw,
			} as never),
		).toThrow(/Async parse not supported for argument <mode>/);
	});

	it("materializes and normalizes invalid definitions two levels behind an Extension", async () => {
		const invalidLeaf = defineCommand("leaf", (command) =>
			command.flags({
				name: "mode",
				type: "string",
				choices: ["a", "b"],
				default: "z",
			}),
		);
		const middle = defineCommand("middle", (command) => command.add(invalidLeaf));
		const extension = defineExtension(defineExtensionId("deep"), { commands: [middle] });

		try {
			await new Crust("cli").extend(extension).snapshot();
			expect.unreachable("snapshot should reject the invalid nested definition");
		} catch (error) {
			expect(error).toBeInstanceOf(CrustError);
			expect((error as CrustError).code).toBe("DEFINITION");
		}
	});
});
