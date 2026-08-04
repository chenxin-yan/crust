import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { defineContext } from "../api/context.ts";
import { defineExtension } from "../api/extension.ts";
import { defineFlag } from "../api/flags.ts";
import { CrustError } from "../errors.ts";
import type { FlagsDef } from "../types.ts";
import {
	type CommandDefinitionBuilder,
	Crust,
	defineCommand,
	type CrustCommandContext,
	prepareCommandSnapshot,
	VALIDATION_FORCE_EXIT_ENV,
	VALIDATION_MODE_ENV,
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
	it("creates builder with string name", () => {
		const app = new Crust("my-cli");
		expect(app._node.meta.name).toBe("my-cli");
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

	it("initializes node with defaults", () => {
		const app = new Crust("test");
		expect(app._node.localFlags).toEqual({});
		expect(app._node.effectiveFlags).toEqual({});
		expect(app._node.args).toBeUndefined();
		expect(app._node.subCommands).toEqual({});
		expect(app._node.extensions).toEqual([]);
		expect(app._node.run).toBeUndefined();
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Builder methods — immutability + non-mutation invariants
// ────────────────────────────────────────────────────────────────────────────

describe("Crust builder methods — immutability + non-mutation", () => {
	type BuilderCase = readonly [
		name: string,
		apply: (a: Crust) => Crust,
		assertOriginal: (a: Crust) => void,
	];

	const builderCases: readonly BuilderCase[] = [
		[
			".flags()",
			(a) => a.flags({ name: "verbose", type: "boolean" }) as Crust,
			(a) => {
				expect(a._node.localFlags).toEqual({});
				expect(a._node.effectiveFlags).toEqual({});
			},
		],
		[
			".args()",
			(a) => a.args({ name: "file", type: "string" }) as Crust,
			(a) => {
				expect(a._node.args).toBeUndefined();
			},
		],
		[
			".meta()",
			(a) => a.meta({ description: "desc" }) as Crust,
			(a) => {
				expect(a._node.meta.description).toBeUndefined();
			},
		],
		[
			".mount(defineCommand(name, cb))",
			(a) => a.mount(defineCommand("sub", (cmd) => cmd)) as Crust,
			(a) => {
				expect(a._node.subCommands).toEqual({});
			},
		],
		[
			".handle()",
			(a) => a.handle(() => {}) as Crust,
			(a) => {
				expect(a._node.run).toBeUndefined();
			},
		],
		[
			".extend()",
			(a) => a.extend(defineExtension("test-extension")) as Crust,
			(a) => {
				expect(a._node.extensions.length).toBe(0);
			},
		],
		[
			".mount()",
			(a) => a.mount(defineCommand("deploy", (command) => command)) as Crust,
			(a) => {
				expect(a._node.subCommands).toEqual({});
			},
		],
	];

	it.each(builderCases)("%s returns a new instance", (_name, apply) => {
		const app = new Crust("test");
		expect(apply(app)).not.toBe(app);
	});

	it.each(builderCases)(
		"%s does not mutate the original builder",
		(_name, apply, assertOriginal) => {
			const app = new Crust("test");
			apply(app);
			assertOriginal(app);
		},
	);
});

// ────────────────────────────────────────────────────────────────────────────
// .flags()
// ────────────────────────────────────────────────────────────────────────────

describe("Crust .flags()", () => {
	it("returns new instance with correct flags", () => {
		const app = new Crust("test");
		const withFlags = app.flags(
			{ name: "verbose", type: "boolean", short: "v" },
			{ name: "port", type: "number", default: 3000 },
		);

		expect(withFlags._node.localFlags).toEqual({
			verbose: { type: "boolean", short: "v" },
			port: { type: "number", default: 3000 },
		});
		expect(withFlags._node.effectiveFlags).toEqual({
			verbose: { type: "boolean", short: "v" },
			port: { type: "number", default: 3000 },
		});
	});

	it("deep copies flag definitions (decoupled from caller)", () => {
		const flagDef = { name: "verbose" as const, type: "boolean" as const, short: "v" };

		const app = new Crust("test").flags(flagDef);

		// Mutating the original def should not affect the builder
		flagDef.short = "V";
		expect(app._node.localFlags.verbose?.short).toBe("v");
	});

	it("preserves meta from original builder", () => {
		const app = new Crust("my-cli").meta({ description: "desc" });
		const withFlags = app.flags({ name: "verbose", type: "boolean" });

		expect(withFlags._node.meta.name).toBe("my-cli");
		expect(withFlags._node.meta.description).toBe("desc");
	});

	it("throws CrustError DEFINITION at parse time on flag name starting with no-", async () => {
		const app = new Crust("test").flags({ name: "no-cache", type: "boolean" } as never);

		await expect(app.run([])).rejects.toMatchObject({ code: "DEFINITION" });
	});

	it("throws CrustError DEFINITION at parse time on aliases starting with no-", async () => {
		const app = new Crust("test").flags({
			name: "cache",
			type: "boolean",
			aliases: ["no-store"],
		} as never);

		await expect(app.run([])).rejects.toMatchObject({ code: "DEFINITION" });
	});

	it("throws CrustError DEFINITION at parse time on short aliases starting with no-", async () => {
		const app = new Crust("test").flags({
			name: "cache",
			type: "boolean",
			short: "no-c",
		} as never);

		await expect(app.run([])).rejects.toMatchObject({ code: "DEFINITION" });
	});

	it("repeated .flags() calls replace local flags", () => {
		const app = new Crust("test")
			.flags({ name: "first", type: "boolean" })
			.flags({ name: "second", type: "string" });

		expect(app._node.localFlags).toEqual({ second: { type: "string" } });
	});

	it("throws CrustError DEFINITION on duplicate names within one .flags() call", () => {
		expect(() =>
			new Crust("test").flags(
				{ name: "verbose", type: "boolean" },
				{ name: "verbose", type: "string" },
			),
		).toThrow(/defined more than once/);
	});

	it("accepts flags with inherit: true", () => {
		const app = new Crust("test").flags(
			{ name: "verbose", type: "boolean", inherit: true },
			{ name: "port", type: "number" },
		);

		expect(app._node.localFlags.verbose?.inherit).toBe(true);
		expect(app._node.localFlags.port?.inherit).toBeUndefined();
	});
});

// ────────────────────────────────────────────────────────────────────────────
// .args()
// ────────────────────────────────────────────────────────────────────────────

describe("Crust .args()", () => {
	it("returns new instance with correct args", () => {
		const app = new Crust("test");
		const withArgs = app.args(
			{ name: "file", type: "string", required: true },
			{ name: "count", type: "number", default: 1 },
		);

		expect(withArgs._node.args).toBeDefined();
		expect(withArgs._node.args?.length).toBe(2);
		expect(withArgs._node.args?.[0]?.name).toBe("file");
		expect(withArgs._node.args?.[0]?.required).toBe(true);
		expect(withArgs._node.args?.[1]?.name).toBe("count");
		expect(withArgs._node.args?.[1]?.default).toBe(1);
	});

	it("deep copies arg definitions (decoupled from caller)", () => {
		const argDefs = [
			{ name: "file" as const, type: "string" as const, description: "orig" },
		] as const;

		const app = new Crust("test").args(...argDefs);

		// Original arg should be decoupled — check node has a copy
		expect(app._node.args?.[0]?.description).toBe("orig");
	});

	it("preserves meta and flags from original builder", () => {
		const app = new Crust("my-cli")
			.meta({ description: "desc" })
			.flags({ name: "verbose", type: "boolean" });
		const withArgs = app.args({ name: "file", type: "string" });

		expect(withArgs._node.meta.name).toBe("my-cli");
		expect(withArgs._node.meta.description).toBe("desc");
		expect(withArgs._node.localFlags.verbose).toBeDefined();
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Chaining .flags().args()
// ────────────────────────────────────────────────────────────────────────────

describe("Crust chaining", () => {
	it(".flags().args() preserves both on the final builder", () => {
		const app = new Crust("test")
			.flags(
				{ name: "verbose", type: "boolean", short: "v" },
				{ name: "port", type: "number", default: 3000 },
			)
			.args({ name: "file", type: "string", required: true });

		expect(app._node.localFlags.verbose).toBeDefined();
		expect(app._node.localFlags.port).toBeDefined();
		expect(app._node.args?.length).toBe(1);
		expect(app._node.args?.[0]?.name).toBe("file");
	});

	it(".args().flags() preserves both on the final builder", () => {
		const app = new Crust("test")
			.args({ name: "file", type: "string" })
			.flags({ name: "verbose", type: "boolean" });

		expect(app._node.localFlags.verbose).toBeDefined();
		expect(app._node.args?.length).toBe(1);
	});

	it("does not mutate intermediate builders", () => {
		const base = new Crust("test");
		const withFlags = base.flags({ name: "verbose", type: "boolean" });
		const withArgs = withFlags.args({ name: "file", type: "string" });

		expect(base._node.localFlags).toEqual({});
		expect(base._node.args).toBeUndefined();

		expect(withFlags._node.localFlags.verbose).toBeDefined();
		expect(withFlags._node.args).toBeUndefined();

		expect(withArgs._node.localFlags.verbose).toBeDefined();
		expect(withArgs._node.args?.length).toBe(1);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// .meta()
// ────────────────────────────────────────────────────────────────────────────

describe("Crust .meta()", () => {
	it("sets description and usage on the node", () => {
		const app = new Crust("test").meta({
			description: "A test command",
			usage: "test [options]",
		});

		expect(app._node.meta.description).toBe("A test command");
		expect(app._node.meta.usage).toBe("test [options]");
	});

	it("preserves the command name", () => {
		const app = new Crust("my-cli").meta({ description: "desc" });
		expect(app._node.meta.name).toBe("my-cli");
	});

	it("preserves flags and args from original builder", () => {
		const app = new Crust("test")
			.flags({ name: "verbose", type: "boolean" })
			.args({ name: "file", type: "string" })
			.meta({ description: "desc" });

		expect(app._node.localFlags.verbose).toBeDefined();
		expect(app._node.args?.length).toBe(1);
		expect(app._node.meta.description).toBe("desc");
	});

	it("can be chained before .flags() and .args()", () => {
		const app = new Crust("test")
			.meta({ description: "desc" })
			.flags({ name: "verbose", type: "boolean" })
			.args({ name: "file", type: "string" });

		expect(app._node.meta.description).toBe("desc");
		expect(app._node.localFlags.verbose).toBeDefined();
		expect(app._node.args?.length).toBe(1);
	});

	it("sets only description when usage is omitted", () => {
		const app = new Crust("test").meta({ description: "desc" });
		expect(app._node.meta.description).toBe("desc");
		expect(app._node.meta.usage).toBeUndefined();
	});

	it("works in subcommand callbacks", () => {
		const app = new Crust("cli").mount(
			defineCommand("sub", (cmd) =>
				cmd.meta({ description: "A subcommand", usage: "cli sub [options]" }),
			),
		);

		const subNode = app._node.subCommands.sub;
		expect(subNode?.meta.description).toBe("A subcommand");
		expect(subNode?.meta.usage).toBe("cli sub [options]");
		expect(subNode?.meta.name).toBe("sub");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Type-level tests — .flags()
// ────────────────────────────────────────────────────────────────────────────

describe("Crust type-level tests", () => {
	it(".flags() updates Local generic", () => {
		const app = new Crust("test").flags(
			{ name: "verbose", type: "boolean", short: "v" },
			{ name: "port", type: "number", default: 3000 },
		);

		// Extract the Local type from the phantom _types property
		type AppLocal = (typeof app)["_types"]["local"];

		type _checkVerbose = Expect<
			Equal<AppLocal["verbose"], { readonly type: "boolean"; readonly short: "v" }>
		>;
		type _checkPort = Expect<
			Equal<AppLocal["port"], { readonly type: "number"; readonly default: 3000 }>
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

		// Verify flags Local generic is preserved
		type AppLocal = (typeof app)["_types"]["local"];
		type _checkVerbose = Expect<
			Equal<AppLocal["verbose"], { readonly type: "boolean"; readonly short: "v" }>
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

	it("Inherited generic starts as {} for root builder", () => {
		const app = new Crust("test");

		// Root builder has no inherited flags — but defaults to broad FlagsDef
		// After .flags(), Inherited should still be the default FlagsDef
		type AppInherited = (typeof app)["_types"]["inherited"];
		type _check = Expect<Equal<AppInherited, FlagsDef>>;
	});
});

// ────────────────────────────────────────────────────────────────────────────
// .mount() — Runtime tests
// ────────────────────────────────────────────────────────────────────────────

describe("Crust .mount() with inline definitions", () => {
	it("registers a subcommand in the node's subCommands", () => {
		const app = new Crust("cli").mount(
			defineCommand("sub", (cmd) => cmd.flags({ name: "output", type: "string" })),
		);

		const subNode = app._node.subCommands.sub;
		expect(subNode).toBeDefined();
		expect(subNode?.meta.name).toBe("sub");
	});

	it("subcommand node has correct local flags", () => {
		const app = new Crust("cli").mount(
			defineCommand("sub", (cmd) => cmd.flags({ name: "output", type: "string" })),
		);

		expect(app._node.subCommands.sub?.localFlags).toEqual({
			output: { type: "string" },
		});
	});

	it("subcommand node computes effectiveFlags from inherited + local", () => {
		const app = new Crust("cli")
			.flags({ name: "verbose", type: "boolean", inherit: true }, { name: "port", type: "number" })
			.mount(defineCommand("sub", (cmd) => cmd.flags({ name: "output", type: "string" })));

		const subNode = app._node.subCommands.sub;
		expect(subNode).toBeDefined();
		// Should include inherited verbose (inherit: true) and local output
		// Should NOT include port (no inherit)
		expect(subNode?.effectiveFlags.verbose).toEqual({
			type: "boolean",
			inherit: true,
		});
		expect(subNode?.effectiveFlags.output).toEqual({ type: "string" });
		expect(subNode?.effectiveFlags.port).toBeUndefined();
	});

	it("throws CrustError DEFINITION on empty subcommand name", () => {
		const app = new Crust("cli");
		try {
			app.mount(defineCommand("", (cmd) => cmd));
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("DEFINITION");
			expect((err as CrustError).message).toContain("non-empty");
		}
	});

	it("throws CrustError DEFINITION on whitespace-only subcommand name", () => {
		const app = new Crust("cli");
		try {
			app.mount(defineCommand("   ", (cmd) => cmd));
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("DEFINITION");
		}
	});

	it("throws CrustError DEFINITION on duplicate subcommand name", () => {
		const app = new Crust("cli").mount(defineCommand("sub", (cmd) => cmd));
		try {
			app.mount(defineCommand("sub", (cmd) => cmd));
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("DEFINITION");
			expect((err as CrustError).message).toContain("already registered");
		}
	});

	it("callback receives a fresh builder (not the parent)", () => {
		let receivedBuilder: CommandDefinitionBuilder | undefined;

		const app = new Crust("cli").flags({ name: "verbose", type: "boolean", inherit: true }).mount(
			defineCommand("sub", (cmd) => {
				receivedBuilder = cmd;
				return cmd;
			}),
		);

		expect(receivedBuilder).toBeDefined();
		expect(receivedBuilder).not.toBe(app);
		const runtimeBuilder = receivedBuilder as unknown as Crust;
		expect(runtimeBuilder._node.meta.name).toBe("sub");
		expect(runtimeBuilder._node.localFlags).toEqual({});
	});

	it("callback child builder carries parent effective flags at runtime", () => {
		let childInherited: FlagsDef = {};

		new Crust("cli")
			.flags({ name: "verbose", type: "boolean", inherit: true }, { name: "port", type: "number" })
			.mount(
				defineCommand("sub", (cmd) => {
					childInherited = (cmd as unknown as Crust)._inheritedFlags;
					return cmd;
				}),
			);

		// _inheritedFlags carries ALL parent effective flags (not just inheritable)
		// The filtering for inherit:true happens when computeEffectiveFlags is called
		// during the child's own .mount() or effectiveFlags computation
		expect(childInherited.verbose).toEqual({
			type: "boolean",
			inherit: true,
		});
		expect(childInherited.port).toEqual({
			type: "number",
		});
	});

	it("nested mounted definitions work", () => {
		const app = new Crust("cli")
			.flags({ name: "verbose", type: "boolean", inherit: true })
			.mount(
				defineCommand("level1", (cmd) =>
					cmd
						.flags({ name: "output", type: "string", inherit: true })
						.mount(
							defineCommand("level2", (cmd2) => cmd2.flags({ name: "format", type: "string" })),
						),
				),
			);

		const level1 = app._node.subCommands.level1;
		expect(level1).toBeDefined();
		expect(level1?.subCommands.level2).toBeDefined();

		const level2 = level1?.subCommands.level2;
		// level2 should have effective flags: verbose (from root), output (from level1), format (local)
		expect(level2?.effectiveFlags.verbose).toEqual({
			type: "boolean",
			inherit: true,
		});
		expect(level2?.effectiveFlags.output).toEqual({
			type: "string",
			inherit: true,
		});
		expect(level2?.effectiveFlags.format).toEqual({ type: "string" });
	});

	it("multiple subcommands can be registered", () => {
		const app = new Crust("cli")
			.mount(defineCommand("sub1", (cmd) => cmd.flags({ name: "a", type: "string" })))
			.mount(defineCommand("sub2", (cmd) => cmd.flags({ name: "b", type: "number" })));

		expect(app._node.subCommands.sub1).toBeDefined();
		expect(app._node.subCommands.sub2).toBeDefined();
		expect(app._node.subCommands.sub1?.localFlags.a).toBeDefined();
		expect(app._node.subCommands.sub2?.localFlags.b).toBeDefined();
	});

	it("preserves parent flags and args when registering subcommand", () => {
		const app = new Crust("cli")
			.flags({ name: "verbose", type: "boolean" })
			.args({ name: "file", type: "string" })
			.mount(defineCommand("sub", (cmd) => cmd));

		expect(app._node.localFlags.verbose).toBeDefined();
		expect(app._node.args?.length).toBe(1);
		expect(app._node.args?.[0]?.name).toBe("file");
	});

	it("child flag override replaces inherited flag at runtime", () => {
		const app = new Crust("cli").flags({ name: "output", type: "string", inherit: true }).mount(
			defineCommand("sub", (cmd) =>
				// Override output with a number type
				cmd.flags({ name: "output", type: "number", default: 42 }),
			),
		);

		const subNode = app._node.subCommands.sub;
		expect(subNode).toBeDefined();
		expect(subNode?.effectiveFlags.output).toEqual({
			type: "number",
			default: 42,
		});
	});
});

// ────────────────────────────────────────────────────────────────────────────
// .mount() — Type-level tests
// ────────────────────────────────────────────────────────────────────────────

describe("Crust .mount() type-level tests", () => {
	it("types inherited and refined values in handlers", () => {
		const verbose = defineFlag("verbose", { type: "boolean", inherit: true });
		const output = defineFlag("output", { type: "string", inherit: true });
		new Crust("cli").flags(verbose, { name: "rootOnly", type: "string" }).mount(
			defineCommand("level1", { flags: [verbose] }, (command) =>
				command.flags(output).mount(
					defineCommand("level2", { flags: [verbose, output] }, (child) =>
						child
							.args({ name: "target", type: "string", required: true })
							.handle(({ args, flags }) => {
								type _target = Expect<Equal<typeof args.target, string>>;
								type _verbose = Expect<Equal<typeof flags.verbose, boolean | undefined>>;
								type _output = Expect<Equal<typeof flags.output, string | undefined>>;
								// @ts-expect-error -- non-inheritable root flags are not available
								void flags.rootOnly;
							}),
					),
				),
			),
		);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// .handle() — Runtime tests
// ────────────────────────────────────────────────────────────────────────────

describe("Crust .handle()", () => {
	it("stores handler on node", () => {
		const handler = () => {};
		const app = new Crust("test").handle(handler);

		expect(app._node.run).toBeDefined();
		expect(typeof app._node.run).toBe("function");
	});

	it("handler is callable with correct context shape", () => {
		let receivedCtx: CrustCommandContext | undefined;

		const app = new Crust("test")
			.flags({ name: "verbose", type: "boolean" })
			.args({ name: "file", type: "string", required: true })
			.handle((ctx) => {
				receivedCtx = ctx as unknown as CrustCommandContext;
			});

		// Manually invoke the stored handler with a mock context
		const mockCtx = {
			args: { file: "test.txt" },
			flags: { verbose: true },
			rawArgs: [],
			command: app._node,
		};
		void app._node.run?.(mockCtx);

		expect(receivedCtx).toBeDefined();
		expect((receivedCtx as unknown as Record<string, unknown>)?.args).toEqual({
			file: "test.txt",
		});
		expect((receivedCtx as unknown as Record<string, unknown>)?.flags).toEqual({
			verbose: true,
		});
	});

	it("preserves flags and args when adding run handler", () => {
		const app = new Crust("test")
			.flags({ name: "verbose", type: "boolean" })
			.args({ name: "file", type: "string" })
			.handle(() => {});

		expect(app._node.localFlags.verbose).toBeDefined();
		expect(app._node.args?.length).toBe(1);
	});

	it("can chain .handle() after .mount()", () => {
		const app = new Crust("cli").mount(defineCommand("sub", (cmd) => cmd)).handle(() => {});

		expect(app._node.run).toBeDefined();
		expect(app._node.subCommands.sub).toBeDefined();
	});
});

// ────────────────────────────────────────────────────────────────────────────
// .handle() — Type-level tests
// ────────────────────────────────────────────────────────────────────────────

describe("Crust .handle() type-level tests", () => {
	it("run handler receives InferArgs<A> for args", () => {
		new Crust("test")
			.args(
				{ name: "file", type: "string", required: true },
				{ name: "count", type: "number", default: 5 },
			)
			.handle((_ctx) => {
				type CtxArgs = typeof _ctx.args;
				type _checkFile = Expect<Equal<CtxArgs["file"], string>>;
				type _checkCount = Expect<Equal<CtxArgs["count"], number>>;
			});
	});

	it("run handler receives EffectiveFlags (inherited + local merged) for flags", () => {
		const verbose = defineFlag("verbose", { type: "boolean", inherit: true });
		new Crust("cli").flags(verbose, { name: "port", type: "number", default: 3000 }).mount(
			defineCommand("sub", { flags: [verbose] }, (cmd) =>
				cmd.flags({ name: "output", type: "string", required: true }).handle((_ctx) => {
					type CtxFlags = typeof _ctx.flags;
					// inherited verbose (inherit: true) should be present
					type _checkVerbose = Expect<Equal<CtxFlags["verbose"], boolean | undefined>>;
					// local output (required) should be present
					type _checkOutput = Expect<Equal<CtxFlags["output"], string>>;
				}),
			),
		);
	});

	it("declared flag requirements are visible in mounted handlers", () => {
		const verbose = defineFlag("verbose", { type: "boolean", inherit: true, default: false });
		new Crust("cli").flags(verbose).mount(
			defineCommand("sub", { flags: [verbose] }, (cmd) =>
				cmd.handle((_ctx) => {
					// The handler sees the required flag even though the
					// subcommand has no local flags
					type CtxFlags = typeof _ctx.flags;
					type _checkVerbose = Expect<Equal<CtxFlags["verbose"], boolean>>;
				}),
			),
		);
	});

	it("override flag shows overridden type in handler", () => {
		new Crust("cli").flags({ name: "output", type: "string", inherit: true }).mount(
			defineCommand("sub", (cmd) =>
				cmd.flags({ name: "output", type: "number", default: 42 }).handle((_ctx) => {
					type CtxFlags = typeof _ctx.flags;
					// output was overridden from string to number
					type _checkOutput = Expect<Equal<CtxFlags["output"], number>>;
				}),
			),
		);
	});

	it("handler with no flags/args gets empty types", () => {
		new Crust("test").handle((_ctx) => {
			// With broad FlagsDef default, flags resolve to Record<string, ...>
			// With broad ArgsDef default, args resolve to Record<string, never>
			type _checkRawArgs = Expect<Equal<typeof _ctx.rawArgs, string[]>>;
		});
	});

	it("handler receives typed flags and args", () => {
		const app = new Crust("test")
			.flags({ name: "verbose", type: "boolean", default: false })
			.args({ name: "file", type: "string", required: true });

		const withHandler = app.handle((_ctx) => {
			type CtxFlags = typeof _ctx.flags;
			type CtxArgs = typeof _ctx.args;
			type _checkVerbose = Expect<Equal<CtxFlags["verbose"], boolean>>;
			type _checkFile = Expect<Equal<CtxArgs["file"], string>>;
		});

		expect(withHandler._node.run).toBeDefined();
	});

	it("variadic args resolve to array type in handler", () => {
		new Crust("test").args({ name: "files", type: "string", variadic: true }).handle((_ctx) => {
			type CtxArgs = typeof _ctx.args;
			type _checkFiles = Expect<Equal<CtxArgs["files"], string[]>>;
		});
	});

	it("multiple flag resolves to array type in handler", () => {
		new Crust("test")
			.flags({ name: "tags", type: "string", multiple: true, required: true })
			.handle((_ctx) => {
				type CtxFlags = typeof _ctx.flags;
				type _checkTags = Expect<Equal<CtxFlags["tags"], string[]>>;
			});
	});

	it("optional flag resolves to union with undefined in handler", () => {
		new Crust("test").flags({ name: "port", type: "number" }).handle((_ctx) => {
			type CtxFlags = typeof _ctx.flags;
			type _checkPort = Expect<Equal<CtxFlags["port"], number | undefined>>;
		});
	});

	it("required flag resolves to non-optional type in handler", () => {
		new Crust("test").flags({ name: "name", type: "string", required: true }).handle((_ctx) => {
			type CtxFlags = typeof _ctx.flags;
			type _checkName = Expect<Equal<CtxFlags["name"], string>>;
		});
	});

	it("flag with default resolves to non-optional type in handler", () => {
		new Crust("test").flags({ name: "port", type: "number", default: 3000 }).handle((_ctx) => {
			type CtxFlags = typeof _ctx.flags;
			type _checkPort = Expect<Equal<CtxFlags["port"], number>>;
		});
	});
});

// ────────────────────────────────────────────────────────────────────────────
// .extend() — Runtime tests
// ────────────────────────────────────────────────────────────────────────────

describe("Crust .extend()", () => {
	it("registers an Extension on the node's extensions array", () => {
		const ext = defineExtension("test-extension");
		const app = new Crust("test").extend(ext);

		expect(app._node.extensions.length).toBe(1);
		expect(app._node.extensions[0]).toBe(ext);
	});

	it("multiple .extend() calls chain in registration order", () => {
		const one = defineExtension("one");
		const two = defineExtension("two");
		const three = defineExtension("three");

		const app = new Crust("test").extend(one).extend(two, three);

		expect(app._node.extensions.map((e) => e.name)).toEqual(["one", "two", "three"]);
	});

	it("defineExtension() returns a frozen plain config", () => {
		const ext = defineExtension("frozen", { flags: { x: { type: "boolean" } } });

		expect(Object.isFrozen(ext)).toBe(true);
		expect(ext.name).toBe("frozen");
		expect(ext.flags?.x?.type).toBe("boolean");
	});

	it("defineExtension() rejects an empty name", () => {
		expect(() => defineExtension("  ")).toThrow(CrustError);
	});

	it("preserves flags, args, handler, and subcommands when extending", () => {
		const app = new Crust("test")
			.flags({ name: "verbose", type: "boolean" })
			.args({ name: "file", type: "string" })
			.mount(defineCommand("sub", (cmd) => cmd))
			.handle(() => {})
			.extend(defineExtension("test-extension"));

		expect(app._node.localFlags.verbose).toBeDefined();
		expect(app._node.args?.length).toBe(1);
		expect(app._node.subCommands.sub).toBeDefined();
		expect(app._node.run).toBeDefined();
		expect(app._node.extensions.length).toBe(1);
	});

	it("intermediate builder retains its own extensions independently", () => {
		const one = defineExtension("one");
		const two = defineExtension("two");

		const base = new Crust("test").extend(one);
		const extended = base.extend(two);

		expect(base._node.extensions.map((e) => e.name)).toEqual(["one"]);
		expect(extended._node.extensions.map((e) => e.name)).toEqual(["one", "two"]);
	});
});

describe("Extension application at prepare time", () => {
	it("recursive Extension flags reach every command, including Extension commands", async () => {
		const seen: Record<string, unknown>[] = [];
		const debug = defineExtension("debug", {
			flags: { debug: { type: "boolean", inherit: true } },
		});

		const app = new Crust("cli").extend(debug).mount(
			defineCommand("sub", (cmd) =>
				cmd.handle(({ flags }) => {
					seen.push(flags);
				}),
			),
		);

		await app.run(["sub", "--debug"]);

		expect(seen[0]?.debug).toBe(true);
	});

	it("non-recursive Extension flags stay on the root", async () => {
		const version = defineExtension("version", {
			flags: { version: { type: "boolean", recursive: false } },
		});

		const app = new Crust("cli")
			.extend(version)
			.mount(defineCommand("sub", (cmd) => cmd.handle(() => {})));

		// --version is unknown on the subcommand → PARSE error
		await expect(app.run(["sub", "--version"])).rejects.toMatchObject({ code: "PARSE" });
	});

	it("Extension flag colliding with an application flag is a DEFINITION error", async () => {
		const clash = defineExtension("clash", { flags: { verbose: { type: "boolean" } } });
		const app = new Crust("cli")
			.flags({ name: "verbose", type: "boolean" })
			.extend(clash)
			.handle(() => {});

		await expect(app.run([])).rejects.toMatchObject({ code: "DEFINITION" });
	});

	it("Extension flag short/alias collisions are DEFINITION errors at prepare time", async () => {
		const clash = defineExtension("clash", {
			flags: { loud: { type: "boolean", short: "v" } },
		});
		const app = new Crust("cli")
			.flags({ name: "verbose", type: "boolean", short: "v" })
			.extend(clash)
			.handle(() => {});

		await expect(app.run([])).rejects.toMatchObject({ code: "DEFINITION" });
	});

	it("Extension flag colliding with another Extension's flag is a DEFINITION error", async () => {
		const a = defineExtension("a", { flags: { shared: { type: "boolean" } } });
		const b = defineExtension("b", { flags: { shared: { type: "boolean" } } });
		const app = new Crust("cli").extend(a, b).handle(() => {});

		await expect(app.run([])).rejects.toMatchObject({ code: "DEFINITION" });
	});

	it("Extension command definitions are routable, validated, and inherit recursive flags", async () => {
		const lines: string[] = [];
		const completion = defineExtension("completion", {
			commands: [
				defineCommand("completion", (command) =>
					command
						.args({ name: "shell", type: "string", required: true, choices: ["bash", "zsh"] })
						.handle(({ args, flags, rootCommand }) => {
							lines.push(
								`completion:${args.shell}:${(flags as Record<string, unknown>).verbose}:${rootCommand.meta.name}`,
							);
						}),
				),
			],
		});
		const verbose = defineExtension("verbose", {
			flags: { verbose: { type: "boolean" } },
		});

		const app = new Crust("cli").extend(completion, verbose).handle(() => {});

		await app.run(["completion", "bash", "--verbose"]);
		expect(lines).toEqual(["completion:bash:true:cli"]);
		await expect(app.run(["completion", "fish"])).rejects.toMatchObject({ code: "PARSE" });
		await expect(app.run(["completion"])).rejects.toMatchObject({ code: "VALIDATION" });
	});

	it("Extension command requirements reject missing inherited flags", async () => {
		const verbose = defineFlag("verbose", { type: "boolean", inherit: true });
		let recipeRan = false;
		const tools = defineExtension("tools", {
			commands: [
				defineCommand("status", { flags: [verbose] }, (command) => {
					recipeRan = true;
					return command.handle(() => {});
				}),
			],
		});

		await expect(new Crust("cli").extend(tools).run(["status"])).rejects.toMatchObject({
			code: "DEFINITION",
			message:
				'Extension "tools" command "status" requires flag "--verbose", which is not declared with inherit: true on application root "cli"',
			details: { subject: "flag", name: "verbose", reason: "missing-required-flag" },
		});
		expect(recipeRan).toBe(false);
	});

	it("Extension command requirements name the Extension and missing Context", async () => {
		const db = defineContext("db", () => "database");
		const databaseTools = defineExtension("database-tools", {
			commands: [defineCommand("users", { ctx: [db] }, (command) => command.handle(() => {}))],
		});

		try {
			await new Crust("cli").extend(databaseTools).run(["users"]);
			expect.unreachable("should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(CrustError);
			expect((error as CrustError).code).toBe("DEFINITION");
			expect((error as CrustError).message).toContain('Extension "database-tools"');
			expect((error as CrustError).message).toContain('Context "db"');
		}
	});

	it("Extension command colliding with an application command is a DEFINITION error", async () => {
		const clash = defineExtension("clash", {
			commands: [defineCommand("sub", (command) => command.handle(() => {}))],
		});
		const app = new Crust("cli")
			.mount(defineCommand("sub", (cmd) => cmd.handle(() => {})))
			.extend(clash);

		await expect(app.run(["sub"])).rejects.toMatchObject({ code: "DEFINITION" });
	});

	it("rejects non-definition Extension commands", async () => {
		const invalid = defineExtension("invalid", { commands: [{} as never] });

		await expect(new Crust("cli").extend(invalid).run([])).rejects.toMatchObject({
			code: "DEFINITION",
			message: 'Extension "invalid" commands must be created by defineCommand()',
		});
	});

	it("attributes foreign builders returned by Extension command definitions", async () => {
		const invalid = defineExtension("invalid", {
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
		const invalid = defineExtension("invalid", {
			commands: [
				defineCommand(
					"nested",
					(command) =>
						(command as unknown as Crust).extend(defineExtension("nested-extension")) as never,
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

	it("does not mutate the source builder across executions", async () => {
		let runCount = 0;
		const debug = defineExtension("debug", { flags: { debug: { type: "boolean" } } });
		const app = new Crust("repeat").extend(debug).handle(({ flags }) => {
			if ((flags as Record<string, unknown>).debug) runCount++;
		});

		await app.execute({ argv: ["--debug"] });
		await app.execute({ argv: ["--debug"] });

		expect(runCount).toBe(2);
		expect(app._node.effectiveFlags.debug).toBeUndefined();
	});
});

describe("Extension named hooks", () => {
	it("runs pre-run hooks in extension order and finish skips later hooks and the handler", async () => {
		const order: string[] = [];
		const first = defineExtension("first", {
			hooks: {
				preRun: () => {
					order.push("first");
				},
			},
		});
		const gate = defineExtension("gate", {
			hooks: {
				preRun(ctx) {
					order.push("gate");
					return ctx.finish();
				},
			},
		});
		const last = defineExtension("last", {
			hooks: {
				preRun: () => {
					order.push("last");
				},
			},
		});
		const app = new Crust("cli")
			.args({ name: "file", type: "string", required: true })
			.extend(first, gate, last)
			.handle(() => {
				order.push("handler");
			});

		await app.run([]);
		expect(order).toEqual(["first", "gate"]);
	});

	it("runs post-run hooks LIFO for completed, failed, and finished invocations", async () => {
		const outcomes: string[] = [];
		const first = defineExtension("first", {
			hooks: {
				postRun: (_ctx, outcome) => {
					outcomes.push(`first:${outcome.status}`);
				},
			},
		});
		const second = defineExtension("second", {
			hooks: {
				postRun: (_ctx, outcome) => {
					outcomes.push(`second:${outcome.status}`);
				},
			},
		});

		await new Crust("cli")
			.extend(first, second)
			.handle(() => {})
			.run([]);
		expect(outcomes).toEqual(["second:completed", "first:completed"]);

		outcomes.length = 0;
		await expect(
			new Crust("cli")
				.extend(first, second)
				.handle(() => {
					throw new Error("boom");
				})
				.run([]),
		).rejects.toThrow("boom");
		expect(outcomes).toEqual(["second:failed", "first:failed"]);

		outcomes.length = 0;
		const gate = defineExtension("gate", { hooks: { preRun: (ctx) => ctx.finish() } });
		await new Crust("cli")
			.extend(first, gate, second)
			.handle(() => {})
			.run([]);
		expect(outcomes).toEqual(["second:finished", "first:finished"]);
	});

	it("reports the finishing Extension and exposes parsed snapshots before validation", async () => {
		let outcomeBy = "";
		let seenPort: unknown;
		const gate = defineExtension("gate", {
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
			.handle(() => {})
			.run(["--port", "8080"]);

		expect(seenPort).toBe(8080);
		expect(outcomeBy).toBe("gate");
	});

	it("does not run hooks for routing failures and exposes frozen snapshots with injected io", async () => {
		let preRunCalled = false;
		const lines: string[] = [];
		const probe = defineExtension("probe", {
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
			.mount(defineCommand("known", (cmd) => cmd.handle(() => {})));

		await app.run(["known"], { stdout: (line) => lines.push(line) });
		expect(lines).toEqual(["probe:known"]);
		preRunCalled = false;
		await expect(app.run(["unknown"])).rejects.toMatchObject({ code: "COMMAND_NOT_FOUND" });
		expect(preRunCalled).toBe(false);
	});

	it("preserves a failed invocation over post-run errors and fails success with the first cleanup error", async () => {
		const original = new Error("original");
		const cleanup = defineExtension("cleanup", {
			hooks: {
				postRun() {
					throw new Error("cleanup");
				},
			},
		});
		await expect(
			new Crust("cli")
				.extend(cleanup)
				.handle(() => {
					throw original;
				})
				.run([]),
		).rejects.toBe(original);

		const calls: string[] = [];
		const first = defineExtension("first", {
			hooks: {
				postRun() {
					calls.push("first");
					throw new Error("first cleanup");
				},
			},
		});
		const second = defineExtension("second", {
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
				.handle(() => {})
				.run([]),
		).rejects.toThrow("second cleanup");
		expect(calls).toEqual(["second", "first"]);
	});

	it("passes the application root snapshot to app and Extension command handlers", async () => {
		const roots: string[] = [];
		const extension = defineExtension("extension", {
			commands: [
				defineCommand("owned", (command) =>
					command.handle(({ rootCommand }) => {
						roots.push(rootCommand.meta.name);
					}),
				),
			],
		});
		const app = new Crust("cli").extend(extension).handle(({ rootCommand }) => {
			roots.push(rootCommand.meta.name);
		});

		await app.run([]);
		await app.run(["owned"]);
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
		new Crust("cli").handle(() => {
			throw new Error("boom");
		});

	it("stops at the first truthy result and retains the nonzero exit status", async () => {
		const order: string[] = [];
		const first = defineExtension("first", {
			hooks: { onError: () => (order.push("first"), undefined) },
		});
		const presenter = defineExtension("presenter", {
			hooks: {
				onError(error, ctx) {
					order.push("presenter");
					ctx.stderr(`pretty: ${(error as Error).message}`);
					return true;
				},
			},
		});
		const never = defineExtension("never", {
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

	it("falls through to Core's default renderer and never runs for run()", async () => {
		let onErrorRan = false;
		const observer = defineExtension("observer", {
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

	it("resolves with no value on success", async () => {
		const app = new Crust("test").handle(() => {});
		await expect(app.run([])).resolves.toBeUndefined();
	});

	it("throws the original CrustError without rendering or setting exitCode", async () => {
		const stderrLines: string[] = [];
		const app = new Crust("test").flags({ name: "port", type: "number" }).handle(() => {});

		await expect(
			app.run(["--unknown"], { stderr: (text) => stderrLines.push(text) }),
		).rejects.toMatchObject({ code: "PARSE" });
		expect(stderrLines).toEqual([]);
		// run() never touches process status
		expect(process.exitCode).toBe(0);
	});

	it("throws the original handler error unwrapped", async () => {
		const boom = new Error("handler exploded");
		const app = new Crust("test").handle(() => {
			throw boom;
		});

		await expect(app.run([])).rejects.toBe(boom);
		// run() never touches process status
		expect(process.exitCode).toBe(0);
	});

	it("injected stdout/stderr callbacks reach the Command Handler", async () => {
		const out: string[] = [];
		const err: string[] = [];
		const app = new Crust("test").handle((ctx) => {
			ctx.stdout("to out");
			ctx.stderr("to err");
		});

		await app.run([], { stdout: (t) => out.push(t), stderr: (t) => err.push(t) });

		expect(out).toEqual(["to out"]);
		expect(err).toEqual(["to err"]);
	});

	it("parses argv exactly like execute", async () => {
		let received: unknown;
		const app = new Crust("test")
			.flags({ name: "verbose", type: "boolean" })
			.args({ name: "file", type: "string" })
			.handle((ctx) => {
				received = { args: ctx.args, flags: ctx.flags };
			});

		await app.run(["a.txt", "--verbose"]);

		expect(received).toEqual({ args: { file: "a.txt" }, flags: { verbose: true } });
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

	it("runs root handler with parsed flags", async () => {
		let receivedFlags: Record<string, unknown> = {};

		const app = new Crust("test")
			.flags({ name: "verbose", type: "boolean", short: "v" })
			.handle((ctx) => {
				receivedFlags = ctx.flags;
			});

		await app.execute({ argv: ["--verbose"] });

		expect(receivedFlags.verbose).toBe(true);
	});

	it("runs root handler with parsed args", async () => {
		let receivedArgs: Record<string, unknown> = {};

		const app = new Crust("test")
			.args({ name: "file", type: "string", required: true })
			.handle((ctx) => {
				receivedArgs = ctx.args;
			});

		await app.execute({ argv: ["hello.txt"] });

		expect(receivedArgs.file).toBe("hello.txt");
	});

	it("runs root handler with flags and args combined", async () => {
		let receivedCtx: CrustCommandContext | undefined;

		const app = new Crust("test")
			.flags({ name: "port", type: "number", default: 3000 }, { name: "verbose", type: "boolean" })
			.args({ name: "dir", type: "string", default: "." })
			.handle((ctx) => {
				receivedCtx = ctx as unknown as CrustCommandContext;
			});

		await app.execute({ argv: ["public", "--port", "8080"] });

		expect(receivedCtx).toBeDefined();
		expect((receivedCtx as unknown as { args: Record<string, unknown> }).args.dir).toBe("public");
		expect((receivedCtx as unknown as { flags: Record<string, unknown> }).flags.port).toBe(8080);
	});

	it("routes to subcommand", async () => {
		let handlerRan = "";

		const app = new Crust("cli")
			.handle(() => {
				handlerRan = "root";
			})
			.mount(
				defineCommand("sub", (cmd) =>
					cmd.handle(() => {
						handlerRan = "sub";
					}),
				),
			);

		await app.execute({ argv: ["sub"] });

		expect(handlerRan).toBe("sub");
	});

	it("passes inherited flags to subcommand handler", async () => {
		let subFlags: Record<string, unknown> = {};

		const app = new Crust("cli")
			.flags(
				{ name: "verbose", type: "boolean", inherit: true },
				{ name: "port", type: "number", default: 3000 },
			)
			.mount(
				defineCommand("sub", (cmd) =>
					cmd.handle((ctx) => {
						subFlags = ctx.flags;
					}),
				),
			);

		await app.execute({ argv: ["sub", "--verbose"] });

		expect(subFlags.verbose).toBe(true);
		// port is not inherited (no inherit: true)
		expect(subFlags.port).toBeUndefined();
	});

	it("argv override works", async () => {
		let receivedDir = "";

		const app = new Crust("test")
			.args({ name: "dir", type: "string", default: "." })
			.handle((ctx) => {
				receivedDir = ctx.args.dir as string;
			});

		await app.execute({ argv: ["custom-dir"] });

		expect(receivedDir).toBe("custom-dir");
	});

	it("runs pre-run then post-run hooks around the handler", async () => {
		const order: string[] = [];
		const wrap = defineExtension("wrap", {
			hooks: {
				preRun: () => {
					order.push("pre");
				},
				postRun: () => {
					order.push("post");
				},
			},
		});
		const app = new Crust("test").extend(wrap).handle(() => {
			order.push("run");
		});

		await app.execute({ argv: [] });
		expect(order).toEqual(["pre", "run", "post"]);
	});

	it("catches errors and sets exitCode", async () => {
		const app = new Crust("test").handle(() => {
			throw new Error("execution failed");
		});

		await app.execute({ argv: [] });

		expect(process.exitCode).toBe(1);
		expect(stderrChunks.join("\n")).toContain("execution failed");
	});

	it("catches CrustError and sets exitCode", async () => {
		const app = new Crust("test").handle(() => {
			throw new CrustError("PARSE", "custom crust error");
		});

		await app.execute({ argv: [] });

		expect(process.exitCode).toBe(1);
		expect(stderrChunks.join("\n")).toContain("custom crust error");
	});

	it("treats prompt cancellation as a silent user abort", async () => {
		const app = new Crust("test").handle(() => {
			throw new DOMException("Prompt was cancelled.", "AbortError");
		});

		await app.execute({ argv: [] });

		expect(process.exitCode).toBe(130);
		expect(stderrChunks).toEqual([]);
	});

	it("handles unknown flag error", async () => {
		const app = new Crust("test").flags({ name: "verbose", type: "boolean" }).handle(() => {});

		await app.execute({ argv: ["--unknown"] });

		expect(process.exitCode).toBe(1);
		expect(stderrChunks.join("\n")).toContain("Unknown flag");
	});

	it("handles missing required flag error", async () => {
		const app = new Crust("test")
			.flags({ name: "name", type: "string", required: true })
			.handle(() => {});

		await app.execute({ argv: [] });

		expect(process.exitCode).toBe(1);
		expect(stderrChunks.join("\n")).toContain("Missing required");
	});

	it("command not found error with no run on parent", async () => {
		const app = new Crust("cli").mount(defineCommand("sub", (cmd) => cmd.handle(() => {})));

		await app.execute({ argv: ["unknown-sub"] });

		expect(process.exitCode).toBe(1);
		expect(stderrChunks.join("\n")).toContain("Unknown command");
	});

	it("no run handler is a no-op (no error)", async () => {
		const app = new Crust("test").flags({ name: "verbose", type: "boolean" });

		await app.execute({ argv: ["--verbose"] });

		// Should complete without error (exitCode stays 0)
		expect(process.exitCode).toBe(0);
	});

	it("Extension-owned flags are recognized by the parser", async () => {
		let receivedFlags: Record<string, unknown> = {};

		const version = defineExtension("version", {
			flags: { version: { type: "boolean", short: "V" } },
		});

		const app = new Crust("test").extend(version).handle((ctx) => {
			receivedFlags = ctx.flags;
		});

		await app.execute({ argv: ["--version"] });

		expect(receivedFlags.version).toBe(true);
	});

	it("Extension-owned command trees receive other Extensions' recursive flags", async () => {
		let receivedFlags: Record<string, unknown> = {};

		const helpLike = defineExtension("help-like", {
			flags: { help: { type: "boolean", inherit: true } },
		});
		const skillLike = defineExtension("inject-subcommand", {
			commands: [
				defineCommand("skill", (command) =>
					command.mount(
						defineCommand("update", (cmd) =>
							cmd.handle((runCtx) => {
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
			.handle(() => {});

		await app.execute({ argv: ["skill", "update", "--help"] });

		expect(receivedFlags.help).toBe(true);
	});

	it("deeply nested subcommand routing works", async () => {
		let handlerRan = "";

		const app = new Crust("cli").flags({ name: "verbose", type: "boolean", inherit: true }).mount(
			defineCommand("level1", (cmd) =>
				cmd.mount(
					defineCommand("level2", (cmd2) =>
						cmd2.mount(
							defineCommand("level3", (cmd3) =>
								cmd3.handle(() => {
									handlerRan = "level3";
								}),
							),
						),
					),
				),
			),
		);

		await app.execute({ argv: ["level1", "level2", "level3"] });

		expect(handlerRan).toBe("level3");
	});

	it("rawArgs are passed through", async () => {
		let receivedRawArgs: string[] = [];

		const app = new Crust("test").flags({ name: "verbose", type: "boolean" }).handle((ctx) => {
			receivedRawArgs = ctx.rawArgs;
		});

		await app.execute({ argv: ["--verbose", "--", "extra1", "extra2"] });

		expect(receivedRawArgs).toEqual(["extra1", "extra2"]);
	});

	it("pre-run receives the resolved command and parsed input", async () => {
		let preRunName = "";
		let preRunFlags: Record<string, unknown> = {};

		const inspect = defineExtension("inspect", {
			hooks: {
				preRun(ctx) {
					preRunName = ctx.command.meta.name;
					preRunFlags = { ...ctx.flags };
				},
			},
		});

		const app = new Crust("cli")
			.extend(inspect)
			.mount(
				defineCommand("sub", (cmd) =>
					cmd.flags({ name: "output", type: "string", default: "stdout" }).handle(() => {}),
				),
			);

		await app.execute({ argv: ["sub", "--output", "file.txt"] });

		expect(preRunName).toBe("sub");
		expect(preRunFlags.output).toBe("file.txt");
	});

	it("pre-run can finish execution", async () => {
		let handlerRan = false;
		const gate = defineExtension("short-circuit", {
			hooks: { preRun: (ctx) => ctx.finish() },
		});
		const app = new Crust("test").extend(gate).handle(() => {
			handlerRan = true;
		});

		await app.execute({ argv: [] });
		expect(handlerRan).toBe(false);
	});

	it("inherited flags work across file-boundary pattern", async () => {
		let receivedVerbose: boolean | undefined;
		const verbose = defineFlag("verbose", { type: "boolean", inherit: true });
		const sub = defineCommand("sub", { flags: [verbose] }, (command) =>
			command.handle(({ flags }) => {
				receivedVerbose = flags.verbose;
			}),
		);
		const app = new Crust("cli").flags(verbose).mount(sub);

		await app.execute({ argv: ["sub", "--verbose"] });

		expect(receivedVerbose).toBe(true);
	});

	it("default flag values work on subcommands", async () => {
		let receivedPort: number | undefined;
		const port = defineFlag("port", { type: "number", default: 3000, inherit: true });

		const app = new Crust("cli").flags(port).mount(
			defineCommand("sub", { flags: [port] }, (cmd) =>
				cmd.handle((ctx) => {
					receivedPort = ctx.flags.port;
				}),
			),
		);

		await app.execute({ argv: ["sub"] });

		expect(receivedPort).toBe(3000);
	});

	it("inherited flag short alias works on subcommand", async () => {
		let receivedVerbose: boolean | undefined;
		const verbose = defineFlag("verbose", { type: "boolean", short: "v", inherit: true });

		const app = new Crust("cli").flags(verbose).mount(
			defineCommand("sub", { flags: [verbose] }, (cmd) =>
				cmd.handle((ctx) => {
					receivedVerbose = ctx.flags.verbose;
				}),
			),
		);

		await app.execute({ argv: ["sub", "-v"] });

		expect(receivedVerbose).toBe(true);
	});

	it("Extension apply error is rendered and sets exitCode", async () => {
		const clash = defineExtension("clash", { flags: { verbose: { type: "boolean" } } });
		const app = new Crust("test")
			.flags({ name: "verbose", type: "boolean" })
			.extend(clash)
			.handle(() => {});

		await app.execute({ argv: [] });

		expect(process.exitCode).toBe(1);
		expect(stderrChunks.join("\n")).toContain("collides");
	});

	it("treats pre-run prompt cancellation as a silent user abort", async () => {
		const cancel = defineExtension("cancel", {
			hooks: {
				preRun: () => {
					throw new DOMException("Prompt was cancelled.", "AbortError");
				},
			},
		});

		const app = new Crust("test").extend(cancel).handle(() => {});

		await app.execute({ argv: [] });

		expect(process.exitCode).toBe(130);
		expect(stderrChunks).toEqual([]);
	});

	it("async run handler works", async () => {
		let result = "";

		const app = new Crust("test").handle(async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
			result = "done";
		});

		await app.execute({ argv: [] });

		expect(result).toBe("done");
	});

	it("handler context exposes stdout/stderr text callbacks", async () => {
		const app = new Crust("test").handle((ctx) => {
			ctx.stdout("hello out");
			ctx.stderr("hello err");
		});

		await app.execute({ argv: [] });

		expect(stdoutChunks).toContain("hello out");
		expect(stderrChunks).toContain("hello err");
	});

	it("command context contains a serializable snapshot of the resolved command", async () => {
		let receivedCommand: unknown;

		const app = new Crust("test").flags({ name: "verbose", type: "boolean" }).handle((ctx) => {
			receivedCommand = ctx.command;
		});

		await app.execute({ argv: [] });

		expect(receivedCommand).toBeDefined();
		const snapshot = receivedCommand as {
			meta: { name: string };
			hasHandler: boolean;
			flags: Record<string, unknown>;
		};
		expect(snapshot.meta.name).toBe("test");
		expect(snapshot.hasHandler).toBe(true);
		expect(Object.keys(snapshot.flags)).toContain("verbose");
		// Serializable across boundaries — no functions anywhere in the snapshot
		expect(() => structuredClone(snapshot)).not.toThrow();
	});
});

// ────────────────────────────────────────────────────────────────────────────
// .execute() — build-time validation mode
// ────────────────────────────────────────────────────────────────────────────

describe("Crust .execute() validation mode", () => {
	// `process.exit` would terminate the bun test runner if it ever fires
	// during these tests — stub it so we can observe the call instead, and
	// fail loudly if anything tries to exit when it should not.
	const originalExit = process.exit;
	let exitCalls: Array<number | undefined>;

	beforeEach(() => {
		exitCalls = [];
		// Force a clean numeric baseline. `process.exitCode = undefined` is a
		// no-op on Bun, so the validation-failure tests below would otherwise
		// leak `exitCode = 1` into sibling tests — and into the test runner's
		// own exit status, making `bun test` exit 1 even when every test passes.
		process.exitCode = 0;
		process.exit = ((code?: number) => {
			exitCalls.push(code);
			// Throw instead of exiting so the test can see the call.
			throw new Error(`process.exit(${code ?? "undefined"}) was called during validation`);
		}) as typeof process.exit;
	});

	afterEach(() => {
		process.exit = originalExit;
		process.exitCode = 0;
		delete process.env[VALIDATION_MODE_ENV];
		delete process.env[VALIDATION_FORCE_EXIT_ENV];
	});

	it("does not call process.exit when only VALIDATION_MODE_ENV is set", async () => {
		process.env[VALIDATION_MODE_ENV] = "1";
		delete process.env[VALIDATION_FORCE_EXIT_ENV];

		let handlerRan = false;
		const app = new Crust("in-process-validation").handle(() => {
			handlerRan = true;
		});

		await app.execute({ argv: [] });

		expect(exitCalls).toEqual([]);
		// Validation runs *instead of* the handler.
		expect(handlerRan).toBe(false);
		// Successful validation leaves exitCode at the baseline (0).
		expect(process.exitCode).toBe(0);
	});

	it("sets process.exitCode = 1 on validation failure without exiting in-process", async () => {
		process.env[VALIDATION_MODE_ENV] = "1";
		delete process.env[VALIDATION_FORCE_EXIT_ENV];

		// Inject a no-prefixed effective flag post-hoc — the builder rejects
		// these at compile time, but `validateCommandTree` is the runtime
		// guard and is what validation mode invokes.
		const app = new Crust("cli").handle(() => {});
		app._node.effectiveFlags["no-verbose"] = { type: "boolean" };

		await app.execute({ argv: [] });

		expect(exitCalls).toEqual([]);
		expect(process.exitCode).toBe(1);
	});

	it("force-exits when VALIDATION_FORCE_EXIT_ENV is also set (build subprocess path)", async () => {
		process.env[VALIDATION_MODE_ENV] = "1";
		process.env[VALIDATION_FORCE_EXIT_ENV] = "1";

		const app = new Crust("build-subprocess").handle(() => {});

		// Stubbed process.exit throws; the rejection confirms it fired.
		await expect(app.execute({ argv: [] })).rejects.toThrow("process.exit(0) was called");
		expect(exitCalls).toEqual([0]);
	});

	it("force-exits with code 1 on validation failure when both envs are set", async () => {
		process.env[VALIDATION_MODE_ENV] = "1";
		process.env[VALIDATION_FORCE_EXIT_ENV] = "1";

		const app = new Crust("cli").handle(() => {});
		app._node.effectiveFlags["no-verbose"] = { type: "boolean" };

		await expect(app.execute({ argv: [] })).rejects.toThrow("process.exit(1) was called");
		expect(exitCalls).toEqual([1]);
	});
});

describe("prepareCommandSnapshot (tooling)", () => {
	it("returns a frozen snapshot with Extension flags applied, without mutating the builder", async () => {
		const docs = defineExtension("doc-test", {
			flags: {
				extra: { type: "boolean", description: "Injected for docs" },
			},
		});

		const app = new Crust("cli").extend(docs).meta({ description: "Test" });

		expect(app._node.localFlags.extra).toBeUndefined();

		const root = await prepareCommandSnapshot(app);

		expect(app._node.localFlags.extra).toBeUndefined();
		expect(root.flags.extra).toMatchObject({
			type: "boolean",
			description: "Injected for docs",
		});
		expect(Object.isFrozen(root)).toBe(true);
		expect(() => structuredClone(root)).not.toThrow();
	});

	it("can be called multiple times", async () => {
		const app = new Crust("cli").handle(() => {});
		const a = await prepareCommandSnapshot(app);
		const b = await prepareCommandSnapshot(app);
		expect(a.meta.name).toBe("cli");
		expect(b.meta.name).toBe("cli");
	});
});

// ──────────────────────────────────────────────────────────────────────────────
// .mount() aliases
// ──────────────────────────────────────────────────────────────────────────────

describe("Crust .mount() aliases", () => {
	it("plumbs aliases from meta() into the registered subcommand node", () => {
		const app = new Crust("cli").mount(
			defineCommand("issue", (cmd) => cmd.meta({ aliases: ["issues", "i"] }).handle(() => {})),
		);
		expect(app._node.subCommands.issue?.meta.aliases).toEqual(["issues", "i"]);
	});

	it("registers without error when no sibling collides", () => {
		expect(() =>
			new Crust("cli")
				.mount(
					defineCommand("issue", (cmd) => cmd.meta({ aliases: ["issues", "i"] }).handle(() => {})),
				)
				.mount(defineCommand("version", (cmd) => cmd.handle(() => {}))),
		).not.toThrow();
	});

	it("throws DEFINITION when an alias collides with a sibling's canonical name", () => {
		const app = new Crust("cli").mount(defineCommand("build", (cmd) => cmd.handle(() => {})));
		expect(() =>
			app.mount(
				defineCommand("compile", (cmd) => cmd.meta({ aliases: ["build"] }).handle(() => {})),
			),
		).toThrow(/collides with sibling canonical name "build"/);
	});

	it("throws DEFINITION when an alias collides with another sibling's alias", () => {
		const app = new Crust("cli").mount(
			defineCommand("issue", (cmd) => cmd.meta({ aliases: ["i"] }).handle(() => {})),
		);
		expect(() =>
			app.mount(defineCommand("info", (cmd) => cmd.meta({ aliases: ["i"] }).handle(() => {}))),
		).toThrow(/collides with alias of sibling "issue"/);
	});

	it("throws DEFINITION on the reverse-order case (new canonical equals an existing alias)", () => {
		const app = new Crust("cli").mount(
			defineCommand("issue", (cmd) => cmd.meta({ aliases: ["i"] }).handle(() => {})),
		);
		// Now try to register a *new* command whose canonical name == existing alias.
		expect(() => app.mount(defineCommand("i", (cmd) => cmd.handle(() => {})))).toThrow(
			/canonical name "i" collides with alias of sibling "issue"/,
		);
	});

	it("throws DEFINITION on duplicate aliases within one subcommand's own list", () => {
		expect(() =>
			new Crust("cli").mount(
				defineCommand("issue", (cmd) => cmd.meta({ aliases: ["i", "i"] }).handle(() => {})),
			),
		).toThrow(/lists alias "i" more than once/);
	});

	it("throws DEFINITION on an alias equal to its own canonical name", () => {
		expect(() =>
			new Crust("cli").mount(
				defineCommand("issue", (cmd) => cmd.meta({ aliases: ["issue"] }).handle(() => {})),
			),
		).toThrow(/must not equal its own canonical name/);
	});

	it("throws DEFINITION on an empty alias", () => {
		expect(() =>
			new Crust("cli").mount(
				defineCommand("issue", (cmd) => cmd.meta({ aliases: [""] }).handle(() => {})),
			),
		).toThrow(/must be a non-empty string/);
	});

	it("throws DEFINITION on an alias containing whitespace", () => {
		expect(() =>
			new Crust("cli").mount(
				defineCommand("issue", (cmd) => cmd.meta({ aliases: ["my issue"] }).handle(() => {})),
			),
		).toThrow(/must not contain whitespace/);
	});

	it("throws DEFINITION on an alias starting with '-'", () => {
		expect(() =>
			new Crust("cli").mount(
				defineCommand("issue", (cmd) => cmd.meta({ aliases: ["-i"] }).handle(() => {})),
			),
		).toThrow(/must not start with "-"/);
	});

	it("applies the same checks on the .mount() path", () => {
		const issue = defineCommand("issue", (command) =>
			command.meta({ aliases: ["i"] }).handle(() => {}),
		);
		const conflicting = defineCommand("info", (command) =>
			command.meta({ aliases: ["i"] }).handle(() => {}),
		);
		const app = new Crust("cli").mount(issue);

		expect(() => app.mount(conflicting)).toThrow(/collides with alias of sibling "issue"/);
	});

	it("Extension command with a colliding alias is a DEFINITION error (no silent shadowing)", async () => {
		// Without this guard, an Extension could attach an alias that silently
		// changes routing for an existing user command.
		const rogue = defineExtension("rogue", {
			commands: [
				defineCommand("info", (command) => command.meta({ aliases: ["i"] }).handle(() => {})),
			],
		});

		const app = new Crust("cli")
			.extend(rogue)
			.mount(defineCommand("issue", (cmd) => cmd.meta({ aliases: ["i"] }).handle(() => {})));

		await expect(app.run(["i"])).rejects.toMatchObject({ code: "DEFINITION" });
	});
});
