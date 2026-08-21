import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { StandardSchema } from "@crustjs/utils/schema";
import { getAmbientTerminalIO } from "@crustjs/utils/terminal";

import { defineContext } from "../api/context.ts";
import { defineExtension, type Extension } from "../api/extension.ts";
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

	it("rejects blank root command names", () => {
		for (const name of ["", "   "]) {
			expect(() => new Crust(name)).toThrow(
				expect.objectContaining({
					code: "DEFINITION",
					details: { subject: "command", name, reason: "empty-name" },
				}),
			);
		}
	});

	it("does not carry sibling-only metadata onto the root", async () => {
		const snapshot = await new Crust("my-cli", {
			// @ts-expect-error -- aliases belong to defineCommand() config
			aliases: ["cli"],
		}).snapshot();
		expect(snapshot.meta.aliases).toBeUndefined();
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
		const typecheckInvalidAliases = () => {
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
		void typecheckInvalidAliases;

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

	it("deduplicates the same Extension object before hooks and Context setup", async () => {
		let preRuns = 0;
		let sections = 0;
		let setups = 0;
		let disposals = 0;
		const resource = defineContext("resource", () => {
			setups++;
			return {
				[Symbol.dispose]() {
					disposals++;
				},
			};
		});
		const extension = defineExtension(defineExtensionId("deduplicated"), {
			provides: [resource()],
			sections: () => {
				sections++;
				return [];
			},
			hooks: { preRun: () => void preRuns++ },
		});
		const base = new Crust("test")
			.extend(extension)
			.action(async ({ ctx }) => void (await ctx.resource));
		// Duplicate ids are runtime-only; the cast bypasses the duplicate Context brand.
		const app = base.extend(extension as never);

		await app.snapshot();
		await app.run([]);

		expect({ preRuns, sections, setups, disposals }).toEqual({
			preRuns: 1,
			sections: 1,
			setups: 1,
			disposals: 1,
		});
	});

	it("keeps the last Extension registration for a shared id", async () => {
		const id = defineExtensionId("shared");
		const calls: string[] = [];
		const firstResource = defineContext(
			"firstResource",
			{ flags: [{ name: "legacyProvider", type: "boolean" }] },
			() => {
				calls.push("first:setup");
				return { [Symbol.dispose]: () => calls.push("first:dispose") };
			},
		);
		const secondResource = defineContext("secondResource", () => {
			calls.push("second:setup");
			return { [Symbol.dispose]: () => calls.push("second:dispose") };
		});
		const first = defineExtension(id, {
			flags: [{ name: "legacy", type: "boolean" }],
			commands: [defineCommand("legacy", (command) => command)],
			provides: [firstResource()],
			sections: () => (calls.push("first:sections"), []),
			hooks: { preRun: () => void calls.push("first:preRun") },
		});
		const second = defineExtension(id, {
			flags: [{ name: "current", type: "boolean" }],
			commands: [defineCommand("current", (command) => command)],
			provides: [secondResource()],
			sections: () => (calls.push("second:sections"), []),
			hooks: { preRun: () => void calls.push("second:preRun") },
		});
		// Extension ids are branded strings rather than literal types, so id dedup is runtime-only.
		const app = new Crust("test")
			.extend(first)
			.extend(second)
			.action(async ({ ctx }) => {
				expect(Object.hasOwn(ctx, "firstResource")).toBe(false);
				await ctx.secondResource;
			});

		const snapshot = await app.snapshot();
		expect(snapshot.flags.current).toBeDefined();
		expect(snapshot.flags.legacy).toBeUndefined();
		expect(snapshot.flags.legacyProvider).toBeUndefined();
		expect(snapshot.subCommands.current).toBeDefined();
		expect(snapshot.subCommands.legacy).toBeUndefined();
		await app.run([]);

		expect(calls).toEqual(["second:sections", "second:preRun", "second:setup", "second:dispose"]);
	});

	it("moves re-registered Extension providers to the last registration", async () => {
		let value: string | undefined;
		const fromA = defineContext("sharedProvider", () => "A");
		const fromB = defineContext("sharedProvider", () => "B");
		const a = defineExtension(defineExtensionId("provider-a"), { provides: [fromA()] });
		const b = defineExtension(defineExtensionId("provider-b"), { provides: [fromB()] });
		const app = new Crust("test")
			.extend(a)
			.extend(b as never)
			.extend(a as never)
			.action(async ({ ctx }) => {
				const bag = ctx as { sharedProvider: Promise<string> };
				value = await bag.sharedProvider;
			});

		await app.run([]);
		expect(value).toBe("A");
	});

	it("restores a surviving local flag definition after provider replacement", async () => {
		const id = defineExtensionId("flag-provider");
		const provider = defineContext(
			"flagProvider",
			{ flags: [{ name: "mode", type: "number", aliases: ["extension-mode"] }] },
			() => ({}),
		);
		const first: Extension = defineExtension(id, { provides: [provider()] });
		const replacement: Extension = defineExtension(id);
		const app = new Crust("test")
			.flags({ name: "mode", type: "string", aliases: ["local-mode"] })
			.extend(first)
			.extend(replacement)
			.action(() => {});

		const snapshot = await app.snapshot();
		expect(snapshot.flags.mode).toEqual({ type: "string", aliases: ["local-mode"] });
	});

	it("keeps a surviving provider flag definition across unrelated .extend() calls", async () => {
		const provider = defineContext(
			"flagProvider",
			{ flags: [{ name: "mode", type: "number", aliases: ["extension-mode"] }] },
			() => ({}),
		);
		const extension: Extension = defineExtension(defineExtensionId("flag-provider"), {
			provides: [provider()],
		});
		const app = new Crust("test")
			.flags({ name: "mode", type: "string", aliases: ["local-mode"] })
			.extend(extension)
			.extend(defineExtension(defineExtensionId("unrelated")))
			.action(() => {});

		const snapshot = await app.snapshot();
		expect(snapshot.flags.mode).toEqual({ type: "number", aliases: ["extension-mode"] });
	});

	it("keeps a local provider override across unrelated .extend() calls", async () => {
		let value: string | undefined;
		const resource = defineContext("resource", () => "extension");
		const local = defineContext("resource", () => "local");
		const providing = defineExtension(defineExtensionId("providing"), {
			provides: [resource()],
		});
		const app = new Crust("test")
			.extend(providing)
			// Same-name local re-provide is runtime last-write-wins; the cast
			// bypasses the duplicate Context brand.
			.provide(local() as never)
			.extend(defineExtension(defineExtensionId("unrelated")))
			.action(async ({ ctx }) => {
				// The `as never` provide collapses the static Context map; the bag still resolves at runtime.
				const bag = ctx as { resource: Promise<string> };
				value = await bag.resource;
			});

		await app.run([]);
		expect(value).toBe("local");
	});

	it("preserves interleaved local and Context flag order across .extend()", async () => {
		const owner = defineContext(
			"owner",
			{ flags: [{ name: "bFlag", type: "boolean" }] },
			() => ({}),
		);
		const app = new Crust("test")
			.flags({ name: "aFlag", type: "boolean" })
			.provide(owner())
			.extend(defineExtension(defineExtensionId("order-noop")))
			.action(() => {});

		const snapshot = await app.snapshot();
		expect(Object.keys(snapshot.flags)).toEqual(["aFlag", "bFlag"]);
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
	it("brands statically known Extension command collisions at .extend()", () => {
		const build = defineCommand("build", (command) => command);
		const collidingName = defineExtension(defineExtensionId("name-collision"), {
			commands: [defineCommand("build", (command) => command)],
		});
		const collidingAlias = defineExtension(defineExtensionId("alias-collision"), {
			commands: [defineCommand("inspect", { aliases: ["build"] }, (command) => command)],
		});
		const first = defineExtension(defineExtensionId("first-command"), {
			commands: [defineCommand("deploy", { aliases: ["d"] }, (command) => command)],
		});
		const second = defineExtension(defineExtensionId("second-command"), {
			commands: [defineCommand("d", (command) => command)],
		});
		const dynamic: Extension = collidingName;
		const clean = defineExtension(defineExtensionId("clean-command"), {
			commands: [defineCommand("inspect", (command) => command)],
		});

		function typecheckHarness() {
			const app = new Crust("cli").add(build);
			// @ts-expect-error -- command name collides with an app sibling (FIX_COMMAND_COLLISION)
			void app.extend(collidingName);
			// @ts-expect-error -- command alias collides with an app sibling (FIX_COMMAND_COLLISION)
			void app.extend(collidingAlias);
			// @ts-expect-error -- command name collides with an earlier Extension alias (FIX_COMMAND_COLLISION)
			void new Crust("cli").extend(first).extend(second);
			void app.extend(dynamic);
			void app.extend(clean);
		}
		void typecheckHarness;
		expect(true).toBe(true);
	});

	it("brands duplicate command spellings within one Extension at defineExtension()", () => {
		function typecheckHarness() {
			void defineExtension(defineExtensionId("self-name-collision"), {
				commands: [
					defineCommand("dup", (command) => command),
					// @ts-expect-error -- duplicate canonical name within one Extension (FIX_COMMAND_COLLISION)
					defineCommand("dup", (command) => command),
				],
			});
			void defineExtension(defineExtensionId("self-alias-collision"), {
				commands: [
					defineCommand("deploy", { aliases: ["d"] }, (command) => command),
					// @ts-expect-error -- canonical name matches an earlier alias within one Extension (FIX_COMMAND_COLLISION)
					defineCommand("d", (command) => command),
				],
			});
			void defineExtension(defineExtensionId("self-clean"), {
				commands: [
					defineCommand("build", (command) => command),
					defineCommand("deploy", (command) => command),
				],
			});
		}
		void typecheckHarness;
		expect(true).toBe(true);
	});

	it("rejects an Extension providing a Context name already on the path at compile time", () => {
		const db = defineContext("db", {}, () => "real");
		const impostor = defineContext("db", {}, () => 42);
		const ext = defineExtension(defineExtensionId("impostor"), { provides: [impostor()] });
		const app = new Crust("cli").provide(db());
		// @ts-expect-error -- Extension-provided Context "db" is already on the path (FIX_DUPLICATE_CONTEXT)
		expect(() => app.extend(ext)).not.toThrow();
	});

	it("rejects an Extension providing two Contexts that share a flag spelling at compile time", () => {
		const first = defineContext("first", { flags: [{ name: "mode", type: "number" }] }, () => ({}));
		const second = defineContext(
			"second",
			{ flags: [{ name: "mode", type: "string" }] },
			() => ({}),
		);
		expect(() =>
			defineExtension(defineExtensionId("double-provider"), {
				// @ts-expect-error -- second Context's owned flag "mode" collides with the first's (FIX_ALIAS_COLLISION)
				provides: [first(), second()],
			}),
		).not.toThrow();
	});

	it("rejects an Extension flag colliding with a subcommand's local flag at compile time", () => {
		const themer = defineExtension(defineExtensionId("themer"), {
			flags: [{ name: "mode", type: "boolean" }],
		});
		const sub = defineCommand("sub", (cmd) =>
			cmd.flags({ name: "mode", type: "string" }).action(() => {}),
		);
		const appWithSub = new Crust("cli").add(sub);
		// @ts-expect-error -- Extension flag "mode" collides with subcommand "sub"'s local flag (FIX_ALIAS_COLLISION)
		expect(() => appWithSub.extend(themer)).not.toThrow();

		const appWithExt = new Crust("cli").extend(themer);
		// @ts-expect-error -- subcommand "sub"'s local flag "mode" collides with the registered Extension flag (FIX_ALIAS_COLLISION)
		expect(() => appWithExt.add(sub)).not.toThrow();
	});

	it("rejects an Extension flag colliding with its own provided Context's flag at compile time", () => {
		const modeContext = defineContext(
			"mode-owner",
			{ flags: [{ name: "mode", type: "number" }] },
			() => ({}),
		);
		expect(() =>
			defineExtension(defineExtensionId("self-collider"), {
				provides: [modeContext()],
				// @ts-expect-error -- declared flag "mode" collides with the provided Context's owned flag (FIX_ALIAS_COLLISION)
				flags: [{ name: "mode", type: "string" }],
			}),
		).not.toThrow();
	});

	it("rejects an Extension flag colliding with an application flag at compile time", () => {
		const themer = defineExtension(defineExtensionId("themer"), {
			flags: [{ name: "mode", type: "boolean" }],
		});
		const app = new Crust("cli").flags({ name: "mode", type: "string" });
		// @ts-expect-error -- Extension flag "mode" collides with the application flag (FIX_ALIAS_COLLISION)
		expect(() => app.extend(themer)).not.toThrow();
	});

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

	it("rejects a dynamic Extension flag whose canonical name equals an existing alias", async () => {
		const thief = defineExtension(defineExtensionId("thief"), {
			flags: [{ name: "auth", type: "boolean" }],
		});
		const app = new Crust("cli")
			.flags({ name: "token", type: "string", aliases: ["auth"] })
			.extend(thief as never)
			.action(() => {});
		const stderr: string[] = [];
		const originalExitCode = process.exitCode;
		try {
			await app.execute({ argv: [], io: { stderr: (text) => stderr.push(text) } });
		} finally {
			process.exitCode = originalExitCode;
		}
		expect(stderr.join("\n")).toContain('spelling "auth" collides');
	});

	it("rejects a dynamic Extension flag colliding with an app flag at prepare time", async () => {
		let runs = 0;
		const replacement = defineExtension(defineExtensionId("replacement"), {
			flags: [{ name: "mode", type: "boolean", short: "n", aliases: ["new"] }],
		});
		// The .extend() brand owns literal collisions; the cast models a dynamic
		// Extension, which must fail loud at prepare instead of silently retyping
		// the app's flag.
		const app = new Crust("cli")
			.flags({ name: "mode", type: "boolean", short: "o", aliases: ["old"] })
			.extend(replacement as never)
			.action(() => {
				runs++;
			});
		const stderr: string[] = [];
		const originalExitCode = process.exitCode;
		try {
			await app.execute({ argv: ["--old"], io: { stderr: (text) => stderr.push(text) } });
		} finally {
			process.exitCode = originalExitCode;
		}

		expect(runs).toBe(0);
		expect(stderr.join("\n")).toContain('Extension flag "mode" collides');
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

	it("runs only the last build hook for a duplicate Extension id", async () => {
		const path = await snapshotPath();
		process.env[SNAPSHOT_PATH_ENV] = path;
		process.env[BUILD_OUT_DIR_ENV] = dirname(path);
		const calls: string[] = [];
		const id = defineExtensionId("duplicate-build");
		const first = defineExtension(id, { build: () => void calls.push("first") });
		const second = defineExtension(id, { build: () => void calls.push("second") });
		const app = new Crust("build-subprocess").extend(first).extend(second);

		await expect(app.execute({ argv: [] })).rejects.toThrow("process.exit(0) was called");

		expect(calls).toEqual(["second"]);
	});

	it("refreshes sections between build hooks", async () => {
		const path = await snapshotPath();
		const outDir = join(dirname(path), "output");
		const source = join(dirname(path), "generated-source");
		process.env[SNAPSHOT_PATH_ENV] = path;
		process.env[BUILD_OUT_DIR_ENV] = outDir;
		const calls: string[] = [];
		const app = new Crust("build-subprocess").extend(
			defineExtension(defineExtensionId("producer"), {
				async build() {
					expect(existsSync(path)).toBe(false);
					calls.push("producer");
					await mkdir(source);
					await writeFile(join(source, "marker.txt"), "ready");
				},
			}),
			defineExtension(defineExtensionId("consumer"), {
				sections: () => [
					{
						command: [],
						title: "Generated source",
						body: existsSync(join(source, "marker.txt"))
							? readFileSync(join(source, "marker.txt"), "utf8")
							: "missing",
					},
				],
				build({ snapshot }) {
					calls.push("consumer");
					expect(snapshot.meta.sections).toContainEqual({
						title: "Generated source",
						body: "ready",
					});
				},
			}),
		);

		await expect(app.execute({ argv: [] })).rejects.toThrow("process.exit(0) was called");

		expect(calls).toEqual(["producer", "consumer"]);
		expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
			meta: { sections: [{ title: "Generated source", body: "ready" }] },
		});
	});

	it("runs Extension command recipes once across build hook refreshes", async () => {
		const path = await snapshotPath();
		process.env[SNAPSHOT_PATH_ENV] = path;
		process.env[BUILD_OUT_DIR_ENV] = join(dirname(path), "output");
		let recipeRuns = 0;
		const app = new Crust("build-subprocess").extend(
			defineExtension(defineExtensionId("contributor"), {
				commands: [
					defineCommand("generated", (command) => {
						recipeRuns += 1;
						return command;
					}),
				],
				build() {},
			}),
			defineExtension(defineExtensionId("second-hook"), { build() {} }),
		);

		await expect(app.execute({ argv: [] })).rejects.toThrow("process.exit(0) was called");

		expect(recipeRuns).toBe(1);
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
});

describe("dynamic definition guards (brands own literals; runtime owns config-built defs)", () => {
	const asDynamic = (value: unknown): never[] => value as never[];

	it("rejects duplicate argument names from dynamic defs", () => {
		const defs = asDynamic([
			{ name: "file", type: "string" },
			{ name: "file", type: "string" },
		]);
		expect(() => new Crust("cli").args(...defs)).toThrow(
			expect.objectContaining({
				code: "DEFINITION",
				details: { subject: "argument", name: "file", reason: "duplicate-arg" },
			}),
		);
	});

	it("rejects a mid-tuple variadic from dynamic defs", () => {
		const defs = asDynamic([
			{ name: "files", type: "string", variadic: true },
			{ name: "dest", type: "string", required: true },
		]);
		expect(() => new Crust("cli").args(...defs)).toThrow(
			expect.objectContaining({
				code: "DEFINITION",
				details: { subject: "argument", name: "files", reason: "variadic-position" },
			}),
		);
	});

	it("rejects empty, no-prefixed, and __proto__ flag spellings from dynamic defs", () => {
		const cases: [Record<string, unknown>, string][] = [
			[{ name: "", type: "string" }, "empty-spelling"],
			[{ name: "no-color", type: "boolean" }, "reserved-no-prefix"],
			[{ name: "cache", type: "boolean", aliases: ["no-store"] }, "reserved-no-prefix"],
			[{ name: "__proto__", type: "string" }, "reserved-spelling"],
			[{ name: "safe", type: "string", aliases: ["__proto__"] }, "reserved-spelling"],
		];
		for (const [def, reason] of cases) {
			const defs = asDynamic([def]);
			expect(() => new Crust("cli").flags(...defs)).toThrow(
				expect.objectContaining({
					code: "DEFINITION",
					details: expect.objectContaining({ reason }),
				}),
			);
		}
	});

	it("rejects __proto__ flags at defineContext/defineExtension time", () => {
		expect(() =>
			defineContext(
				"cfg",
				{ flags: asDynamic([{ name: "__proto__", type: "string" }]) },
				() => ({}),
			),
		).toThrow(expect.objectContaining({ code: "DEFINITION" }));
		expect(() =>
			defineExtension(defineExtensionId("cfg-ext"), {
				flags: asDynamic([{ name: "__proto__", type: "string" }]),
			}),
		).toThrow(expect.objectContaining({ code: "DEFINITION" }));
	});

	it("rejects dynamic .flags() collisions with existing spellings", () => {
		const app = new Crust("cli").flags({ name: "mode", type: "string", short: "m" });
		const sameName = asDynamic([{ name: "mode", type: "boolean" }]);
		const aliasSteal = asDynamic([{ name: "method", type: "string", short: "m" }]);
		for (const defs of [sameName, aliasSteal]) {
			expect(() => app.flags(...defs)).toThrow(
				expect.objectContaining({
					code: "DEFINITION",
					details: expect.objectContaining({ reason: "flag-collision" }),
				}),
			);
		}
	});

	it("rejects a dynamic .add() replacing an existing sibling", () => {
		const first = defineCommand("deploy", (cmd) => cmd.action(() => {}));
		const second = defineCommand("deploy", (cmd) => cmd.action(() => {}));
		const app = new Crust("cli").add(first);
		expect(() => app.add(second as never)).toThrow(
			expect.objectContaining({
				code: "DEFINITION",
				details: { subject: "command", name: "deploy", reason: "command-collision" },
			}),
		);
	});

	it("rejects __proto__ as a command name", () => {
		expect(() => new Crust("__proto__")).toThrow(
			expect.objectContaining({
				code: "DEFINITION",
				details: { subject: "command", name: "__proto__", reason: "reserved-name" },
			}),
		);
	});
});
