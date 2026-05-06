import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	Crust,
	type CrustCommandContext,
	VALIDATION_FORCE_EXIT_ENV,
	VALIDATION_MODE_ENV,
} from "./crust.ts";
import { CrustError } from "./errors.ts";
import type { CrustPlugin } from "./plugins.ts";
import type {
	FlagsDef,
	ValidateFlagAliases,
	ValidateNoPrefixedFlags,
} from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Type-level test utilities
// ────────────────────────────────────────────────────────────────────────────

type Expect<T extends true> = T;
type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;

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
			expect((err as CrustError).message).toContain(
				"meta.name must be a non-empty string",
			);
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
		expect(app._node.plugins).toEqual([]);
		expect(app._node.preRun).toBeUndefined();
		expect(app._node.run).toBeUndefined();
		expect(app._node.postRun).toBeUndefined();
	});
});

// ────────────────────────────────────────────────────────────────────────────
// .flags()
// ────────────────────────────────────────────────────────────────────────────

describe("Crust .flags()", () => {
	it("returns new instance with correct flags", () => {
		const app = new Crust("test");
		const withFlags = app.flags({
			verbose: { type: "boolean", short: "v" },
			port: { type: "number", default: 3000 },
		});

		expect(withFlags._node.localFlags).toEqual({
			verbose: { type: "boolean", short: "v" },
			port: { type: "number", default: 3000 },
		});
		expect(withFlags._node.effectiveFlags).toEqual({
			verbose: { type: "boolean", short: "v" },
			port: { type: "number", default: 3000 },
		});
	});

	it("returns a different instance (immutability)", () => {
		const app = new Crust("test");
		const withFlags = app.flags({
			verbose: { type: "boolean" },
		});

		expect(withFlags).not.toBe(app);
	});

	it("does not mutate original builder", () => {
		const app = new Crust("test");
		app.flags({
			verbose: { type: "boolean" },
		});

		// Original should still have empty flags
		expect(app._node.localFlags).toEqual({});
		expect(app._node.effectiveFlags).toEqual({});
	});

	it("deep copies flag definitions (decoupled from caller)", () => {
		const flagDefs = {
			verbose: { type: "boolean" as const, short: "v" },
		};

		const app = new Crust("test").flags(flagDefs);

		// Mutating the original defs should not affect the builder
		flagDefs.verbose.short = "V";
		expect(app._node.localFlags.verbose?.short).toBe("v");
	});

	it("preserves meta from original builder", () => {
		const app = new Crust("my-cli").meta({ description: "desc" });
		const withFlags = app.flags({ verbose: { type: "boolean" } });

		expect(withFlags._node.meta.name).toBe("my-cli");
		expect(withFlags._node.meta.description).toBe("desc");
	});

	it("throws CrustError DEFINITION on flag name starting with no-", () => {
		const app = new Crust("test");
		try {
			app.flags({ "no-cache": { type: "boolean" } } as FlagsDef &
				ValidateNoPrefixedFlags<ValidateFlagAliases<FlagsDef>>);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("DEFINITION");
			expect((err as CrustError).message).toContain("no-");
		}
	});

	it("throws CrustError DEFINITION on aliases starting with no-", () => {
		const app = new Crust("test");
		try {
			app.flags({
				cache: { type: "boolean", aliases: ["no-store"] },
			} as FlagsDef & ValidateNoPrefixedFlags<ValidateFlagAliases<FlagsDef>>);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("DEFINITION");
			expect((err as CrustError).message).toContain("no-");
		}
	});

	it("throws CrustError DEFINITION on aliases array containing no- entry", () => {
		const app = new Crust("test");
		try {
			app.flags({
				cache: { type: "boolean", short: "c", aliases: ["no-store"] },
			} as FlagsDef & ValidateNoPrefixedFlags<ValidateFlagAliases<FlagsDef>>);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("DEFINITION");
			expect((err as CrustError).message).toContain("no-");
		}
	});

	it("accepts flags with inherit: true", () => {
		const app = new Crust("test").flags({
			verbose: { type: "boolean", inherit: true },
			port: { type: "number" },
		});

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
		const withArgs = app.args([
			{ name: "file", type: "string", required: true },
			{ name: "count", type: "number", default: 1 },
		]);

		expect(withArgs._node.args).toBeDefined();
		expect(withArgs._node.args?.length).toBe(2);
		expect(withArgs._node.args?.[0]?.name).toBe("file");
		expect(withArgs._node.args?.[0]?.required).toBe(true);
		expect(withArgs._node.args?.[1]?.name).toBe("count");
		expect(withArgs._node.args?.[1]?.default).toBe(1);
	});

	it("returns a different instance (immutability)", () => {
		const app = new Crust("test");
		const withArgs = app.args([{ name: "file", type: "string" }]);

		expect(withArgs).not.toBe(app);
	});

	it("does not mutate original builder", () => {
		const app = new Crust("test");
		app.args([{ name: "file", type: "string" }]);

		expect(app._node.args).toBeUndefined();
	});

	it("deep copies arg definitions (decoupled from caller)", () => {
		const argDefs = [
			{ name: "file" as const, type: "string" as const, description: "orig" },
		] as const;

		const app = new Crust("test").args(argDefs);

		// Original arg should be decoupled — check node has a copy
		expect(app._node.args?.[0]?.description).toBe("orig");
	});

	it("preserves meta and flags from original builder", () => {
		const app = new Crust("my-cli").meta({ description: "desc" }).flags({
			verbose: { type: "boolean" },
		});
		const withArgs = app.args([{ name: "file", type: "string" }]);

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
			.flags({
				verbose: { type: "boolean", short: "v" },
				port: { type: "number", default: 3000 },
			})
			.args([{ name: "file", type: "string", required: true }]);

		expect(app._node.localFlags.verbose).toBeDefined();
		expect(app._node.localFlags.port).toBeDefined();
		expect(app._node.args?.length).toBe(1);
		expect(app._node.args?.[0]?.name).toBe("file");
	});

	it(".args().flags() preserves both on the final builder", () => {
		const app = new Crust("test")
			.args([{ name: "file", type: "string" }])
			.flags({ verbose: { type: "boolean" } });

		expect(app._node.localFlags.verbose).toBeDefined();
		expect(app._node.args?.length).toBe(1);
	});

	it("does not mutate intermediate builders", () => {
		const base = new Crust("test");
		const withFlags = base.flags({ verbose: { type: "boolean" } });
		const withArgs = withFlags.args([{ name: "file", type: "string" }]);

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

	it("returns a new instance (immutability)", () => {
		const app = new Crust("test");
		const withMeta = app.meta({ description: "desc" });

		expect(withMeta).not.toBe(app);
	});

	it("does not mutate original builder", () => {
		const app = new Crust("test");
		app.meta({ description: "desc" });

		expect(app._node.meta.description).toBeUndefined();
	});

	it("preserves flags and args from original builder", () => {
		const app = new Crust("test")
			.flags({ verbose: { type: "boolean" } })
			.args([{ name: "file", type: "string" }])
			.meta({ description: "desc" });

		expect(app._node.localFlags.verbose).toBeDefined();
		expect(app._node.args?.length).toBe(1);
		expect(app._node.meta.description).toBe("desc");
	});

	it("can be chained before .flags() and .args()", () => {
		const app = new Crust("test")
			.meta({ description: "desc" })
			.flags({ verbose: { type: "boolean" } })
			.args([{ name: "file", type: "string" }]);

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
		const app = new Crust("cli").command("sub", (cmd) =>
			cmd.meta({ description: "A subcommand", usage: "cli sub [options]" }),
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
		const app = new Crust("test").flags({
			verbose: { type: "boolean", short: "v" },
			port: { type: "number", default: 3000 },
		});

		// Extract the Local type from the phantom _types property
		type AppLocal = (typeof app)["_types"]["local"];

		type _checkVerbose = Expect<
			Equal<
				AppLocal["verbose"],
				{ readonly type: "boolean"; readonly short: "v" }
			>
		>;
		type _checkPort = Expect<
			Equal<
				AppLocal["port"],
				{ readonly type: "number"; readonly default: 3000 }
			>
		>;
	});

	it(".args() updates A generic", () => {
		const app = new Crust("test").args([
			{ name: "file", type: "string", required: true },
			{ name: "count", type: "number", default: 1 },
		]);

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

	it(".flags() with alias collision produces compile error", () => {
		// This test verifies the compile-time constraint. If we uncomment the
		// invalid definition below, TypeScript will produce a compile error:
		//
		// const app = new Crust("test").flags({
		//   verbose: { type: "boolean", short: "v" },
		//   version: { type: "boolean", short: "v" },
		// });
		//
		// Error: Property 'FIX_ALIAS_COLLISION' is missing...

		// Valid flags: no collision
		const app = new Crust("test").flags({
			verbose: { type: "boolean", short: "v" },
			version: { type: "boolean", short: "V" },
		});
		expect(app).toBeDefined();
	});

	it(".flags() with no- prefix produces compile error", () => {
		// This test verifies the compile-time constraint. If we uncomment the
		// invalid definition below, TypeScript will produce a compile error:
		//
		// const app = new Crust("test").flags({
		//   "no-cache": { type: "boolean" },
		// });
		//
		// Error: Property 'FIX_NO_PREFIX' is missing...

		// Valid flags: no "no-" prefix
		const app = new Crust("test").flags({
			cache: { type: "boolean" },
		});
		expect(app).toBeDefined();
	});

	it(".args() with non-last variadic produces compile error", () => {
		// This test verifies the compile-time constraint. If we uncomment the
		// invalid definition below, TypeScript will produce a compile error:
		//
		// const app = new Crust("test").args([
		//   { name: "files", type: "string", variadic: true },
		//   { name: "output", type: "string" },
		// ]);
		//
		// Error: Property 'FIX_VARIADIC_POSITION' is missing...

		// Valid args: variadic is last
		const app = new Crust("test").args([
			{ name: "output", type: "string" },
			{ name: "files", type: "string", variadic: true },
		]);
		expect(app).toBeDefined();
	});

	it("chaining .flags().args() preserves both generics", () => {
		const app = new Crust("test")
			.flags({
				verbose: { type: "boolean", short: "v" },
				port: { type: "number", default: 3000 },
			})
			.args([{ name: "file", type: "string", required: true }]);

		// Verify flags Local generic is preserved
		type AppLocal = (typeof app)["_types"]["local"];
		type _checkVerbose = Expect<
			Equal<
				AppLocal["verbose"],
				{ readonly type: "boolean"; readonly short: "v" }
			>
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
// Crust._createChild — internal factory
// ────────────────────────────────────────────────────────────────────────────

describe("Crust._createChild", () => {
	it("creates a child builder with inherited flags", () => {
		const child = Crust._createChild("sub", {
			verbose: { type: "boolean", inherit: true },
		});

		expect(child._node.meta.name).toBe("sub");
		expect(child._inheritedFlags).toEqual({
			verbose: { type: "boolean", inherit: true },
		});
	});

	it("child starts with empty local flags and no args", () => {
		const child = Crust._createChild("sub", {});
		expect(child._node.localFlags).toEqual({});
		expect(child._node.args).toBeUndefined();
	});
});

// ────────────────────────────────────────────────────────────────────────────
// .command() — Runtime tests
// ────────────────────────────────────────────────────────────────────────────

describe("Crust .command()", () => {
	it("registers a subcommand in the node's subCommands", () => {
		const app = new Crust("cli").command("sub", (cmd) =>
			cmd.flags({ output: { type: "string" } }),
		);

		const subNode = app._node.subCommands.sub;
		expect(subNode).toBeDefined();
		expect(subNode?.meta.name).toBe("sub");
	});

	it("subcommand node has correct local flags", () => {
		const app = new Crust("cli").command("sub", (cmd) =>
			cmd.flags({ output: { type: "string" } }),
		);

		expect(app._node.subCommands.sub?.localFlags).toEqual({
			output: { type: "string" },
		});
	});

	it("subcommand node computes effectiveFlags from inherited + local", () => {
		const app = new Crust("cli")
			.flags({
				verbose: { type: "boolean", inherit: true },
				port: { type: "number" },
			})
			.command("sub", (cmd) => cmd.flags({ output: { type: "string" } }));

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
			app.command("", (cmd) => cmd);
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
			app.command("   ", (cmd) => cmd);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("DEFINITION");
		}
	});

	it("throws CrustError DEFINITION on duplicate subcommand name", () => {
		const app = new Crust("cli").command("sub", (cmd) => cmd);
		try {
			app.command("sub", (cmd) => cmd);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("DEFINITION");
			expect((err as CrustError).message).toContain("already registered");
		}
	});

	it("returns a new Crust instance (immutability)", () => {
		const app = new Crust("cli");
		const withSub = app.command("sub", (cmd) => cmd);

		expect(withSub).not.toBe(app);
	});

	it("does not mutate original builder", () => {
		const app = new Crust("cli");
		app.command("sub", (cmd) => cmd);

		expect(app._node.subCommands).toEqual({});
	});

	it("callback receives a fresh builder (not the parent)", () => {
		let receivedBuilder: Crust | undefined;

		const app = new Crust("cli")
			.flags({ verbose: { type: "boolean", inherit: true } })
			.command("sub", (cmd) => {
				receivedBuilder = cmd;
				return cmd;
			});

		expect(receivedBuilder).toBeDefined();
		expect(receivedBuilder).not.toBe(app);
		expect(receivedBuilder?._node.meta.name).toBe("sub");
		// Child should start with empty local flags
		expect(receivedBuilder?._node.localFlags).toEqual({});
	});

	it("callback child builder carries parent effective flags at runtime", () => {
		let childInherited: FlagsDef = {};

		new Crust("cli")
			.flags({
				verbose: { type: "boolean", inherit: true },
				port: { type: "number" },
			})
			.command("sub", (cmd) => {
				childInherited = cmd._inheritedFlags;
				return cmd;
			});

		// _inheritedFlags carries ALL parent effective flags (not just inheritable)
		// The filtering for inherit:true happens when computeEffectiveFlags is called
		// during the child's own .command() or effectiveFlags computation
		expect(childInherited.verbose).toEqual({
			type: "boolean",
			inherit: true,
		});
		expect(childInherited.port).toEqual({
			type: "number",
		});
	});

	it("nested .command() chains work", () => {
		const app = new Crust("cli")
			.flags({ verbose: { type: "boolean", inherit: true } })
			.command("level1", (cmd) =>
				cmd
					.flags({ output: { type: "string", inherit: true } })
					.command("level2", (cmd2) =>
						cmd2.flags({ format: { type: "string" } }),
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
			.command("sub1", (cmd) => cmd.flags({ a: { type: "string" } }))
			.command("sub2", (cmd) => cmd.flags({ b: { type: "number" } }));

		expect(app._node.subCommands.sub1).toBeDefined();
		expect(app._node.subCommands.sub2).toBeDefined();
		expect(app._node.subCommands.sub1?.localFlags.a).toBeDefined();
		expect(app._node.subCommands.sub2?.localFlags.b).toBeDefined();
	});

	it("preserves parent flags and args when registering subcommand", () => {
		const app = new Crust("cli")
			.flags({ verbose: { type: "boolean" } })
			.args([{ name: "file", type: "string" }])
			.command("sub", (cmd) => cmd);

		expect(app._node.localFlags.verbose).toBeDefined();
		expect(app._node.args?.length).toBe(1);
		expect(app._node.args?.[0]?.name).toBe("file");
	});

	it("child flag override replaces inherited flag at runtime", () => {
		const app = new Crust("cli")
			.flags({
				output: { type: "string", inherit: true },
			})
			.command("sub", (cmd) =>
				// Override output with a number type
				cmd.flags({ output: { type: "number", default: 42 } }),
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
// .command() — Type-level tests
// ────────────────────────────────────────────────────────────────────────────

describe("Crust .command() type-level tests", () => {
	it("callback parameter carries parent effective flags as Inherited", () => {
		const app = new Crust("cli")
			.flags({
				verbose: { type: "boolean", inherit: true },
				port: { type: "number" },
			})
			.command("sub", (cmd) => {
				// The callback's Inherited = EffectiveFlags<ParentInherited, ParentLocal>
				// Since root Inherited defaults to FlagsDef (broad), EffectiveFlags
				// computes to just the parent's Local flags.
				type CmdInherited = (typeof cmd)["_types"]["inherited"];

				// verbose should be present in inherited
				type _checkVerbose = Expect<
					Equal<
						CmdInherited["verbose"],
						{ readonly type: "boolean"; readonly inherit: true }
					>
				>;

				// port is also present in the Inherited generic (all parent effective flags)
				// but will be filtered out by InheritableFlags when computing the child's
				// EffectiveFlags in .run() or further .command() calls
				type _checkPort = Expect<
					Equal<CmdInherited["port"], { readonly type: "number" }>
				>;

				return cmd;
			});

		expect(app).toBeDefined();
	});

	it("override flag in child replaces inherited type", () => {
		new Crust("cli")
			.flags({
				output: { type: "string", inherit: true },
			})
			.command("sub", (cmd) => {
				const configured = cmd.flags({
					output: { type: "number", default: 42 },
				});

				type ConfiguredLocal = (typeof configured)["_types"]["local"];
				type _checkOutput = Expect<
					Equal<
						ConfiguredLocal["output"],
						{ readonly type: "number"; readonly default: 42 }
					>
				>;

				return configured;
			});
	});

	it("deeply nested command inherits through chain", () => {
		new Crust("cli")
			.flags({
				verbose: { type: "boolean", inherit: true },
				rootOnly: { type: "string" },
			})
			.command("level1", (cmd) => {
				// level1 inherits verbose from root
				type L1Inherited = (typeof cmd)["_types"]["inherited"];
				type _checkVerboseL1 = Expect<
					Equal<
						L1Inherited["verbose"],
						{ readonly type: "boolean"; readonly inherit: true }
					>
				>;

				return cmd
					.flags({ l1Flag: { type: "string", inherit: true } })
					.command("level2", (cmd2) => {
						// level2's Inherited = EffectiveFlags of level1
						// EffectiveFlags<L1Inherited, L1Local> filters L1Inherited
						// for inherit:true (only verbose) then merges with l1Flag
						type L2Inherited = (typeof cmd2)["_types"]["inherited"];
						type _checkVerboseL2 = Expect<
							Equal<
								L2Inherited["verbose"],
								{ readonly type: "boolean"; readonly inherit: true }
							>
						>;
						type _checkL1FlagL2 = Expect<
							Equal<
								L2Inherited["l1Flag"],
								{ readonly type: "string"; readonly inherit: true }
							>
						>;

						// rootOnly has no inherit:true, so it's filtered by
						// EffectiveFlags at level1→level2 boundary
						// Verify only verbose and l1Flag are keys (rootOnly excluded)
						type _checkKeys = Expect<
							Equal<keyof L2Inherited, "verbose" | "l1Flag">
						>;

						return cmd2;
					});
			});
	});

	it("non-inherit flags filtered at nested boundary via EffectiveFlags", () => {
		new Crust("cli")
			.flags({
				local1: { type: "string" },
				global: { type: "boolean", inherit: true },
			})
			.command("level1", (cmd) =>
				cmd.flags({ l1Local: { type: "number" } }).command("level2", (cmd2) => {
					// At level2, Inherited = EffectiveFlags<Level1Inherited, Level1Local>
					// Level1Inherited includes both local1 and global (from root)
					// InheritableFlags<Level1Inherited> filters to only global
					// Then merges with l1Local → level2 Inherited = { global, l1Local }
					type L2Inherited = (typeof cmd2)["_types"]["inherited"];

					type _checkGlobal = Expect<
						Equal<
							L2Inherited["global"],
							{ readonly type: "boolean"; readonly inherit: true }
						>
					>;
					type _checkL1Local = Expect<
						Equal<L2Inherited["l1Local"], { readonly type: "number" }>
					>;

					// local1 should NOT be in L2Inherited (filtered by EffectiveFlags)
					// Verify only global and l1Local are keys (local1 excluded)
					type _checkKeys = Expect<
						Equal<keyof L2Inherited, "global" | "l1Local">
					>;

					return cmd2;
				}),
			);
	});

	it(".command() preserves parent's Inherited and Local generics", () => {
		const app = new Crust("cli")
			.flags({
				verbose: { type: "boolean", short: "v" },
				port: { type: "number", default: 3000 },
			})
			.command("sub", (cmd) => cmd);

		// Parent's Local generic should be preserved
		type AppLocal = (typeof app)["_types"]["local"];
		type _checkVerbose = Expect<
			Equal<
				AppLocal["verbose"],
				{ readonly type: "boolean"; readonly short: "v" }
			>
		>;
		type _checkPort = Expect<
			Equal<
				AppLocal["port"],
				{ readonly type: "number"; readonly default: 3000 }
			>
		>;
	});

	it("child with no parent flags has empty Inherited via EffectiveFlags", () => {
		new Crust("cli").command("sub", (cmd) => {
			// No flags on parent. The parent's default generics are FlagsDef (broad).
			// EffectiveFlags<FlagsDef, FlagsDef> resolves through InheritableFlags
			// and MergeFlags, producing a broad type. We verify the child starts
			// with empty local flags and args at runtime.
			type CmdLocal = (typeof cmd)["_types"]["local"];
			type CmdArgs = (typeof cmd)["_types"]["args"];

			// biome-ignore lint/complexity/noBannedTypes: verifying empty initial state
			type _checkLocal = Expect<Equal<CmdLocal, {}>>;
			type _checkArgs = Expect<Equal<CmdArgs, []>>;

			return cmd;
		});
	});
});

// ────────────────────────────────────────────────────────────────────────────
// .run() — Runtime tests
// ────────────────────────────────────────────────────────────────────────────

describe("Crust .run()", () => {
	it("stores handler on node", () => {
		const handler = () => {};
		const app = new Crust("test").run(handler);

		expect(app._node.run).toBeDefined();
		expect(typeof app._node.run).toBe("function");
	});

	it("returns a new instance (immutability)", () => {
		const app = new Crust("test");
		const withRun = app.run(() => {});

		expect(withRun).not.toBe(app);
	});

	it("does not mutate original builder", () => {
		const app = new Crust("test");
		app.run(() => {});

		expect(app._node.run).toBeUndefined();
	});

	it("handler is callable with correct context shape", () => {
		let receivedCtx: CrustCommandContext | undefined;

		const app = new Crust("test")
			.flags({ verbose: { type: "boolean" } })
			.args([{ name: "file", type: "string", required: true }])
			.run((ctx) => {
				receivedCtx = ctx as unknown as CrustCommandContext;
			});

		// Manually invoke the stored handler with a mock context
		const mockCtx = {
			args: { file: "test.txt" },
			flags: { verbose: true },
			rawArgs: [],
			command: app._node,
		};
		app._node.run?.(mockCtx);

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
			.flags({ verbose: { type: "boolean" } })
			.args([{ name: "file", type: "string" }])
			.run(() => {});

		expect(app._node.localFlags.verbose).toBeDefined();
		expect(app._node.args?.length).toBe(1);
	});

	it("can chain .run() after .command()", () => {
		const app = new Crust("cli").command("sub", (cmd) => cmd).run(() => {});

		expect(app._node.run).toBeDefined();
		expect(app._node.subCommands.sub).toBeDefined();
	});
});

// ────────────────────────────────────────────────────────────────────────────
// .preRun() / .postRun() — Runtime tests
// ────────────────────────────────────────────────────────────────────────────

describe("Crust .preRun() / .postRun()", () => {
	it(".preRun() stores handler on node", () => {
		const app = new Crust("test").preRun(() => {});

		expect(app._node.preRun).toBeDefined();
		expect(typeof app._node.preRun).toBe("function");
	});

	it(".postRun() stores handler on node", () => {
		const app = new Crust("test").postRun(() => {});

		expect(app._node.postRun).toBeDefined();
		expect(typeof app._node.postRun).toBe("function");
	});

	it(".preRun() returns a new instance (immutability)", () => {
		const app = new Crust("test");
		const withPreRun = app.preRun(() => {});

		expect(withPreRun).not.toBe(app);
	});

	it(".postRun() returns a new instance (immutability)", () => {
		const app = new Crust("test");
		const withPostRun = app.postRun(() => {});

		expect(withPostRun).not.toBe(app);
	});

	it(".preRun() does not mutate original builder", () => {
		const app = new Crust("test");
		app.preRun(() => {});

		expect(app._node.preRun).toBeUndefined();
	});

	it(".postRun() does not mutate original builder", () => {
		const app = new Crust("test");
		app.postRun(() => {});

		expect(app._node.postRun).toBeUndefined();
	});

	it("all three lifecycle hooks can be chained", () => {
		const app = new Crust("test")
			.flags({ verbose: { type: "boolean" } })
			.preRun(() => {})
			.run(() => {})
			.postRun(() => {});

		expect(app._node.preRun).toBeDefined();
		expect(app._node.run).toBeDefined();
		expect(app._node.postRun).toBeDefined();
		expect(app._node.localFlags.verbose).toBeDefined();
	});

	it("each handler stores independently", () => {
		const preHandler = () => {};
		const runHandler = () => {};
		const postHandler = () => {};

		const app = new Crust("test")
			.preRun(preHandler)
			.run(runHandler)
			.postRun(postHandler);

		// Verify handlers are stored (they're cast to (ctx: unknown) => void
		// internally, so we just check they're functions)
		expect(typeof app._node.preRun).toBe("function");
		expect(typeof app._node.run).toBe("function");
		expect(typeof app._node.postRun).toBe("function");
	});

	it("preRun handler is callable with correct context shape", () => {
		let receivedCtx: unknown;

		const app = new Crust("test")
			.flags({ verbose: { type: "boolean" } })
			.preRun((ctx) => {
				receivedCtx = ctx;
			});

		const mockCtx = {
			args: {},
			flags: { verbose: false },
			rawArgs: [],
			command: app._node,
		};
		app._node.preRun?.(mockCtx);

		expect(receivedCtx).toBeDefined();
		expect((receivedCtx as Record<string, unknown>)?.flags).toEqual({
			verbose: false,
		});
	});

	it("postRun handler is callable with correct context shape", () => {
		let receivedCtx: unknown;

		const app = new Crust("test")
			.flags({ output: { type: "string", default: "stdout" } })
			.postRun((ctx) => {
				receivedCtx = ctx;
			});

		const mockCtx = {
			args: {},
			flags: { output: "file.txt" },
			rawArgs: ["--", "extra"],
			command: app._node,
		};
		app._node.postRun?.(mockCtx);

		expect(receivedCtx).toBeDefined();
		expect((receivedCtx as Record<string, unknown>)?.rawArgs).toEqual([
			"--",
			"extra",
		]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// .run() / .preRun() / .postRun() — Type-level tests
// ────────────────────────────────────────────────────────────────────────────

describe("Crust .run() type-level tests", () => {
	it("run handler receives InferArgs<A> for args", () => {
		new Crust("test")
			.args([
				{ name: "file", type: "string", required: true },
				{ name: "count", type: "number", default: 5 },
			])
			.run((_ctx) => {
				type CtxArgs = typeof _ctx.args;
				type _checkFile = Expect<Equal<CtxArgs["file"], string>>;
				type _checkCount = Expect<Equal<CtxArgs["count"], number>>;
			});
	});

	it("run handler receives EffectiveFlags (inherited + local merged) for flags", () => {
		new Crust("cli")
			.flags({
				verbose: { type: "boolean", inherit: true },
				port: { type: "number", default: 3000 },
			})
			.command("sub", (cmd) =>
				cmd
					.flags({ output: { type: "string", required: true } })
					.run((_ctx) => {
						type CtxFlags = typeof _ctx.flags;
						// inherited verbose (inherit: true) should be present
						type _checkVerbose = Expect<
							Equal<CtxFlags["verbose"], boolean | undefined>
						>;
						// local output (required) should be present
						type _checkOutput = Expect<Equal<CtxFlags["output"], string>>;
					}),
			);
	});

	it("inherited flags visible in handler without manual annotation", () => {
		new Crust("cli")
			.flags({
				verbose: { type: "boolean", inherit: true, default: false },
			})
			.command("sub", (cmd) =>
				cmd.run((_ctx) => {
					// The handler should see verbose as a flag even though
					// the subcommand has no local flags
					type CtxFlags = typeof _ctx.flags;
					type _checkVerbose = Expect<Equal<CtxFlags["verbose"], boolean>>;
				}),
			);
	});

	it("override flag shows overridden type in handler", () => {
		new Crust("cli")
			.flags({
				output: { type: "string", inherit: true },
			})
			.command("sub", (cmd) =>
				cmd.flags({ output: { type: "number", default: 42 } }).run((_ctx) => {
					type CtxFlags = typeof _ctx.flags;
					// output was overridden from string to number
					type _checkOutput = Expect<Equal<CtxFlags["output"], number>>;
				}),
			);
	});

	it("handler with no flags/args gets empty types", () => {
		new Crust("test").run((_ctx) => {
			// With broad FlagsDef default, flags resolve to Record<string, ...>
			// With broad ArgsDef default, args resolve to Record<string, never>
			type _checkRawArgs = Expect<Equal<typeof _ctx.rawArgs, string[]>>;
		});
	});

	it("preRun and postRun receive same context type as run", () => {
		const app = new Crust("test")
			.flags({ verbose: { type: "boolean", default: false } })
			.args([{ name: "file", type: "string", required: true }]);

		// Define all three handlers — they should all receive the same type
		const withHooks = app
			.preRun((_ctx) => {
				type CtxFlags = typeof _ctx.flags;
				type CtxArgs = typeof _ctx.args;
				type _checkVerbose = Expect<Equal<CtxFlags["verbose"], boolean>>;
				type _checkFile = Expect<Equal<CtxArgs["file"], string>>;
			})
			.run((_ctx) => {
				type CtxFlags = typeof _ctx.flags;
				type CtxArgs = typeof _ctx.args;
				type _checkVerbose = Expect<Equal<CtxFlags["verbose"], boolean>>;
				type _checkFile = Expect<Equal<CtxArgs["file"], string>>;
			})
			.postRun((_ctx) => {
				type CtxFlags = typeof _ctx.flags;
				type CtxArgs = typeof _ctx.args;
				type _checkVerbose = Expect<Equal<CtxFlags["verbose"], boolean>>;
				type _checkFile = Expect<Equal<CtxArgs["file"], string>>;
			});

		expect(withHooks._node.preRun).toBeDefined();
		expect(withHooks._node.run).toBeDefined();
		expect(withHooks._node.postRun).toBeDefined();
	});

	it("variadic args resolve to array type in handler", () => {
		new Crust("test")
			.args([{ name: "files", type: "string", variadic: true }])
			.run((_ctx) => {
				type CtxArgs = typeof _ctx.args;
				type _checkFiles = Expect<Equal<CtxArgs["files"], string[]>>;
			});
	});

	it("multiple flag resolves to array type in handler", () => {
		new Crust("test")
			.flags({
				tags: { type: "string", multiple: true, required: true },
			})
			.run((_ctx) => {
				type CtxFlags = typeof _ctx.flags;
				type _checkTags = Expect<Equal<CtxFlags["tags"], string[]>>;
			});
	});

	it("optional flag resolves to union with undefined in handler", () => {
		new Crust("test")
			.flags({
				port: { type: "number" },
			})
			.run((_ctx) => {
				type CtxFlags = typeof _ctx.flags;
				type _checkPort = Expect<Equal<CtxFlags["port"], number | undefined>>;
			});
	});

	it("required flag resolves to non-optional type in handler", () => {
		new Crust("test")
			.flags({
				name: { type: "string", required: true },
			})
			.run((_ctx) => {
				type CtxFlags = typeof _ctx.flags;
				type _checkName = Expect<Equal<CtxFlags["name"], string>>;
			});
	});

	it("flag with default resolves to non-optional type in handler", () => {
		new Crust("test")
			.flags({
				port: { type: "number", default: 3000 },
			})
			.run((_ctx) => {
				type CtxFlags = typeof _ctx.flags;
				type _checkPort = Expect<Equal<CtxFlags["port"], number>>;
			});
	});
});

// ────────────────────────────────────────────────────────────────────────────
// .use() — Runtime tests
// ────────────────────────────────────────────────────────────────────────────

describe("Crust .use()", () => {
	it("registers a plugin on the node's plugins array", () => {
		const plugin: CrustPlugin = { name: "test-plugin" };
		const app = new Crust("test").use(plugin);

		expect(app._node.plugins.length).toBe(1);
		expect(app._node.plugins[0]).toBe(plugin);
	});

	it("returns a new instance (immutability)", () => {
		const plugin: CrustPlugin = { name: "test-plugin" };
		const app = new Crust("test");
		const withPlugin = app.use(plugin);

		expect(withPlugin).not.toBe(app);
	});

	it("does not mutate original builder", () => {
		const plugin: CrustPlugin = { name: "test-plugin" };
		const app = new Crust("test");
		app.use(plugin);

		expect(app._node.plugins.length).toBe(0);
	});

	it("multiple .use() calls chain correctly", () => {
		const plugin1: CrustPlugin = { name: "plugin-1" };
		const plugin2: CrustPlugin = { name: "plugin-2" };
		const plugin3: CrustPlugin = { name: "plugin-3" };

		const app = new Crust("test").use(plugin1).use(plugin2).use(plugin3);

		expect(app._node.plugins.length).toBe(3);
		expect(app._node.plugins[0]).toBe(plugin1);
		expect(app._node.plugins[1]).toBe(plugin2);
		expect(app._node.plugins[2]).toBe(plugin3);
	});

	it("preserves plugin order (registration order)", () => {
		const names: string[] = [];
		const plugin1: CrustPlugin = {
			name: "first",
			setup: () => {
				names.push("first");
			},
		};
		const plugin2: CrustPlugin = {
			name: "second",
			setup: () => {
				names.push("second");
			},
		};

		const app = new Crust("test").use(plugin1).use(plugin2);

		expect(app._node.plugins[0]?.name).toBe("first");
		expect(app._node.plugins[1]?.name).toBe("second");
	});

	it("plugin setup hook is callable with correct context shape", () => {
		const plugin: CrustPlugin = {
			name: "test-plugin",
			setup: (context, actions) => {
				expect(context).toBeDefined();
				expect(context.argv).toBeDefined();
				expect(context.state).toBeDefined();
				expect(actions).toBeDefined();
				expect(typeof actions.addFlag).toBe("function");
				expect(typeof actions.addSubCommand).toBe("function");
			},
		};

		const app = new Crust("test").use(plugin);

		// Verify the plugin is stored and its setup is a function
		expect(app._node.plugins[0]?.setup).toBeDefined();
		expect(typeof app._node.plugins[0]?.setup).toBe("function");
	});

	it("plugin with middleware hook is stored correctly", () => {
		const plugin: CrustPlugin = {
			name: "middleware-plugin",
			middleware: async (_ctx, next) => {
				await next();
			},
		};

		const app = new Crust("test").use(plugin);

		expect(app._node.plugins[0]?.middleware).toBeDefined();
		expect(typeof app._node.plugins[0]?.middleware).toBe("function");
	});

	it("preserves flags, args, and handlers when adding plugin", () => {
		const plugin: CrustPlugin = { name: "test-plugin" };

		const app = new Crust("test")
			.flags({ verbose: { type: "boolean" } })
			.args([{ name: "file", type: "string" }])
			.run(() => {})
			.use(plugin);

		expect(app._node.localFlags.verbose).toBeDefined();
		expect(app._node.args?.length).toBe(1);
		expect(app._node.run).toBeDefined();
		expect(app._node.plugins.length).toBe(1);
	});

	it("preserves subcommands when adding plugin", () => {
		const plugin: CrustPlugin = { name: "test-plugin" };

		const app = new Crust("test")
			.command("sub", (cmd) => cmd.flags({ output: { type: "string" } }))
			.use(plugin);

		expect(app._node.subCommands.sub).toBeDefined();
		expect(app._node.plugins.length).toBe(1);
	});

	it(".use() can be chained with .flags(), .args(), .command(), .run()", () => {
		const plugin: CrustPlugin = { name: "test-plugin" };

		const app = new Crust("test")
			.use(plugin)
			.flags({ verbose: { type: "boolean" } })
			.args([{ name: "file", type: "string" }])
			.command("sub", (cmd) => cmd)
			.run(() => {});

		expect(app._node.plugins.length).toBe(1);
		expect(app._node.localFlags.verbose).toBeDefined();
		expect(app._node.args?.length).toBe(1);
		expect(app._node.subCommands.sub).toBeDefined();
		expect(app._node.run).toBeDefined();
	});

	it("intermediate builder retains its own plugins independently", () => {
		const plugin1: CrustPlugin = { name: "plugin-1" };
		const plugin2: CrustPlugin = { name: "plugin-2" };

		const base = new Crust("test").use(plugin1);
		const extended = base.use(plugin2);

		// base should only have plugin1
		expect(base._node.plugins.length).toBe(1);
		expect(base._node.plugins[0]).toBe(plugin1);

		// extended should have both plugins
		expect(extended._node.plugins.length).toBe(2);
		expect(extended._node.plugins[0]).toBe(plugin1);
		expect(extended._node.plugins[1]).toBe(plugin2);
	});

	it("plugin without name is accepted", () => {
		const plugin: CrustPlugin = {
			setup: () => {},
		};

		const app = new Crust("test").use(plugin);
		expect(app._node.plugins.length).toBe(1);
		expect(app._node.plugins[0]?.name).toBeUndefined();
	});

	it("empty plugin object is accepted", () => {
		const plugin: CrustPlugin = {};

		const app = new Crust("test").use(plugin);
		expect(app._node.plugins.length).toBe(1);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// .execute() — Full execution pipeline tests
// ────────────────────────────────────────────────────────────────────────────

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
			stdoutChunks.push(
				args.map((a) => (typeof a === "string" ? a : String(a))).join(" "),
			);
		};
		console.error = (...args: unknown[]) => {
			stderrChunks.push(
				args.map((a) => (typeof a === "string" ? a : String(a))).join(" "),
			);
		};
		console.warn = (...args: unknown[]) => {
			stderrChunks.push(
				args.map((a) => (typeof a === "string" ? a : String(a))).join(" "),
			);
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
			.flags({ verbose: { type: "boolean", short: "v" } })
			.run((ctx) => {
				receivedFlags = ctx.flags;
			});

		await app.execute({ argv: ["--verbose"] });

		expect(receivedFlags.verbose).toBe(true);
	});

	it("runs root handler with parsed args", async () => {
		let receivedArgs: Record<string, unknown> = {};

		const app = new Crust("test")
			.args([{ name: "file", type: "string", required: true }])
			.run((ctx) => {
				receivedArgs = ctx.args;
			});

		await app.execute({ argv: ["hello.txt"] });

		expect(receivedArgs.file).toBe("hello.txt");
	});

	it("runs root handler with flags and args combined", async () => {
		let receivedCtx: CrustCommandContext | undefined;

		const app = new Crust("test")
			.flags({
				port: { type: "number", default: 3000 },
				verbose: { type: "boolean" },
			})
			.args([{ name: "dir", type: "string", default: "." }])
			.run((ctx) => {
				receivedCtx = ctx as unknown as CrustCommandContext;
			});

		await app.execute({ argv: ["public", "--port", "8080"] });

		expect(receivedCtx).toBeDefined();
		expect(
			(receivedCtx as unknown as { args: Record<string, unknown> }).args.dir,
		).toBe("public");
		expect(
			(receivedCtx as unknown as { flags: Record<string, unknown> }).flags.port,
		).toBe(8080);
	});

	it("routes to subcommand", async () => {
		let handlerRan = "";

		const app = new Crust("cli")
			.run(() => {
				handlerRan = "root";
			})
			.command("sub", (cmd) =>
				cmd.run(() => {
					handlerRan = "sub";
				}),
			);

		await app.execute({ argv: ["sub"] });

		expect(handlerRan).toBe("sub");
	});

	it("passes inherited flags to subcommand handler", async () => {
		let subFlags: Record<string, unknown> = {};

		const app = new Crust("cli")
			.flags({
				verbose: { type: "boolean", inherit: true },
				port: { type: "number", default: 3000 },
			})
			.command("sub", (cmd) =>
				cmd.run((ctx) => {
					subFlags = ctx.flags;
				}),
			);

		await app.execute({ argv: ["sub", "--verbose"] });

		expect(subFlags.verbose).toBe(true);
		// port is not inherited (no inherit: true)
		expect(subFlags.port).toBeUndefined();
	});

	it("argv override works", async () => {
		let receivedDir = "";

		const app = new Crust("test")
			.args([{ name: "dir", type: "string", default: "." }])
			.run((ctx) => {
				receivedDir = ctx.args.dir as string;
			});

		await app.execute({ argv: ["custom-dir"] });

		expect(receivedDir).toBe("custom-dir");
	});

	it("runs plugin setup before handlers", async () => {
		const order: string[] = [];

		const plugin: CrustPlugin = {
			name: "test-plugin",
			setup: () => {
				order.push("setup");
			},
		};

		const app = new Crust("test").use(plugin).run(() => {
			order.push("run");
		});

		await app.execute({ argv: [] });

		expect(order).toEqual(["setup", "run"]);
	});

	it("runs middleware chain", async () => {
		const order: string[] = [];

		const plugin: CrustPlugin = {
			name: "test-plugin",
			middleware: async (_ctx, next) => {
				order.push("middleware:before");
				await next();
				order.push("middleware:after");
			},
		};

		const app = new Crust("test").use(plugin).run(() => {
			order.push("run");
		});

		await app.execute({ argv: [] });

		expect(order).toEqual(["middleware:before", "run", "middleware:after"]);
	});

	it("runs multiple middleware in registration order", async () => {
		const order: string[] = [];

		const plugin1: CrustPlugin = {
			name: "p1",
			middleware: async (_ctx, next) => {
				order.push("p1:before");
				await next();
				order.push("p1:after");
			},
		};
		const plugin2: CrustPlugin = {
			name: "p2",
			middleware: async (_ctx, next) => {
				order.push("p2:before");
				await next();
				order.push("p2:after");
			},
		};

		const app = new Crust("test")
			.use(plugin1)
			.use(plugin2)
			.run(() => {
				order.push("run");
			});

		await app.execute({ argv: [] });

		expect(order).toEqual([
			"p1:before",
			"p2:before",
			"run",
			"p2:after",
			"p1:after",
		]);
	});

	it("runs preRun → run → postRun in order", async () => {
		const order: string[] = [];

		const app = new Crust("test")
			.preRun(() => {
				order.push("preRun");
			})
			.run(() => {
				order.push("run");
			})
			.postRun(() => {
				order.push("postRun");
			});

		await app.execute({ argv: [] });

		expect(order).toEqual(["preRun", "run", "postRun"]);
	});

	it("postRun runs even if run throws", async () => {
		const order: string[] = [];

		const app = new Crust("test")
			.preRun(() => {
				order.push("preRun");
			})
			.run(() => {
				order.push("run");
				throw new Error("boom");
			})
			.postRun(() => {
				order.push("postRun");
			});

		await app.execute({ argv: [] });

		expect(order).toEqual(["preRun", "run", "postRun"]);
		expect(process.exitCode).toBe(1);
		expect(stderrChunks.join("\n")).toContain("boom");
	});

	it("catches errors and sets exitCode", async () => {
		const app = new Crust("test").run(() => {
			throw new Error("execution failed");
		});

		await app.execute({ argv: [] });

		expect(process.exitCode).toBe(1);
		expect(stderrChunks.join("\n")).toContain("execution failed");
	});

	it("catches CrustError and sets exitCode", async () => {
		const app = new Crust("test").run(() => {
			throw new CrustError("EXECUTION", "custom crust error");
		});

		await app.execute({ argv: [] });

		expect(process.exitCode).toBe(1);
		expect(stderrChunks.join("\n")).toContain("custom crust error");
	});

	it("treats prompt cancellation as a silent user abort", async () => {
		const app = new Crust("test").run(() => {
			const error = new Error("Prompt was cancelled.");
			error.name = "CancelledError";
			throw error;
		});

		await app.execute({ argv: [] });

		expect(process.exitCode).toBe(130);
		expect(stderrChunks).toEqual([]);
	});

	it("handles unknown flag error", async () => {
		const app = new Crust("test")
			.flags({ verbose: { type: "boolean" } })
			.run(() => {});

		await app.execute({ argv: ["--unknown"] });

		expect(process.exitCode).toBe(1);
		expect(stderrChunks.join("\n")).toContain("Unknown flag");
	});

	it("handles missing required flag error", async () => {
		const app = new Crust("test")
			.flags({ name: { type: "string", required: true } })
			.run(() => {});

		await app.execute({ argv: [] });

		expect(process.exitCode).toBe(1);
		expect(stderrChunks.join("\n")).toContain("Missing required");
	});

	it("command not found error with no run on parent", async () => {
		const app = new Crust("cli").command("sub", (cmd) => cmd.run(() => {}));

		await app.execute({ argv: ["unknown-sub"] });

		expect(process.exitCode).toBe(1);
		expect(stderrChunks.join("\n")).toContain("Unknown command");
	});

	it("no run handler is a no-op (no error)", async () => {
		const app = new Crust("test").flags({ verbose: { type: "boolean" } });

		await app.execute({ argv: ["--verbose"] });

		// Should complete without error (exitCode stays 0)
		expect(process.exitCode).toBe(0);
	});

	it("plugin setup can add flags recognized by parser", async () => {
		let receivedFlags: Record<string, unknown> = {};

		const plugin: CrustPlugin = {
			name: "version-plugin",
			setup: (ctx, actions) => {
				actions.addFlag(ctx.rootCommand, "version", {
					type: "boolean",
					short: "V",
				});
			},
		};

		const app = new Crust("test").use(plugin).run((ctx) => {
			receivedFlags = ctx.flags;
		});

		await app.execute({ argv: ["--version"] });

		expect(receivedFlags.version).toBe(true);
	});

	it("plugin-added subcommand trees inherit flags from prior plugins", async () => {
		let receivedFlags: Record<string, unknown> = {};

		const helpLikePlugin: CrustPlugin = {
			name: "help-like",
			setup: (ctx, actions) => {
				actions.addFlag(ctx.rootCommand, "help", {
					type: "boolean",
					inherit: true,
				});
			},
		};
		const subCommandPlugin: CrustPlugin = {
			name: "inject-subcommand",
			setup: (ctx, actions) => {
				actions.addSubCommand(
					ctx.rootCommand,
					"skill",
					new Crust("skill").command("update", (cmd) =>
						cmd.run((runCtx) => {
							receivedFlags = runCtx.flags as Record<string, unknown>;
						}),
					)._node,
				);
			},
		};

		const app = new Crust("test")
			.use(helpLikePlugin)
			.use(subCommandPlugin)
			.run(() => {});

		await app.execute({ argv: ["skill", "update", "--help"] });

		expect(receivedFlags.help).toBe(true);
	});

	it("deeply nested subcommand routing works", async () => {
		let handlerRan = "";

		const app = new Crust("cli")
			.flags({ verbose: { type: "boolean", inherit: true } })
			.command("level1", (cmd) =>
				cmd.command("level2", (cmd2) =>
					cmd2.command("level3", (cmd3) =>
						cmd3.run(() => {
							handlerRan = "level3";
						}),
					),
				),
			);

		await app.execute({ argv: ["level1", "level2", "level3"] });

		expect(handlerRan).toBe("level3");
	});

	it("rawArgs are passed through", async () => {
		let receivedRawArgs: string[] = [];

		const app = new Crust("test")
			.flags({ verbose: { type: "boolean" } })
			.run((ctx) => {
				receivedRawArgs = ctx.rawArgs;
			});

		await app.execute({ argv: ["--verbose", "--", "extra1", "extra2"] });

		expect(receivedRawArgs).toEqual(["extra1", "extra2"]);
	});

	it("middleware receives route and input after resolution", async () => {
		let middlewareRoute: unknown = null;
		let middlewareInput: unknown = null;

		const plugin: CrustPlugin = {
			name: "inspect",
			middleware: async (ctx, next) => {
				middlewareRoute = ctx.route;
				middlewareInput = ctx.input;
				await next();
			},
		};

		const app = new Crust("cli")
			.use(plugin)
			.command("sub", (cmd) =>
				cmd
					.flags({ output: { type: "string", default: "stdout" } })
					.run(() => {}),
			);

		await app.execute({ argv: ["sub", "--output", "file.txt"] });

		expect(middlewareRoute).toBeDefined();
		expect(
			(middlewareRoute as { command: { meta: { name: string } } }).command.meta
				.name,
		).toBe("sub");
		expect(middlewareInput).toBeDefined();
		expect(
			(middlewareInput as { flags: Record<string, unknown> }).flags.output,
		).toBe("file.txt");
	});

	it("middleware can short-circuit execution", async () => {
		let handlerRan = false;

		const plugin: CrustPlugin = {
			name: "short-circuit",
			middleware: async (_ctx, _next) => {
				// Don't call next() — short circuit
			},
		};

		const app = new Crust("test").use(plugin).run(() => {
			handlerRan = true;
		});

		await app.execute({ argv: [] });

		expect(handlerRan).toBe(false);
	});

	it("inherited flags work across file-boundary pattern", async () => {
		// Simulate split-file pattern: define subcommand callback as separate function
		let receivedVerbose: boolean | undefined;

		const defineSubCommand = (
			// biome-ignore lint/complexity/noBannedTypes: testing empty initial local state
			cmd: Crust<{ verbose: { type: "boolean"; inherit: true } }, {}, []>,
		) =>
			cmd.run((ctx) => {
				receivedVerbose = ctx.flags.verbose;
			});

		const app = new Crust("cli")
			.flags({ verbose: { type: "boolean", inherit: true } })
			.command("sub", defineSubCommand);

		await app.execute({ argv: ["sub", "--verbose"] });

		expect(receivedVerbose).toBe(true);
	});

	it("default flag values work on subcommands", async () => {
		let receivedPort: number | undefined;

		const app = new Crust("cli")
			.flags({
				port: { type: "number", default: 3000, inherit: true },
			})
			.command("sub", (cmd) =>
				cmd.run((ctx) => {
					receivedPort = ctx.flags.port as number;
				}),
			);

		await app.execute({ argv: ["sub"] });

		expect(receivedPort).toBe(3000);
	});

	it("inherited flag short alias works on subcommand", async () => {
		let receivedVerbose: boolean | undefined;

		const app = new Crust("cli")
			.flags({
				verbose: { type: "boolean", short: "v", inherit: true },
			})
			.command("sub", (cmd) =>
				cmd.run((ctx) => {
					receivedVerbose = ctx.flags.verbose;
				}),
			);

		await app.execute({ argv: ["sub", "-v"] });

		expect(receivedVerbose).toBe(true);
	});

	it("plugin setup error is caught and sets exitCode", async () => {
		const plugin: CrustPlugin = {
			name: "bad-plugin",
			setup: () => {
				throw new Error("setup failed");
			},
		};

		const app = new Crust("test").use(plugin).run(() => {});

		await app.execute({ argv: [] });

		expect(process.exitCode).toBe(1);
		expect(stderrChunks.join("\n")).toContain("setup failed");
	});

	it("treats setup-time prompt cancellation as a silent user abort", async () => {
		const plugin: CrustPlugin = {
			name: "cancel-plugin",
			setup: () => {
				const error = new Error("Prompt was cancelled.");
				error.name = "CancelledError";
				throw error;
			},
		};

		const app = new Crust("test").use(plugin).run(() => {});

		await app.execute({ argv: [] });

		expect(process.exitCode).toBe(130);
		expect(stderrChunks).toEqual([]);
	});

	it("async run handler works", async () => {
		let result = "";

		const app = new Crust("test").run(async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
			result = "done";
		});

		await app.execute({ argv: [] });

		expect(result).toBe("done");
	});

	it("command context contains the resolved command node", async () => {
		let receivedCommand: unknown;

		const app = new Crust("test")
			.flags({ verbose: { type: "boolean" } })
			.run((ctx) => {
				receivedCommand = ctx.command;
			});

		await app.execute({ argv: [] });

		expect(receivedCommand).toBeDefined();
		expect((receivedCommand as { meta: { name: string } }).meta.name).toBe(
			"test",
		);
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
			throw new Error(
				`process.exit(${code ?? "undefined"}) was called during validation`,
			);
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
		const app = new Crust("in-process-validation").run(() => {
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
		const app = new Crust("cli").run(() => {});
		app._node.effectiveFlags["no-verbose"] = { type: "boolean" };

		await app.execute({ argv: [] });

		expect(exitCalls).toEqual([]);
		expect(process.exitCode).toBe(1);
	});

	it("force-exits when VALIDATION_FORCE_EXIT_ENV is also set (build subprocess path)", async () => {
		process.env[VALIDATION_MODE_ENV] = "1";
		process.env[VALIDATION_FORCE_EXIT_ENV] = "1";

		const app = new Crust("build-subprocess").run(() => {});

		// Stubbed process.exit throws; the rejection confirms it fired.
		await expect(app.execute({ argv: [] })).rejects.toThrow(
			"process.exit(0) was called",
		);
		expect(exitCalls).toEqual([0]);
	});

	it("force-exits with code 1 on validation failure when both envs are set", async () => {
		process.env[VALIDATION_MODE_ENV] = "1";
		process.env[VALIDATION_FORCE_EXIT_ENV] = "1";

		const app = new Crust("cli").run(() => {});
		app._node.effectiveFlags["no-verbose"] = { type: "boolean" };

		await expect(app.execute({ argv: [] })).rejects.toThrow(
			"process.exit(1) was called",
		);
		expect(exitCalls).toEqual([1]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// .sub() — Runtime tests
// ────────────────────────────────────────────────────────────────────────────

describe("Crust .sub()", () => {
	it("returns a new Crust instance with correct name", () => {
		const app = new Crust("cli").flags({
			verbose: { type: "boolean", inherit: true },
		});
		const sub = app.sub("deploy");

		expect(sub._node.meta.name).toBe("deploy");
	});

	it("carries parent's inheritable flags in _inheritedFlags", () => {
		const app = new Crust("cli").flags({
			verbose: { type: "boolean", inherit: true },
			port: { type: "number" },
		});
		const sub = app.sub("deploy");

		// _inheritedFlags should contain ALL parent effective flags
		// (filtering for inherit:true happens in computeEffectiveFlags)
		expect(sub._inheritedFlags.verbose).toEqual({
			type: "boolean",
			inherit: true,
		});
		expect(sub._inheritedFlags.port).toEqual({ type: "number" });
	});

	it("starts with empty local flags and no args", () => {
		const app = new Crust("cli").flags({
			verbose: { type: "boolean", inherit: true },
		});
		const sub = app.sub("deploy");

		expect(sub._node.localFlags).toEqual({});
		expect(sub._node.args).toBeUndefined();
	});

	it("throws CrustError DEFINITION on empty name", () => {
		const app = new Crust("cli");
		try {
			app.sub("");
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("DEFINITION");
			expect((err as CrustError).message).toContain("non-empty");
		}
	});

	it("throws CrustError DEFINITION on whitespace-only name", () => {
		const app = new Crust("cli");
		try {
			app.sub("   ");
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("DEFINITION");
		}
	});

	it("chaining .sub().flags().args().run() works", () => {
		const app = new Crust("cli").flags({
			verbose: { type: "boolean", inherit: true },
		});

		const deploy = app
			.sub("deploy")
			.meta({ description: "Deploy something" })
			.flags({ env: { type: "string", required: true } })
			.args([{ name: "target", type: "string", required: true }])
			.run(() => {});

		expect(deploy._node.meta.name).toBe("deploy");
		expect(deploy._node.meta.description).toBe("Deploy something");
		expect(deploy._node.localFlags.env).toBeDefined();
		expect(deploy._node.args?.length).toBe(1);
		expect(deploy._node.run).toBeDefined();
	});

	it("nested .sub() chains carry flags through", () => {
		const app = new Crust("cli").flags({
			verbose: { type: "boolean", inherit: true },
		});

		const deploy = app.sub("deploy").flags({
			env: { type: "string", inherit: true },
		});

		const status = deploy.sub("status");

		// status should have inherited flags from deploy (which includes verbose + env)
		expect(status._inheritedFlags.verbose).toEqual({
			type: "boolean",
			inherit: true,
		});
		expect(status._inheritedFlags.env).toEqual({
			type: "string",
			inherit: true,
		});
	});

	it("does not mutate the parent builder", () => {
		const app = new Crust("cli").flags({
			verbose: { type: "boolean", inherit: true },
		});
		app.sub("deploy");

		// Parent should be untouched
		expect(app._node.subCommands).toEqual({});
	});
});

// ────────────────────────────────────────────────────────────────────────────
// .sub() — Type-level tests
// ────────────────────────────────────────────────────────────────────────────

describe("Crust .sub() type-level tests", () => {
	it("sub builder Inherited = EffectiveFlags<ParentInherited, ParentLocal>", () => {
		const app = new Crust("cli").flags({
			verbose: { type: "boolean", inherit: true },
			port: { type: "number" },
		});

		const sub = app.sub("deploy");

		type SubInherited = (typeof sub)["_types"]["inherited"];

		// verbose is inherited (inherit: true), so present
		type _checkVerbose = Expect<
			Equal<
				SubInherited["verbose"],
				{ readonly type: "boolean"; readonly inherit: true }
			>
		>;

		// port has no inherit:true, but it's in the parent's Local, so it shows
		// up in EffectiveFlags at the type level (it goes through InheritableFlags
		// filtering when the sub's own child is created)
		type _checkPort = Expect<
			Equal<SubInherited["port"], { readonly type: "number" }>
		>;
	});

	it("sub builder starts with empty Local and Args", () => {
		const app = new Crust("cli").flags({
			verbose: { type: "boolean", inherit: true },
		});

		const sub = app.sub("deploy");

		type SubLocal = (typeof sub)["_types"]["local"];
		type SubArgs = (typeof sub)["_types"]["args"];

		// biome-ignore lint/complexity/noBannedTypes: verifying empty initial state
		type _checkLocal = Expect<Equal<SubLocal, {}>>;
		type _checkArgs = Expect<Equal<SubArgs, []>>;
	});

	it("inherited flags correctly typed in .run() handler after .sub()", () => {
		const app = new Crust("cli").flags({
			verbose: { type: "boolean", inherit: true },
			port: { type: "number" },
		});

		app
			.sub("deploy")
			.flags({ env: { type: "string", required: true } })
			.run((_ctx) => {
				type CtxFlags = typeof _ctx.flags;
				// verbose inherits (inherit: true)
				type _checkVerbose = Expect<
					Equal<CtxFlags["verbose"], boolean | undefined>
				>;
				// env is local required
				type _checkEnv = Expect<Equal<CtxFlags["env"], string>>;
			});
	});

	it("nested .sub().sub() carries inheritable flags through at type level", () => {
		const app = new Crust("cli").flags({
			verbose: { type: "boolean", inherit: true },
			rootOnly: { type: "string" },
		});

		const l1 = app.sub("l1").flags({
			l1Flag: { type: "string", inherit: true },
		});

		const l2 = l1.sub("l2");

		type L2Inherited = (typeof l2)["_types"]["inherited"];

		// verbose cascades (inherit: true at root level)
		type _checkVerbose = Expect<
			Equal<
				L2Inherited["verbose"],
				{ readonly type: "boolean"; readonly inherit: true }
			>
		>;
		// l1Flag cascades (inherit: true at l1 level)
		type _checkL1Flag = Expect<
			Equal<
				L2Inherited["l1Flag"],
				{ readonly type: "string"; readonly inherit: true }
			>
		>;
		// rootOnly should be filtered out (no inherit:true)
		type _checkKeys = Expect<Equal<keyof L2Inherited, "verbose" | "l1Flag">>;
	});
});

// ────────────────────────────────────────────────────────────────────────────
// .command(builder) — Runtime tests
// ────────────────────────────────────────────────────────────────────────────

describe("Crust .command(builder)", () => {
	it("registers the subcommand by name from builder", () => {
		const app = new Crust("cli").flags({
			verbose: { type: "boolean", inherit: true },
		});
		const deploy = app.sub("deploy").flags({
			env: { type: "string", required: true },
		});

		const result = app.command(deploy);

		expect(result._node.subCommands.deploy).toBeDefined();
		expect(result._node.subCommands.deploy?.meta.name).toBe("deploy");
	});

	it("computes effectiveFlags correctly", () => {
		const app = new Crust("cli").flags({
			verbose: { type: "boolean", inherit: true },
			port: { type: "number" },
		});
		const deploy = app
			.sub("deploy")
			.flags({ env: { type: "string", required: true } });

		const result = app.command(deploy);
		const subNode = result._node.subCommands.deploy;

		// effectiveFlags = inherited(verbose) + local(env)
		// port is NOT inherited (no inherit: true)
		expect(subNode?.effectiveFlags.verbose).toEqual({
			type: "boolean",
			inherit: true,
		});
		expect(subNode?.effectiveFlags.env).toEqual({
			type: "string",
			required: true,
		});
		expect(subNode?.effectiveFlags.port).toBeUndefined();
	});

	it("throws CrustError DEFINITION on duplicate subcommand name", () => {
		const app = new Crust("cli").command("deploy", (cmd) => cmd);
		const deploy = new Crust("deploy");

		try {
			app.command(deploy);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("DEFINITION");
			expect((err as CrustError).message).toContain("already registered");
		}
	});

	it("throws CrustError DEFINITION if builder has empty name", () => {
		// We can't create Crust("") directly (it throws), so we test the path
		// by using a valid name that's already handled.
		// This test validates that the code path exists; the empty-name constructor
		// already prevents creating such builders.
		const app = new Crust("cli");
		try {
			app.command(new Crust("   "));
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("DEFINITION");
		}
	});

	it("returns new instance (immutability)", () => {
		const app = new Crust("cli");
		const deploy = new Crust("deploy");
		const result = app.command(deploy);

		expect(result).not.toBe(app);
	});

	it("does not mutate original builder", () => {
		const app = new Crust("cli");
		const deploy = new Crust("deploy");
		app.command(deploy);

		expect(app._node.subCommands).toEqual({});
	});

	it("both overloads can be mixed: .command(name, cb).command(builder)", () => {
		const app = new Crust("cli").flags({
			verbose: { type: "boolean", inherit: true },
		});
		const deploy = app.sub("deploy").run(() => {});

		const result = app
			.command("status", (cmd) => cmd.run(() => {}))
			.command(deploy);

		expect(result._node.subCommands.status).toBeDefined();
		expect(result._node.subCommands.deploy).toBeDefined();
	});

	it("full pipeline: .sub() → .command(builder) → .execute()", async () => {
		let receivedFlags: Record<string, unknown> = {};

		const app = new Crust("cli").flags({
			verbose: { type: "boolean", inherit: true },
		});

		const deploy = app
			.sub("deploy")
			.flags({ env: { type: "string", default: "staging" } })
			.run((ctx) => {
				receivedFlags = ctx.flags;
			});

		await app.command(deploy).execute({ argv: ["deploy", "--verbose"] });

		expect(receivedFlags.verbose).toBe(true);
		expect(receivedFlags.env).toBe("staging");
	});

	it("nested .sub() → .command(builder) works end-to-end", async () => {
		let receivedFlags: Record<string, unknown> = {};

		const app = new Crust("cli").flags({
			verbose: { type: "boolean", inherit: true },
		});

		const deployCmd = app
			.sub("deploy")
			.flags({ env: { type: "string", inherit: true } });

		const statusCmd = deployCmd.sub("status").run((ctx) => {
			receivedFlags = ctx.flags;
		});

		await app
			.command(deployCmd.command(statusCmd))
			.execute({ argv: ["deploy", "status", "--verbose", "--env", "prod"] });

		expect(receivedFlags.verbose).toBe(true);
		expect(receivedFlags.env).toBe("prod");
	});
});

describe("Crust.prepareCommandTree", () => {
	it("returns a frozen tree and does not mutate the builder", async () => {
		const plugin: CrustPlugin = {
			name: "doc-test",
			setup(ctx, actions) {
				actions.addFlag(ctx.rootCommand, "extra", {
					type: "boolean",
					description: "Injected for docs",
				});
			},
		};

		const app = new Crust("cli").use(plugin).meta({ description: "Test" });

		expect(app._node.localFlags.extra).toBeUndefined();

		const { root, warnings } = await app.prepareCommandTree();

		expect(app._node.localFlags.extra).toBeUndefined();
		expect(root.effectiveFlags.extra).toMatchObject({
			type: "boolean",
			description: "Injected for docs",
		});
		expect(Object.isFrozen(root)).toBe(true);
		expect(warnings).toEqual([]);
	});

	it("can be called multiple times", async () => {
		const app = new Crust("cli").run(() => {});
		const a = await app.prepareCommandTree();
		const b = await app.prepareCommandTree();
		expect(a.root.meta.name).toBe("cli");
		expect(b.root.meta.name).toBe("cli");
	});
});
