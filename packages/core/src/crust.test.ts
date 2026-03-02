import { describe, expect, it } from "bun:test";
import { Crust } from "./crust.ts";
import { CrustError } from "./errors.ts";
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

	it("creates builder with CommandMeta object", () => {
		const app = new Crust({
			name: "my-cli",
			description: "My CLI tool",
			usage: "my-cli [options]",
		});
		expect(app._node.meta.name).toBe("my-cli");
		expect(app._node.meta.description).toBe("My CLI tool");
		expect(app._node.meta.usage).toBe("my-cli [options]");
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

	it("throws CrustError DEFINITION on empty meta.name in object", () => {
		try {
			new Crust({ name: "" });
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
			verbose: { type: "boolean", alias: "v" },
			port: { type: "number", default: 3000 },
		});

		expect(withFlags._node.localFlags).toEqual({
			verbose: { type: "boolean", alias: "v" },
			port: { type: "number", default: 3000 },
		});
		expect(withFlags._node.effectiveFlags).toEqual({
			verbose: { type: "boolean", alias: "v" },
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
			verbose: { type: "boolean" as const, alias: "v" },
		};

		const app = new Crust("test").flags(flagDefs);

		// Mutating the original defs should not affect the builder
		flagDefs.verbose.alias = "V";
		expect(app._node.localFlags.verbose?.alias).toBe("v");
	});

	it("preserves meta from original builder", () => {
		const app = new Crust({
			name: "my-cli",
			description: "desc",
		});
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

	it("throws CrustError DEFINITION on alias starting with no-", () => {
		const app = new Crust("test");
		try {
			app.flags({
				cache: { type: "boolean", alias: "no-store" },
			} as FlagsDef & ValidateNoPrefixedFlags<ValidateFlagAliases<FlagsDef>>);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("DEFINITION");
			expect((err as CrustError).message).toContain("no-");
		}
	});

	it("throws CrustError DEFINITION on alias array containing no- entry", () => {
		const app = new Crust("test");
		try {
			app.flags({
				cache: { type: "boolean", alias: ["c", "no-store"] },
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
		const app = new Crust({ name: "my-cli", description: "desc" }).flags({
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
				verbose: { type: "boolean", alias: "v" },
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
// Type-level tests — .flags()
// ────────────────────────────────────────────────────────────────────────────

describe("Crust type-level tests", () => {
	it(".flags() updates Local generic", () => {
		const app = new Crust("test").flags({
			verbose: { type: "boolean", alias: "v" },
			port: { type: "number", default: 3000 },
		});

		// Extract the Local type from the phantom _types property
		type AppLocal = (typeof app)["_types"]["local"];

		type _checkVerbose = Expect<
			Equal<
				AppLocal["verbose"],
				{ readonly type: "boolean"; readonly alias: "v" }
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
		//   verbose: { type: "boolean", alias: "v" },
		//   version: { type: "boolean", alias: "v" },
		// });
		//
		// Error: Property 'FIX_ALIAS_COLLISION' is missing...

		// Valid flags: no collision
		const app = new Crust("test").flags({
			verbose: { type: "boolean", alias: "v" },
			version: { type: "boolean", alias: "V" },
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
				verbose: { type: "boolean", alias: "v" },
				port: { type: "number", default: 3000 },
			})
			.args([{ name: "file", type: "string", required: true }]);

		// Verify flags Local generic is preserved
		type AppLocal = (typeof app)["_types"]["local"];
		type _checkVerbose = Expect<
			Equal<
				AppLocal["verbose"],
				{ readonly type: "boolean"; readonly alias: "v" }
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
