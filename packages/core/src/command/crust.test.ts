import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { extension } from "../api/extension.ts";
import { CrustError } from "../errors.ts";
import type { FlagsDef, ValidateFlagAliases, ValidateNoPrefixedFlags } from "../types.ts";
import {
	Crust,
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
			(a) => a.flags({ verbose: { type: "boolean" } }) as Crust,
			(a) => {
				expect(a._node.localFlags).toEqual({});
				expect(a._node.effectiveFlags).toEqual({});
			},
		],
		[
			".args()",
			(a) => a.args([{ name: "file", type: "string" }]) as Crust,
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
			".command(name, cb)",
			(a) => a.command("sub", (cmd) => cmd) as Crust,
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
			(a) => a.extend(extension("test-extension")) as Crust,
			(a) => {
				expect(a._node.extensions.length).toBe(0);
			},
		],
		[
			".command(builder)",
			(a) => a.command(new Crust("deploy")) as Crust,
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

	it("throws CrustError DEFINITION at parse time on flag name starting with no-", async () => {
		const app = new Crust("test").flags({ "no-cache": { type: "boolean" } } as FlagsDef &
			ValidateNoPrefixedFlags<ValidateFlagAliases<FlagsDef>>);

		await expect(app.run([])).rejects.toMatchObject({ code: "DEFINITION" });
	});

	it("throws CrustError DEFINITION at parse time on aliases starting with no-", async () => {
		const app = new Crust("test").flags({
			cache: { type: "boolean", aliases: ["no-store"] },
		} as FlagsDef & ValidateNoPrefixedFlags<ValidateFlagAliases<FlagsDef>>);

		await expect(app.run([])).rejects.toMatchObject({ code: "DEFINITION" });
	});

	it("throws CrustError DEFINITION at parse time on short aliases starting with no-", async () => {
		const app = new Crust("test").flags({
			cache: { type: "boolean", short: "no-c" },
		} as FlagsDef & ValidateNoPrefixedFlags<ValidateFlagAliases<FlagsDef>>);

		await expect(app.run([])).rejects.toMatchObject({ code: "DEFINITION" });
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
			Equal<AppLocal["verbose"], { readonly type: "boolean"; readonly short: "v" }>
		>;
		type _checkPort = Expect<
			Equal<AppLocal["port"], { readonly type: "number"; readonly default: 3000 }>
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
		const app = new Crust("cli").command("sub", (cmd) => cmd.flags({ output: { type: "string" } }));

		const subNode = app._node.subCommands.sub;
		expect(subNode).toBeDefined();
		expect(subNode?.meta.name).toBe("sub");
	});

	it("subcommand node has correct local flags", () => {
		const app = new Crust("cli").command("sub", (cmd) => cmd.flags({ output: { type: "string" } }));

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
					.command("level2", (cmd2) => cmd2.flags({ format: { type: "string" } })),
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
					Equal<CmdInherited["verbose"], { readonly type: "boolean"; readonly inherit: true }>
				>;

				// port is also present in the Inherited generic (all parent effective flags)
				// but will be filtered out by InheritableFlags when computing the child's
				// EffectiveFlags in .handle() or further .command() calls
				type _checkPort = Expect<Equal<CmdInherited["port"], { readonly type: "number" }>>;

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
					Equal<ConfiguredLocal["output"], { readonly type: "number"; readonly default: 42 }>
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
					Equal<L1Inherited["verbose"], { readonly type: "boolean"; readonly inherit: true }>
				>;

				return cmd
					.flags({ l1Flag: { type: "string", inherit: true } })
					.command("level2", (cmd2) => {
						// level2's Inherited = EffectiveFlags of level1
						// EffectiveFlags<L1Inherited, L1Local> filters L1Inherited
						// for inherit:true (only verbose) then merges with l1Flag
						type L2Inherited = (typeof cmd2)["_types"]["inherited"];
						type _checkVerboseL2 = Expect<
							Equal<L2Inherited["verbose"], { readonly type: "boolean"; readonly inherit: true }>
						>;
						type _checkL1FlagL2 = Expect<
							Equal<L2Inherited["l1Flag"], { readonly type: "string"; readonly inherit: true }>
						>;

						// rootOnly has no inherit:true, so it's filtered by
						// EffectiveFlags at level1→level2 boundary
						// Verify only verbose and l1Flag are keys (rootOnly excluded)
						type _checkKeys = Expect<Equal<keyof L2Inherited, "verbose" | "l1Flag">>;

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
						Equal<L2Inherited["global"], { readonly type: "boolean"; readonly inherit: true }>
					>;
					type _checkL1Local = Expect<Equal<L2Inherited["l1Local"], { readonly type: "number" }>>;

					// local1 should NOT be in L2Inherited (filtered by EffectiveFlags)
					// Verify only global and l1Local are keys (local1 excluded)
					type _checkKeys = Expect<Equal<keyof L2Inherited, "global" | "l1Local">>;

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
			Equal<AppLocal["verbose"], { readonly type: "boolean"; readonly short: "v" }>
		>;
		type _checkPort = Expect<
			Equal<AppLocal["port"], { readonly type: "number"; readonly default: 3000 }>
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

			// oxlint-disable-next-line typescript/no-empty-object-type -- verifying empty initial state
			type _checkLocal = Expect<Equal<CmdLocal, {}>>;
			type _checkArgs = Expect<Equal<CmdArgs, []>>;

			return cmd;
		});
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
			.flags({ verbose: { type: "boolean" } })
			.args([{ name: "file", type: "string", required: true }])
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
			.handle(() => {});

		expect(app._node.localFlags.verbose).toBeDefined();
		expect(app._node.args?.length).toBe(1);
	});

	it("can chain .handle() after .command()", () => {
		const app = new Crust("cli").command("sub", (cmd) => cmd).handle(() => {});

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
			.args([
				{ name: "file", type: "string", required: true },
				{ name: "count", type: "number", default: 5 },
			])
			.handle((_ctx) => {
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
				cmd.flags({ output: { type: "string", required: true } }).handle((_ctx) => {
					type CtxFlags = typeof _ctx.flags;
					// inherited verbose (inherit: true) should be present
					type _checkVerbose = Expect<Equal<CtxFlags["verbose"], boolean | undefined>>;
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
				cmd.handle((_ctx) => {
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
				cmd.flags({ output: { type: "number", default: 42 } }).handle((_ctx) => {
					type CtxFlags = typeof _ctx.flags;
					// output was overridden from string to number
					type _checkOutput = Expect<Equal<CtxFlags["output"], number>>;
				}),
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
			.flags({ verbose: { type: "boolean", default: false } })
			.args([{ name: "file", type: "string", required: true }]);

		const withHandler = app.handle((_ctx) => {
			type CtxFlags = typeof _ctx.flags;
			type CtxArgs = typeof _ctx.args;
			type _checkVerbose = Expect<Equal<CtxFlags["verbose"], boolean>>;
			type _checkFile = Expect<Equal<CtxArgs["file"], string>>;
		});

		expect(withHandler._node.run).toBeDefined();
	});

	it("variadic args resolve to array type in handler", () => {
		new Crust("test").args([{ name: "files", type: "string", variadic: true }]).handle((_ctx) => {
			type CtxArgs = typeof _ctx.args;
			type _checkFiles = Expect<Equal<CtxArgs["files"], string[]>>;
		});
	});

	it("multiple flag resolves to array type in handler", () => {
		new Crust("test")
			.flags({
				tags: { type: "string", multiple: true, required: true },
			})
			.handle((_ctx) => {
				type CtxFlags = typeof _ctx.flags;
				type _checkTags = Expect<Equal<CtxFlags["tags"], string[]>>;
			});
	});

	it("optional flag resolves to union with undefined in handler", () => {
		new Crust("test")
			.flags({
				port: { type: "number" },
			})
			.handle((_ctx) => {
				type CtxFlags = typeof _ctx.flags;
				type _checkPort = Expect<Equal<CtxFlags["port"], number | undefined>>;
			});
	});

	it("required flag resolves to non-optional type in handler", () => {
		new Crust("test")
			.flags({
				name: { type: "string", required: true },
			})
			.handle((_ctx) => {
				type CtxFlags = typeof _ctx.flags;
				type _checkName = Expect<Equal<CtxFlags["name"], string>>;
			});
	});

	it("flag with default resolves to non-optional type in handler", () => {
		new Crust("test")
			.flags({
				port: { type: "number", default: 3000 },
			})
			.handle((_ctx) => {
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
		const ext = extension("test-extension");
		const app = new Crust("test").extend(ext);

		expect(app._node.extensions.length).toBe(1);
		expect(app._node.extensions[0]).toBe(ext);
	});

	it("multiple .extend() calls chain in registration order", () => {
		const one = extension("one");
		const two = extension("two");
		const three = extension("three");

		const app = new Crust("test").extend(one).extend(two, three);

		expect(app._node.extensions.map((e) => e.name)).toEqual(["one", "two", "three"]);
	});

	it("extension() returns a frozen plain config", () => {
		const ext = extension("frozen", { flags: { x: { type: "boolean" } } });

		expect(Object.isFrozen(ext)).toBe(true);
		expect(ext.name).toBe("frozen");
		expect(ext.flags?.x?.type).toBe("boolean");
	});

	it("extension() rejects an empty name", () => {
		expect(() => extension("  ")).toThrow(CrustError);
	});

	it("preserves flags, args, handler, and subcommands when extending", () => {
		const app = new Crust("test")
			.flags({ verbose: { type: "boolean" } })
			.args([{ name: "file", type: "string" }])
			.command("sub", (cmd) => cmd)
			.handle(() => {})
			.extend(extension("test-extension"));

		expect(app._node.localFlags.verbose).toBeDefined();
		expect(app._node.args?.length).toBe(1);
		expect(app._node.subCommands.sub).toBeDefined();
		expect(app._node.run).toBeDefined();
		expect(app._node.extensions.length).toBe(1);
	});

	it("intermediate builder retains its own extensions independently", () => {
		const one = extension("one");
		const two = extension("two");

		const base = new Crust("test").extend(one);
		const extended = base.extend(two);

		expect(base._node.extensions.map((e) => e.name)).toEqual(["one"]);
		expect(extended._node.extensions.map((e) => e.name)).toEqual(["one", "two"]);
	});
});

describe("Extension application at prepare time", () => {
	it("recursive Extension flags reach every command, including Extension commands", async () => {
		const seen: Record<string, unknown>[] = [];
		const debug = extension("debug", {
			flags: { debug: { type: "boolean", inherit: true } },
		});

		const app = new Crust("cli").extend(debug).command("sub", (cmd) =>
			cmd.handle(({ flags }) => {
				seen.push(flags);
			}),
		);

		await app.run(["sub", "--debug"]);

		expect(seen[0]?.debug).toBe(true);
	});

	it("non-recursive Extension flags stay on the root", async () => {
		const version = extension("version", {
			flags: { version: { type: "boolean", recursive: false } },
		});

		const app = new Crust("cli").extend(version).command("sub", (cmd) => cmd.handle(() => {}));

		// --version is unknown on the subcommand → PARSE error
		await expect(app.run(["sub", "--version"])).rejects.toMatchObject({ code: "PARSE" });
	});

	it("Extension flag colliding with an application flag is a DEFINITION error", async () => {
		const clash = extension("clash", { flags: { verbose: { type: "boolean" } } });
		const app = new Crust("cli")
			.flags({ verbose: { type: "boolean" } })
			.extend(clash)
			.handle(() => {});

		await expect(app.run([])).rejects.toMatchObject({ code: "DEFINITION" });
	});

	it("Extension flag short/alias collisions are DEFINITION errors at prepare time", async () => {
		const clash = extension("clash", {
			flags: { loud: { type: "boolean", short: "v" } },
		});
		const app = new Crust("cli")
			.flags({ verbose: { type: "boolean", short: "v" } })
			.extend(clash)
			.handle(() => {});

		await expect(app.run([])).rejects.toMatchObject({ code: "DEFINITION" });
	});

	it("Extension flag colliding with another Extension's flag is a DEFINITION error", async () => {
		const a = extension("a", { flags: { shared: { type: "boolean" } } });
		const b = extension("b", { flags: { shared: { type: "boolean" } } });
		const app = new Crust("cli").extend(a, b).handle(() => {});

		await expect(app.run([])).rejects.toMatchObject({ code: "DEFINITION" });
	});

	it("Extension commands are routable and their inputs validated before hooks", async () => {
		const lines: string[] = [];
		const completion = extension("completion", {
			commands: [
				new Crust("completion")
					.args([{ name: "shell", type: "string", required: true, choices: ["bash", "zsh"] }])
					.handle(() => {}),
			],
			async intercept(context, next) {
				if (context.commandPath[1] === "completion") {
					lines.push(`completion:${String(context.args.shell)}`);
					return; // short-circuit — owned command handled here
				}
				await next();
			},
		});

		const app = new Crust("cli").extend(completion).handle(() => {});

		await app.run(["completion", "bash"]);
		expect(lines).toEqual(["completion:bash"]);

		// Owned inputs are checked BEFORE the intercept hook runs: bad choice
		// values fail at syntax parsing, missing required args at validation
		await expect(app.run(["completion", "fish"])).rejects.toMatchObject({ code: "PARSE" });
		await expect(app.run(["completion"])).rejects.toMatchObject({ code: "VALIDATION" });
	});

	it("Extension command colliding with an application command is a DEFINITION error", async () => {
		const clash = extension("clash", {
			commands: [new Crust("sub").handle(() => {})],
		});
		const app = new Crust("cli").command("sub", (cmd) => cmd.handle(() => {})).extend(clash);

		await expect(app.run(["sub"])).rejects.toMatchObject({ code: "DEFINITION" });
	});

	it("does not mutate the source builder across executions", async () => {
		let runCount = 0;
		const debug = extension("debug", { flags: { debug: { type: "boolean" } } });
		const app = new Crust("repeat").extend(debug).handle(({ flags }) => {
			if ((flags as Record<string, unknown>).debug) runCount++;
		});

		await app.execute({ argv: ["--debug"] });
		await app.execute({ argv: ["--debug"] });

		expect(runCount).toBe(2);
		expect(app._node.effectiveFlags.debug).toBeUndefined();
	});
});

describe("Extension intercept chain", () => {
	it("runs intercepts in registration order around the Command Handler", async () => {
		const order: string[] = [];
		const first = extension("first", {
			async intercept(_context, next) {
				order.push("first:before");
				await next();
				order.push("first:after");
			},
		});
		const second = extension("second", {
			async intercept(_context, next) {
				order.push("second:before");
				await next();
				order.push("second:after");
			},
		});

		const app = new Crust("cli").extend(first, second).handle(() => {
			order.push("run");
		});

		await app.run([]);

		expect(order).toEqual(["first:before", "second:before", "run", "second:after", "first:after"]);
	});

	it("short-circuiting an intercept skips validation and the Command Handler", async () => {
		let ran = false;
		const gate = extension("gate", {
			intercept() {
				// no next() — short-circuit
			},
		});

		// Required arg missing would normally fail validation
		const app = new Crust("cli")
			.args([{ name: "file", type: "string", required: true }])
			.extend(gate)
			.handle(() => {
				ran = true;
			});

		await expect(app.run([])).resolves.toBeUndefined();
		expect(ran).toBe(false);
	});

	it("intercept runs before application value validation but after parsing", async () => {
		const observed: unknown[] = [];
		const observer = extension("observer", {
			async intercept(context, next) {
				observed.push(context.flags.port);
				await next();
			},
		});

		const app = new Crust("cli")
			.flags({ port: { type: "number", required: true } })
			.extend(observer)
			.handle(() => {});

		// Parsed (coerced) value visible in the hook even though validation
		// later fails on the missing required flag when absent
		await app.run(["--port", "8080"]);
		expect(observed).toEqual([8080]);

		await expect(app.run([])).rejects.toMatchObject({ code: "VALIDATION" });
		expect(observed).toEqual([8080, undefined]);
	});

	it("routing failures flow directly to the caller — intercepts never observe them", async () => {
		let intercepted = false;
		const watcher = extension("watcher", {
			async intercept(_context, next) {
				intercepted = true;
				await next();
			},
		});

		const app = new Crust("cli").extend(watcher).command("known", (cmd) => cmd.handle(() => {}));

		await expect(app.run(["unknown"])).rejects.toMatchObject({ code: "COMMAND_NOT_FOUND" });
		expect(intercepted).toBe(false);
	});

	it("intercept receives readonly serializable snapshots and injected io", async () => {
		const lines: string[] = [];
		const probe = extension("probe", {
			async intercept(context, next) {
				expect(Object.isFrozen(context.rootCommand)).toBe(true);
				expect(Object.isFrozen(context.command)).toBe(true);
				expect(() => structuredClone(context.rootCommand)).not.toThrow();
				context.stdout(`probe:${context.command.meta.name}`);
				await next();
			},
		});

		const app = new Crust("cli").extend(probe).handle(() => {});

		await app.run([], { stdout: (t) => lines.push(t) });
		expect(lines).toEqual(["probe:cli"]);
	});

	it("calling next() twice is a DEFINITION error", async () => {
		const rogue = extension("rogue", {
			async intercept(_context, next) {
				await next();
				await next();
			},
		});

		const app = new Crust("cli").extend(rogue).handle(() => {});

		await expect(app.run([])).rejects.toMatchObject({ code: "DEFINITION" });
	});
});

// ────────────────────────────────────────────────────────────────────────────
// .execute() — Full execution pipeline tests
// ────────────────────────────────────────────────────────────────────────────

describe("Extension handleError chain", () => {
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

	it("handlers run in registration order and next() reaches Core's default renderer", async () => {
		const order: string[] = [];
		const first = extension("first", {
			async handleError(_error, _ctx, next) {
				order.push("first");
				await next();
			},
		});
		const second = extension("second", {
			async handleError(_error, _ctx, next) {
				order.push("second");
				await next();
			},
		});

		await failing().extend(first, second).execute({ argv: [] });

		expect(order).toEqual(["first", "second"]);
		// Chain end = Core's default renderer
		expect(stderrChunks.join("\n")).toContain("boom");
		expect(process.exitCode).toBe(1);
	});

	it("a handler that renders and returns replaces the default renderer but keeps a nonzero exit", async () => {
		const lines: string[] = [];
		const presenter = extension("presenter", {
			handleError(error, ctx) {
				ctx.stderr(`pretty: ${(error as Error).message}`);
				lines.push("rendered");
			},
		});

		await failing().extend(presenter).execute({ argv: [] });

		expect(lines).toEqual(["rendered"]);
		expect(stderrChunks.join("\n")).toContain("pretty: boom");
		// Default renderer did not run on top
		expect(stderrChunks.join("\n")).not.toContain("Error: boom");
		// Core always preserves the nonzero failure outcome (fixes the old
		// onError-swallows-errors exit-0 bug)
		expect(process.exitCode).toBe(1);
	});

	it("a handler that throws falls back to default rendering of the original error", async () => {
		const broken = extension("broken", {
			handleError() {
				throw new Error("renderer exploded");
			},
		});

		await failing().extend(broken).execute({ argv: [] });

		expect(stderrChunks.join("\n")).toContain("boom");
		expect(process.exitCode).toBe(1);
	});

	it("receives routing failures (COMMAND_NOT_FOUND) with the original error object", async () => {
		let received: unknown;
		const catcher = extension("catcher", {
			handleError(error, ctx) {
				received = error;
				ctx.stderr("handled");
			},
		});

		const app = new Crust("cli").extend(catcher).command("known", (cmd) => cmd.handle(() => {}));

		await app.execute({ argv: ["unknown"] });

		expect(received).toBeInstanceOf(CrustError);
		expect((received as CrustError).is("COMMAND_NOT_FOUND")).toBe(true);
		expect(process.exitCode).toBe(1);
	});

	it("never runs for run() — the original error propagates unrendered", async () => {
		let handlerRan = false;
		const presenter = extension("presenter", {
			handleError() {
				handlerRan = true;
			},
		});

		await expect(failing().extend(presenter).run([])).rejects.toThrow("boom");
		expect(handlerRan).toBe(false);
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
		const app = new Crust("test").flags({ port: { type: "number" } }).handle(() => {});

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
			.flags({ verbose: { type: "boolean" } })
			.args([{ name: "file", type: "string" }] as const)
			.handle((ctx) => {
				received = { args: ctx.args, flags: ctx.flags };
			});

		await app.run(["a.txt", "--verbose"]);

		expect(received).toEqual({ args: { file: "a.txt" }, flags: { verbose: true } });
	});
});

describe("Crust .extend() root-only", () => {
	it("throws DEFINITION when called on a child builder from .sub()", () => {
		const app = new Crust("cli");
		const child = app.sub("deploy");

		expect(() => child.extend(extension("x"))).toThrow(CrustError);
		try {
			child.extend(extension("x"));
		} catch (error) {
			expect((error as CrustError).is("DEFINITION")).toBe(true);
		}
	});

	it("throws DEFINITION when called inside a .command() callback", () => {
		expect(() =>
			new Crust("cli").command("sub", (cmd) => cmd.extend(extension("x")).handle(() => {})),
		).toThrow(CrustError);
	});

	it("throws DEFINITION when attaching a standalone builder that carries Extensions", () => {
		const sub = new Crust("sub").extend(extension("p")).handle(() => {});

		expect(() => new Crust("cli").command(sub)).toThrow(CrustError);
		try {
			new Crust("cli").command(sub);
		} catch (error) {
			expect((error as CrustError).is("DEFINITION")).toBe(true);
		}
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
			.flags({ verbose: { type: "boolean", short: "v" } })
			.handle((ctx) => {
				receivedFlags = ctx.flags;
			});

		await app.execute({ argv: ["--verbose"] });

		expect(receivedFlags.verbose).toBe(true);
	});

	it("runs root handler with parsed args", async () => {
		let receivedArgs: Record<string, unknown> = {};

		const app = new Crust("test")
			.args([{ name: "file", type: "string", required: true }])
			.handle((ctx) => {
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
			.command("sub", (cmd) =>
				cmd.handle(() => {
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
				cmd.handle((ctx) => {
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
			.handle((ctx) => {
				receivedDir = ctx.args.dir as string;
			});

		await app.execute({ argv: ["custom-dir"] });

		expect(receivedDir).toBe("custom-dir");
	});

	it("runs the intercept chain around the handler", async () => {
		const order: string[] = [];

		const wrap = extension("wrap", {
			async intercept(_ctx, next) {
				order.push("intercept:before");
				await next();
				order.push("intercept:after");
			},
		});

		const app = new Crust("test").extend(wrap).handle(() => {
			order.push("run");
		});

		await app.execute({ argv: [] });

		expect(order).toEqual(["intercept:before", "run", "intercept:after"]);
	});

	it("runs multiple intercepts in registration order", async () => {
		const order: string[] = [];

		const e1 = extension("e1", {
			async intercept(_ctx, next) {
				order.push("e1:before");
				await next();
				order.push("e1:after");
			},
		});
		const e2 = extension("e2", {
			async intercept(_ctx, next) {
				order.push("e2:before");
				await next();
				order.push("e2:after");
			},
		});

		const app = new Crust("test")
			.extend(e1)
			.extend(e2)
			.handle(() => {
				order.push("run");
			});

		await app.execute({ argv: [] });

		expect(order).toEqual(["e1:before", "e2:before", "run", "e2:after", "e1:after"]);
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
		const app = new Crust("test").flags({ verbose: { type: "boolean" } }).handle(() => {});

		await app.execute({ argv: ["--unknown"] });

		expect(process.exitCode).toBe(1);
		expect(stderrChunks.join("\n")).toContain("Unknown flag");
	});

	it("handles missing required flag error", async () => {
		const app = new Crust("test")
			.flags({ name: { type: "string", required: true } })
			.handle(() => {});

		await app.execute({ argv: [] });

		expect(process.exitCode).toBe(1);
		expect(stderrChunks.join("\n")).toContain("Missing required");
	});

	it("command not found error with no run on parent", async () => {
		const app = new Crust("cli").command("sub", (cmd) => cmd.handle(() => {}));

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

	it("Extension-owned flags are recognized by the parser", async () => {
		let receivedFlags: Record<string, unknown> = {};

		const version = extension("version", {
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

		const helpLike = extension("help-like", {
			flags: { help: { type: "boolean", inherit: true } },
		});
		const skillLike = extension("inject-subcommand", {
			commands: [
				new Crust("skill").command("update", (cmd) =>
					cmd.handle((runCtx) => {
						receivedFlags = runCtx.flags as Record<string, unknown>;
					}),
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

		const app = new Crust("cli")
			.flags({ verbose: { type: "boolean", inherit: true } })
			.command("level1", (cmd) =>
				cmd.command("level2", (cmd2) =>
					cmd2.command("level3", (cmd3) =>
						cmd3.handle(() => {
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

		const app = new Crust("test").flags({ verbose: { type: "boolean" } }).handle((ctx) => {
			receivedRawArgs = ctx.rawArgs;
		});

		await app.execute({ argv: ["--verbose", "--", "extra1", "extra2"] });

		expect(receivedRawArgs).toEqual(["extra1", "extra2"]);
	});

	it("intercept receives the resolved command and parsed input", async () => {
		let interceptedName = "";
		let interceptedFlags: Record<string, unknown> = {};

		const inspect = extension("inspect", {
			async intercept(ctx, next) {
				interceptedName = ctx.command.meta.name;
				interceptedFlags = { ...ctx.flags };
				await next();
			},
		});

		const app = new Crust("cli")
			.extend(inspect)
			.command("sub", (cmd) =>
				cmd.flags({ output: { type: "string", default: "stdout" } }).handle(() => {}),
			);

		await app.execute({ argv: ["sub", "--output", "file.txt"] });

		expect(interceptedName).toBe("sub");
		expect(interceptedFlags.output).toBe("file.txt");
	});

	it("intercept can short-circuit execution", async () => {
		let handlerRan = false;

		const gate = extension("short-circuit", {
			intercept: async (_ctx, _next) => {
				// Don't call next() — short circuit
			},
		});

		const app = new Crust("test").extend(gate).handle(() => {
			handlerRan = true;
		});

		await app.execute({ argv: [] });

		expect(handlerRan).toBe(false);
	});

	it("inherited flags work across file-boundary pattern", async () => {
		// Simulate split-file pattern: define subcommand callback as separate function
		let receivedVerbose: boolean | undefined;

		const defineSubCommand = (
			// oxlint-disable-next-line typescript/no-empty-object-type -- testing empty initial local state
			cmd: Crust<{ verbose: { type: "boolean"; inherit: true } }, {}, []>,
		) =>
			cmd.handle((ctx) => {
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
				cmd.handle((ctx) => {
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
				cmd.handle((ctx) => {
					receivedVerbose = ctx.flags.verbose;
				}),
			);

		await app.execute({ argv: ["sub", "-v"] });

		expect(receivedVerbose).toBe(true);
	});

	it("Extension apply error is rendered and sets exitCode", async () => {
		const clash = extension("clash", { flags: { verbose: { type: "boolean" } } });
		const app = new Crust("test")
			.flags({ verbose: { type: "boolean" } })
			.extend(clash)
			.handle(() => {});

		await app.execute({ argv: [] });

		expect(process.exitCode).toBe(1);
		expect(stderrChunks.join("\n")).toContain("collides");
	});

	it("treats intercept-time prompt cancellation as a silent user abort", async () => {
		const cancel = extension("cancel", {
			intercept: () => {
				throw new DOMException("Prompt was cancelled.", "AbortError");
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

		const app = new Crust("test").flags({ verbose: { type: "boolean" } }).handle((ctx) => {
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

	it("chaining .sub().flags().args().handle() works", () => {
		const app = new Crust("cli").flags({
			verbose: { type: "boolean", inherit: true },
		});

		const deploy = app
			.sub("deploy")
			.meta({ description: "Deploy something" })
			.flags({ env: { type: "string", required: true } })
			.args([{ name: "target", type: "string", required: true }])
			.handle(() => {});

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
			Equal<SubInherited["verbose"], { readonly type: "boolean"; readonly inherit: true }>
		>;

		// port has no inherit:true, but it's in the parent's Local, so it shows
		// up in EffectiveFlags at the type level (it goes through InheritableFlags
		// filtering when the sub's own child is created)
		type _checkPort = Expect<Equal<SubInherited["port"], { readonly type: "number" }>>;
	});

	it("sub builder starts with empty Local and Args", () => {
		const app = new Crust("cli").flags({
			verbose: { type: "boolean", inherit: true },
		});

		const sub = app.sub("deploy");

		type SubLocal = (typeof sub)["_types"]["local"];
		type SubArgs = (typeof sub)["_types"]["args"];

		// oxlint-disable-next-line typescript/no-empty-object-type -- verifying empty initial state
		type _checkLocal = Expect<Equal<SubLocal, {}>>;
		type _checkArgs = Expect<Equal<SubArgs, []>>;
	});

	it("inherited flags correctly typed in .handle() handler after .sub()", () => {
		const app = new Crust("cli").flags({
			verbose: { type: "boolean", inherit: true },
			port: { type: "number" },
		});

		app
			.sub("deploy")
			.flags({ env: { type: "string", required: true } })
			.handle((_ctx) => {
				type CtxFlags = typeof _ctx.flags;
				// verbose inherits (inherit: true)
				type _checkVerbose = Expect<Equal<CtxFlags["verbose"], boolean | undefined>>;
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
			Equal<L2Inherited["verbose"], { readonly type: "boolean"; readonly inherit: true }>
		>;
		// l1Flag cascades (inherit: true at l1 level)
		type _checkL1Flag = Expect<
			Equal<L2Inherited["l1Flag"], { readonly type: "string"; readonly inherit: true }>
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
		const deploy = app.sub("deploy").flags({ env: { type: "string", required: true } });

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

	it("both overloads can be mixed: .command(name, cb).command(builder)", () => {
		const app = new Crust("cli").flags({
			verbose: { type: "boolean", inherit: true },
		});
		const deploy = app.sub("deploy").handle(() => {});

		const result = app.command("status", (cmd) => cmd.handle(() => {})).command(deploy);

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
			.handle((ctx) => {
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

		const deployCmd = app.sub("deploy").flags({ env: { type: "string", inherit: true } });

		const statusCmd = deployCmd.sub("status").handle((ctx) => {
			receivedFlags = ctx.flags;
		});

		await app
			.command(deployCmd.command(statusCmd))
			.execute({ argv: ["deploy", "status", "--verbose", "--env", "prod"] });

		expect(receivedFlags.verbose).toBe(true);
		expect(receivedFlags.env).toBe("prod");
	});
});

describe("prepareCommandSnapshot (tooling)", () => {
	it("returns a frozen snapshot with Extension flags applied, without mutating the builder", async () => {
		const docs = extension("doc-test", {
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
// .command() aliases
// ──────────────────────────────────────────────────────────────────────────────

describe("Crust .command() aliases", () => {
	it("plumbs aliases from meta() into the registered subcommand node", () => {
		const app = new Crust("cli").command("issue", (cmd) =>
			cmd.meta({ aliases: ["issues", "i"] }).handle(() => {}),
		);
		expect(app._node.subCommands.issue?.meta.aliases).toEqual(["issues", "i"]);
	});

	it("registers without error when no sibling collides", () => {
		expect(() =>
			new Crust("cli")
				.command("issue", (cmd) => cmd.meta({ aliases: ["issues", "i"] }).handle(() => {}))
				.command("version", (cmd) => cmd.handle(() => {})),
		).not.toThrow();
	});

	it("throws DEFINITION when an alias collides with a sibling's canonical name", () => {
		const app = new Crust("cli").command("build", (cmd) => cmd.handle(() => {}));
		expect(() =>
			app.command("compile", (cmd) => cmd.meta({ aliases: ["build"] }).handle(() => {})),
		).toThrow(/collides with sibling canonical name "build"/);
	});

	it("throws DEFINITION when an alias collides with another sibling's alias", () => {
		const app = new Crust("cli").command("issue", (cmd) =>
			cmd.meta({ aliases: ["i"] }).handle(() => {}),
		);
		expect(() =>
			app.command("info", (cmd) => cmd.meta({ aliases: ["i"] }).handle(() => {})),
		).toThrow(/collides with alias of sibling "issue"/);
	});

	it("throws DEFINITION on the reverse-order case (new canonical equals an existing alias)", () => {
		const app = new Crust("cli").command("issue", (cmd) =>
			cmd.meta({ aliases: ["i"] }).handle(() => {}),
		);
		// Now try to register a *new* command whose canonical name == existing alias.
		expect(() => app.command("i", (cmd) => cmd.handle(() => {}))).toThrow(
			/canonical name "i" collides with alias of sibling "issue"/,
		);
	});

	it("throws DEFINITION on duplicate aliases within one subcommand's own list", () => {
		expect(() =>
			new Crust("cli").command("issue", (cmd) =>
				cmd.meta({ aliases: ["i", "i"] }).handle(() => {}),
			),
		).toThrow(/lists alias "i" more than once/);
	});

	it("throws DEFINITION on an alias equal to its own canonical name", () => {
		expect(() =>
			new Crust("cli").command("issue", (cmd) => cmd.meta({ aliases: ["issue"] }).handle(() => {})),
		).toThrow(/must not equal its own canonical name/);
	});

	it("throws DEFINITION on an empty alias", () => {
		expect(() =>
			new Crust("cli").command("issue", (cmd) => cmd.meta({ aliases: [""] }).handle(() => {})),
		).toThrow(/must be a non-empty string/);
	});

	it("throws DEFINITION on an alias containing whitespace", () => {
		expect(() =>
			new Crust("cli").command("issue", (cmd) =>
				cmd.meta({ aliases: ["my issue"] }).handle(() => {}),
			),
		).toThrow(/must not contain whitespace/);
	});

	it("throws DEFINITION on an alias starting with '-'", () => {
		expect(() =>
			new Crust("cli").command("issue", (cmd) => cmd.meta({ aliases: ["-i"] }).handle(() => {})),
		).toThrow(/must not start with "-"/);
	});

	it("applies the same checks on the .command(builder) path", () => {
		const issue = new Crust("issue").meta({ aliases: ["i"] }).handle(() => {});
		const conflicting = new Crust("info").meta({ aliases: ["i"] }).handle(() => {});

		const app = new Crust("cli").command(issue);
		expect(() => app.command(conflicting)).toThrow(/collides with alias of sibling "issue"/);
	});

	it("Extension command with a colliding alias is a DEFINITION error (no silent shadowing)", async () => {
		// Without this guard, an Extension could attach an alias that silently
		// changes routing for an existing user command.
		const rogue = extension("rogue", {
			commands: [new Crust("info").meta({ aliases: ["i"] }).handle(() => {})],
		});

		const app = new Crust("cli")
			.extend(rogue)
			.command("issue", (cmd) => cmd.meta({ aliases: ["i"] }).handle(() => {}));

		await expect(app.run(["i"])).rejects.toMatchObject({ code: "DEFINITION" });
	});
});
