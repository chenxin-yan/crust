import { describe, expect, it } from "bun:test";
import type {
	ArgDef,
	ArgsDef,
	CommandMeta,
	EffectiveFlags,
	FlagDef,
	FlagsDef,
	InferArgs,
	InferFlags,
	InheritableFlags,
	MergeFlags,
	ValidateCrossCollisions,
	ValidateFlagAliases,
	ValidateNoPrefixedFlags,
	ValidateVariadicArgs,
} from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Type-level test utilities
// ────────────────────────────────────────────────────────────────────────────

/**
 * Asserts that two types are exactly equal.
 * If they differ, the assignment will produce a TypeScript compile error.
 */
type Expect<T extends true> = T;
type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;

// ────────────────────────────────────────────────────────────────────────────
// InferArgs type-level tests
// ────────────────────────────────────────────────────────────────────────────

describe("InferArgs type inference", () => {
	it('maps basic "string" arg to string | undefined', () => {
		type Args = readonly [{ name: "name"; type: "string" }];
		type Result = InferArgs<Args>;
		type _check = Expect<Equal<Result, { name: string | undefined }>>;

		// Runtime assertion to make the test non-empty
		const val: Result = { name: undefined };
		expect(val).toBeDefined();
	});

	it('maps basic "number" arg to number | undefined', () => {
		type Args = readonly [{ name: "port"; type: "number" }];
		type Result = InferArgs<Args>;
		type _check = Expect<Equal<Result, { port: number | undefined }>>;

		const val: Result = { port: undefined };
		expect(val).toBeDefined();
	});

	it('maps basic "boolean" arg to boolean | undefined', () => {
		type Args = readonly [{ name: "flag"; type: "boolean" }];
		type Result = InferArgs<Args>;
		type _check = Expect<Equal<Result, { flag: boolean | undefined }>>;

		const val: Result = { flag: undefined };
		expect(val).toBeDefined();
	});

	it("maps required arg to non-optional type", () => {
		type Args = readonly [{ name: "name"; type: "string"; required: true }];
		type Result = InferArgs<Args>;
		type _check = Expect<Equal<Result, { name: string }>>;

		const val: Result = { name: "hello" };
		expect(val.name).toBe("hello");
	});

	it("maps arg with default to non-optional type", () => {
		type Args = readonly [{ name: "port"; type: "number"; default: 3000 }];
		type Result = InferArgs<Args>;
		type _check = Expect<Equal<Result, { port: number }>>;

		const val: Result = { port: 3000 };
		expect(val.port).toBe(3000);
	});

	it("maps variadic arg to array type", () => {
		type Args = readonly [{ name: "files"; type: "string"; variadic: true }];
		type Result = InferArgs<Args>;
		type _check = Expect<Equal<Result, { files: string[] }>>;

		const val: Result = { files: ["a.ts", "b.ts"] };
		expect(val.files).toEqual(["a.ts", "b.ts"]);
	});

	it('maps variadic "number" arg to number[]', () => {
		type Args = readonly [{ name: "ports"; type: "number"; variadic: true }];
		type Result = InferArgs<Args>;
		type _check = Expect<Equal<Result, { ports: number[] }>>;

		const val: Result = { ports: [3000, 4000] };
		expect(val.ports).toEqual([3000, 4000]);
	});

	it("maps multiple args together", () => {
		type Args = readonly [
			{ name: "name"; type: "string"; required: true },
			{ name: "port"; type: "number"; default: 3000 },
			{ name: "verbose"; type: "boolean" },
			{ name: "files"; type: "string"; variadic: true },
		];
		type Result = InferArgs<Args>;
		type _check = Expect<
			Equal<
				Result,
				{
					name: string;
					port: number;
					verbose: boolean | undefined;
					files: string[];
				}
			>
		>;

		const val: Result = {
			name: "test",
			port: 8080,
			verbose: undefined,
			files: [],
		};
		expect(val).toBeDefined();
	});

	it("returns Record<string, never> for non-ArgsDef input", () => {
		type Result = InferArgs<undefined>;
		type _check = Expect<Equal<Result, Record<string, never>>>;
		expect(true).toBe(true);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// InferFlags type-level tests
// ────────────────────────────────────────────────────────────────────────────

describe("InferFlags type inference", () => {
	it('maps basic "string" flag to string | undefined', () => {
		type Flags = { output: { type: "string" } };
		type Result = InferFlags<Flags>;
		type _check = Expect<Equal<Result, { output: string | undefined }>>;

		const val: Result = { output: undefined };
		expect(val).toBeDefined();
	});

	it('maps basic "boolean" flag to boolean | undefined', () => {
		type Flags = { verbose: { type: "boolean" } };
		type Result = InferFlags<Flags>;
		type _check = Expect<Equal<Result, { verbose: boolean | undefined }>>;

		const val: Result = { verbose: undefined };
		expect(val).toBeDefined();
	});

	it("maps required flag to non-optional type", () => {
		type Flags = { name: { type: "string"; required: true } };
		type Result = InferFlags<Flags>;
		type _check = Expect<Equal<Result, { name: string }>>;

		const val: Result = { name: "test" };
		expect(val.name).toBe("test");
	});

	it("maps flag with default to non-optional type", () => {
		type Flags = { port: { type: "number"; default: 8080 } };
		type Result = InferFlags<Flags>;
		type _check = Expect<Equal<Result, { port: number }>>;

		const val: Result = { port: 8080 };
		expect(val.port).toBe(8080);
	});

	it("maps multiple flags together", () => {
		type Flags = {
			verbose: { type: "boolean" };
			port: { type: "number"; default: 3000 };
			output: { type: "string"; required: true };
		};
		type Result = InferFlags<Flags>;
		type _check = Expect<
			Equal<
				Result,
				{
					verbose: boolean | undefined;
					port: number;
					output: string;
				}
			>
		>;

		const val: Result = { verbose: undefined, port: 3000, output: "dist" };
		expect(val).toBeDefined();
	});

	it("returns Record<string, never> for non-FlagsDef input", () => {
		type Result = InferFlags<undefined>;
		type _check = Expect<Equal<Result, Record<string, never>>>;
		expect(true).toBe(true);
	});

	it('maps multiple "string" flag to string[] | undefined', () => {
		type Flags = { file: { type: "string"; multiple: true } };
		type Result = InferFlags<Flags>;
		type _check = Expect<Equal<Result, { file: string[] | undefined }>>;

		const val: Result = { file: undefined };
		expect(val).toBeDefined();
	});

	it('maps multiple "number" flag with required to number[]', () => {
		type Flags = {
			port: { type: "number"; multiple: true; required: true };
		};
		type Result = InferFlags<Flags>;
		type _check = Expect<Equal<Result, { port: number[] }>>;

		const val: Result = { port: [80, 443] };
		expect(val.port).toEqual([80, 443]);
	});

	it('maps multiple "boolean" flag to boolean[] | undefined', () => {
		type Flags = { verbose: { type: "boolean"; multiple: true } };
		type Result = InferFlags<Flags>;
		type _check = Expect<Equal<Result, { verbose: boolean[] | undefined }>>;

		const val: Result = { verbose: [true, true] };
		expect(val).toBeDefined();
	});

	it("maps multiple flag with default to non-optional array type", () => {
		type Flags = {
			file: {
				type: "string";
				multiple: true;
				default: ["default.ts"];
			};
		};
		type Result = InferFlags<Flags>;
		type _check = Expect<Equal<Result, { file: string[] }>>;

		const val: Result = { file: ["default.ts"] };
		expect(val.file).toEqual(["default.ts"]);
	});

	it("maps mixed multiple and non-multiple flags together", () => {
		type Flags = {
			file: { type: "string"; multiple: true };
			verbose: { type: "boolean" };
			port: { type: "number"; multiple: true; required: true };
		};
		type Result = InferFlags<Flags>;
		type _check = Expect<
			Equal<
				Result,
				{
					file: string[] | undefined;
					verbose: boolean | undefined;
					port: number[];
				}
			>
		>;

		const val: Result = {
			file: undefined,
			verbose: undefined,
			port: [80],
		};
		expect(val).toBeDefined();
	});
});

// ────────────────────────────────────────────────────────────────────────────
// ArgDef / FlagDef interface tests
// ────────────────────────────────────────────────────────────────────────────

describe("ArgDef interface", () => {
	it("accepts valid arg definitions", () => {
		const stringArg: ArgDef = { name: "str", type: "string" };
		const numberArg: ArgDef = { name: "port", type: "number", default: 3000 };
		const boolArg: ArgDef = {
			name: "flag",
			type: "boolean",
			description: "A flag",
			required: true,
		};
		const variadicArg: ArgDef = {
			name: "files",
			type: "string",
			variadic: true,
		};

		expect(stringArg.type).toBe("string");
		expect(numberArg.default).toBe(3000);
		expect(boolArg.required).toBe(true);
		expect(variadicArg.variadic).toBe(true);
	});

	it("allows ArgsDef array", () => {
		const args: ArgsDef = [
			{ name: "name", type: "string", required: true },
			{ name: "port", type: "number", default: 3000 },
			{ name: "files", type: "string", variadic: true },
		];

		expect(args.map((a) => a.name)).toEqual(["name", "port", "files"]);
	});
});

describe("FlagDef interface", () => {
	it("accepts valid flag definitions", () => {
		const boolFlag: FlagDef = { type: "boolean", short: "v" };
		const stringFlag: FlagDef = {
			type: "string",
			short: "o",
			aliases: ["out"],
			required: true,
		};
		const numberFlag: FlagDef = { type: "number", default: 8080 };
		const multipleFlag: FlagDef = { type: "string", multiple: true };

		expect(boolFlag.short).toBe("v");
		expect(stringFlag.required).toBe(true);
		expect(numberFlag.default).toBe(8080);
		expect(multipleFlag.multiple).toBe(true);
	});

	it("allows FlagsDef record", () => {
		const flags: FlagsDef = {
			verbose: { type: "boolean", short: "v" },
			port: { type: "number", default: 3000, description: "Port number" },
		};

		expect(Object.keys(flags)).toEqual(["verbose", "port"]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// ArgDef / FlagDef discriminated union narrowing tests
// ────────────────────────────────────────────────────────────────────────────

describe("ArgDef discriminated union narrowing", () => {
	it("rejects default type mismatch", () => {
		// @ts-expect-error — default must be number when type is "number"
		const _bad1: ArgDef = { name: "port", type: "number", default: "oops" };

		// @ts-expect-error — default must be string when type is "string"
		const _bad2: ArgDef = { name: "name", type: "string", default: 42 };

		// @ts-expect-error — default must be boolean when type is "boolean"
		const _bad3: ArgDef = { name: "flag", type: "boolean", default: "yes" };

		expect(true).toBe(true);
	});
});

describe("FlagDef discriminated union narrowing", () => {
	it("rejects default type mismatch for single-value flags", () => {
		// @ts-expect-error — default must be number when type is "number"
		const _bad1: FlagDef = { type: "number", default: "oops" };

		// @ts-expect-error — default must be string when type is "string"
		const _bad2: FlagDef = { type: "string", default: 123 };

		// @ts-expect-error — default must be boolean when type is "boolean"
		const _bad3: FlagDef = { type: "boolean", default: "yes" };

		expect(true).toBe(true);
	});

	it("rejects scalar default for multi-value flags", () => {
		// @ts-expect-error — default must be string[] when multiple is true
		const _bad1: FlagDef = {
			type: "string",
			multiple: true,
			default: "scalar",
		};

		// @ts-expect-error — default must be number[] when multiple is true
		const _bad2: FlagDef = { type: "number", multiple: true, default: 42 };

		expect(true).toBe(true);
	});

	it("rejects array default for single-value flags", () => {
		// @ts-expect-error — default must be string, not string[], for single-value
		const _bad1: FlagDef = { type: "string", default: ["a", "b"] };

		// @ts-expect-error — default must be number, not number[], for single-value
		const _bad2: FlagDef = { type: "number", default: [1, 2] };

		expect(true).toBe(true);
	});

	it("rejects cross-type array defaults for multi-value flags", () => {
		// @ts-expect-error — default must be number[], not string[]
		const _bad1: FlagDef = { type: "number", multiple: true, default: ["a"] };

		// @ts-expect-error — default must be boolean[], not number[]
		const _bad2: FlagDef = { type: "boolean", multiple: true, default: [1, 2] };

		expect(true).toBe(true);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// ArgDef / FlagDef toggle field tests
// ────────────────────────────────────────────────────────────────────────────

describe("ArgDef toggle fields", () => {
	it("accepts true for toggle fields", () => {
		const _req: ArgDef = { name: "a", type: "string", required: true };
		const _var: ArgDef = { name: "b", type: "string", variadic: true };
		expect(_req.required).toBe(true);
		expect(_var.variadic).toBe(true);
	});

	it("rejects false for toggle fields", () => {
		// @ts-expect-error — toggle fields only accept `true`, not `false`
		const _bad1: ArgDef = { name: "a", type: "string", required: false };

		// @ts-expect-error — toggle fields only accept `true`, not `false`
		const _bad2: ArgDef = { name: "a", type: "string", variadic: false };

		expect(true).toBe(true);
	});

	it("rejects non-boolean values for toggle fields", () => {
		// @ts-expect-error — toggle fields only accept `true`, not string
		const _bad1: ArgDef = { name: "a", type: "string", required: "yes" };

		// @ts-expect-error — toggle fields only accept `true`, not number
		const _bad2: ArgDef = { name: "a", type: "string", variadic: 1 };

		expect(true).toBe(true);
	});
});

describe("FlagDef toggle fields", () => {
	it("accepts true for toggle fields", () => {
		const _req: FlagDef = { type: "string", required: true };
		const _multi: FlagDef = { type: "string", multiple: true };
		expect(_req.required).toBe(true);
		expect(_multi.multiple).toBe(true);
	});

	it("rejects false for toggle fields", () => {
		// @ts-expect-error — toggle fields only accept `true`, not `false`
		const _bad1: FlagDef = { type: "string", required: false };

		// @ts-expect-error — toggle fields only accept `true`, not `false`
		const _bad2: FlagDef = { type: "string", multiple: false };

		expect(true).toBe(true);
	});

	it("rejects non-boolean values for toggle fields", () => {
		// @ts-expect-error — toggle fields only accept `true`, not string
		const _bad1: FlagDef = { type: "string", required: "yes" };

		// @ts-expect-error — toggle fields only accept `true`, not number
		const _bad2: FlagDef = { type: "string", multiple: 1 };

		expect(true).toBe(true);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// CommandMeta / Command tests
// ────────────────────────────────────────────────────────────────────────────

describe("CommandMeta interface", () => {
	it("accepts valid metadata", () => {
		const meta: CommandMeta = {
			name: "serve",
			description: "Start dev server",
			usage: "serve [options]",
			hidden: true,
		};

		expect(meta.name).toBe("serve");
		expect(meta.hidden).toBe(true);
	});

	it("only requires name", () => {
		const meta: CommandMeta = { name: "serve" };
		expect(meta.name).toBe("serve");
	});
});

// NOTE: Command, AnyCommand, CommandDef, and CommandContext interfaces have
// been removed as part of the old API cleanup. Tests for the new builder API
// live in crust.test.ts. CrustCommandContext (the replacement for
// CommandContext) is tested there as well.

// ────────────────────────────────────────────────────────────────────────────
// ValidateFlagAliases type-level tests
// ────────────────────────────────────────────────────────────────────────────

describe("ValidateFlagAliases type inference", () => {
	it("resolves to identity when no aliases collide with flag names", () => {
		type Flags = {
			output: { type: "string"; short: "o" };
			verbose: { type: "boolean"; short: "v" };
		};
		type Result = ValidateFlagAliases<Flags>;
		type _check = Expect<Equal<Result, Flags>>;

		expect(true).toBe(true);
	});

	it("resolves to identity when no aliases are defined", () => {
		type Flags = {
			verbose: { type: "boolean" };
			port: { type: "number" };
		};
		type Result = ValidateFlagAliases<Flags>;
		type _check = Expect<Equal<Result, Flags>>;

		expect(true).toBe(true);
	});

	it("brands only the offending flag when a long alias shadows a flag name", () => {
		type Flags = {
			out: { type: "string" };
			output: { type: "string"; short: "o"; aliases: ["out"] };
		};
		type Result = ValidateFlagAliases<Flags>;
		// "out" flag is innocent — its name was shadowed, not its alias
		type _checkOut = Expect<Equal<Result["out"], Flags["out"]>>;
		// "output" flag gets the branded error
		type _checkOutput = Expect<
			Equal<
				Result["output"],
				Flags["output"] & {
					readonly FIX_ALIAS_COLLISION: 'Alias "out" collides with another flag name or alias';
				}
			>
		>;

		expect(true).toBe(true);
	});

	it("brands both flags when two flags share the same alias", () => {
		type Flags = {
			verbose: { type: "boolean"; short: "v" };
			version: { type: "boolean"; short: "v" };
		};
		type Result = ValidateFlagAliases<Flags>;
		type _checkVerbose = Expect<
			Equal<
				Result["verbose"],
				Flags["verbose"] & {
					readonly FIX_ALIAS_COLLISION: 'Alias "v" collides with another flag name or alias';
				}
			>
		>;
		type _checkVersion = Expect<
			Equal<
				Result["version"],
				Flags["version"] & {
					readonly FIX_ALIAS_COLLISION: 'Alias "v" collides with another flag name or alias';
				}
			>
		>;

		expect(true).toBe(true);
	});

	it("resolves to identity for single-char aliases that don't match flag names", () => {
		type Flags = {
			verbose: { type: "boolean"; short: "v" };
			port: { type: "number"; short: "p" };
			output: { type: "string"; short: "o" };
		};
		type Result = ValidateFlagAliases<Flags>;
		type _check = Expect<Equal<Result, Flags>>;

		expect(true).toBe(true);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// ValidateCrossCollisions type-level tests
// ────────────────────────────────────────────────────────────────────────────

describe("ValidateCrossCollisions type inference", () => {
	it("resolves to identity when no cross-collisions exist", () => {
		type Inherited = {
			verbose: { type: "boolean"; inherit: true; short: "v" };
		};
		type Local = {
			output: { type: "string"; short: "o" };
		};
		type Result = ValidateCrossCollisions<Inherited, Local>;
		type _check = Expect<Equal<Result, Local>>;

		expect(true).toBe(true);
	});

	it("brands flag whose alias collides with inherited flag name", () => {
		type Inherited = {
			verbose: { type: "boolean"; inherit: true };
		};
		type Local = {
			output: { type: "string"; aliases: ["verbose"] };
		};
		type Result = ValidateCrossCollisions<Inherited, Local>;
		type _check = Expect<
			Equal<
				Result["output"],
				Local["output"] & {
					readonly FIX_INHERITED_COLLISION: '"verbose" collides with inherited flag';
				}
			>
		>;

		expect(true).toBe(true);
	});

	it("brands flag whose alias collides with inherited flag alias", () => {
		type Inherited = {
			verbose: { type: "boolean"; inherit: true; short: "v" };
		};
		type Local = {
			version: { type: "boolean"; short: "v" };
		};
		type Result = ValidateCrossCollisions<Inherited, Local>;
		type _check = Expect<
			Equal<
				Result["version"],
				Local["version"] & {
					readonly FIX_INHERITED_COLLISION: '"v" collides with inherited flag';
				}
			>
		>;

		expect(true).toBe(true);
	});

	it("brands flag whose name collides with inherited flag alias", () => {
		type Inherited = {
			verbose: { type: "boolean"; inherit: true; short: "v" };
		};
		type Local = {
			v: { type: "string" };
		};
		type Result = ValidateCrossCollisions<Inherited, Local>;
		type _check = Expect<
			Equal<
				Result["v"],
				Local["v"] & {
					readonly FIX_INHERITED_COLLISION: '"v" collides with inherited flag';
				}
			>
		>;

		expect(true).toBe(true);
	});

	it("allows intentional name override (child redefines inherited flag by name)", () => {
		type Inherited = {
			verbose: { type: "boolean"; inherit: true; short: "v" };
		};
		type Local = {
			verbose: { type: "string" };
		};
		type Result = ValidateCrossCollisions<Inherited, Local>;
		type _check = Expect<Equal<Result, Local>>;

		expect(true).toBe(true);
	});

	it("skips validation when Inherited is the wide FlagsDef type (root command)", () => {
		type Local = {
			output: { type: "string"; aliases: ["verbose"] };
		};
		type Result = ValidateCrossCollisions<FlagsDef, Local>;
		type _check = Expect<Equal<Result, Local>>;

		expect(true).toBe(true);
	});

	it("resolves to identity for empty inherited flags", () => {
		// biome-ignore lint/complexity/noBannedTypes: empty object for testing
		type Inherited = {};
		type Local = {
			output: { type: "string"; short: "o" };
		};
		type Result = ValidateCrossCollisions<Inherited, Local>;
		type _check = Expect<Equal<Result, Local>>;

		expect(true).toBe(true);
	});

	it("detects collision with inherited alias array entry", () => {
		type Inherited = {
			output: { type: "string"; inherit: true; short: "o"; aliases: ["out"] };
		};
		type Local = {
			other: { type: "string"; aliases: ["out"] };
		};
		type Result = ValidateCrossCollisions<Inherited, Local>;
		type _check = Expect<
			Equal<
				Result["other"],
				Local["other"] & {
					readonly FIX_INHERITED_COLLISION: '"out" collides with inherited flag';
				}
			>
		>;

		expect(true).toBe(true);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// ValidateVariadicArgs type-level tests
// ────────────────────────────────────────────────────────────────────────────

describe("ValidateVariadicArgs type inference", () => {
	it("resolves to identity when variadic is the last arg", () => {
		type Args = readonly [
			{ name: "name"; type: "string"; required: true },
			{ name: "files"; type: "string"; variadic: true },
		];
		type Result = ValidateVariadicArgs<Args>;
		type _check = Expect<Equal<Result, Args>>;

		expect(true).toBe(true);
	});

	it("resolves to identity when no args are variadic", () => {
		type Args = readonly [
			{ name: "name"; type: "string"; required: true },
			{ name: "port"; type: "number"; default: 3000 },
		];
		type Result = ValidateVariadicArgs<Args>;
		type _check = Expect<Equal<Result, Args>>;

		expect(true).toBe(true);
	});

	it("brands the specific non-last arg that is variadic", () => {
		type Args = readonly [
			{ name: "files"; type: "string"; variadic: true },
			{ name: "name"; type: "string"; required: true },
		];
		type Result = ValidateVariadicArgs<Args>;
		// First arg (variadic, non-last) gets branded error
		type _checkFirst = Expect<
			Equal<
				Result[0],
				Args[0] & {
					readonly FIX_VARIADIC_POSITION: "Only the last positional argument can be variadic";
				}
			>
		>;
		// Second arg (last) is unchanged
		type _checkSecond = Expect<Equal<Result[1], Args[1]>>;

		expect(true).toBe(true);
	});

	it("resolves to identity for a single arg", () => {
		type Args = readonly [{ name: "file"; type: "string"; variadic: true }];
		type Result = ValidateVariadicArgs<Args>;
		type _check = Expect<Equal<Result, Args>>;

		expect(true).toBe(true);
	});

	it("resolves to identity for empty args", () => {
		type Args = readonly [];
		type Result = ValidateVariadicArgs<Args>;
		type _check = Expect<Equal<Result, Args>>;

		expect(true).toBe(true);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// ValidateNoPrefixedFlags type-level tests
// ────────────────────────────────────────────────────────────────────────────

describe("ValidateNoPrefixedFlags type inference", () => {
	it("resolves to identity when no flag names or aliases start with no-", () => {
		type Flags = {
			cache: { type: "boolean" };
			verbose: { type: "boolean"; short: "v" };
			output: { type: "string"; short: "o"; aliases: ["out"] };
		};
		type Result = ValidateNoPrefixedFlags<Flags>;
		type _check = Expect<Equal<Result, Flags>>;

		expect(true).toBe(true);
	});

	it("resolves to identity when no aliases are defined", () => {
		type Flags = {
			verbose: { type: "boolean" };
			port: { type: "number" };
		};
		type Result = ValidateNoPrefixedFlags<Flags>;
		type _check = Expect<Equal<Result, Flags>>;

		expect(true).toBe(true);
	});

	it("brands flag whose name starts with no-", () => {
		type Flags = {
			"no-cache": { type: "boolean" };
			verbose: { type: "boolean" };
		};
		type Result = ValidateNoPrefixedFlags<Flags>;
		// "verbose" is clean
		type _checkVerbose = Expect<Equal<Result["verbose"], Flags["verbose"]>>;
		// "no-cache" gets branded
		type _checkNoCache = Expect<
			Equal<
				Result["no-cache"],
				Flags["no-cache"] & {
					readonly FIX_NO_PREFIX: 'Flag name "no-cache" must not start with "no-"; define "cache" instead and use "--no-cache" at runtime';
				}
			>
		>;

		expect(true).toBe(true);
	});

	it("brands flag whose string alias starts with no-", () => {
		type Flags = {
			cache: { type: "boolean"; aliases: ["no-store"] };
		};
		type Result = ValidateNoPrefixedFlags<Flags>;
		type _check = Expect<
			Equal<
				Result["cache"],
				Flags["cache"] & {
					readonly FIX_NO_PREFIX: 'Alias "no-store" must not start with "no-"; the "no-" prefix is reserved for boolean negation';
				}
			>
		>;

		expect(true).toBe(true);
	});

	it("brands flag whose alias array contains a no- prefixed entry", () => {
		type Flags = {
			cache: { type: "boolean"; short: "c"; aliases: ["no-store"] };
		};
		type Result = ValidateNoPrefixedFlags<Flags>;
		type _check = Expect<
			Equal<
				Result["cache"],
				Flags["cache"] & {
					readonly FIX_NO_PREFIX: 'Alias "no-store" must not start with "no-"; the "no-" prefix is reserved for boolean negation';
				}
			>
		>;

		expect(true).toBe(true);
	});

	it("allows short aliases (single char) without branding", () => {
		type Flags = {
			verbose: { type: "boolean"; short: "v" };
		};
		type Result = ValidateNoPrefixedFlags<Flags>;
		type _check = Expect<Equal<Result, Flags>>;

		expect(true).toBe(true);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// InheritableFlags type-level tests
// ────────────────────────────────────────────────────────────────────────────

describe("InheritableFlags type inference", () => {
	it("picks only flags with inherit: true", () => {
		type Flags = {
			verbose: { type: "boolean"; inherit: true };
			port: { type: "number" };
			output: { type: "string"; inherit: true };
		};
		type Result = InheritableFlags<Flags>;
		type _check = Expect<
			Equal<
				Result,
				{
					verbose: { type: "boolean"; inherit: true };
					output: { type: "string"; inherit: true };
				}
			>
		>;

		expect(true).toBe(true);
	});

	it("returns empty object when no flags have inherit: true", () => {
		type Flags = {
			verbose: { type: "boolean" };
			port: { type: "number" };
		};
		type Result = InheritableFlags<Flags>;
		// biome-ignore lint/complexity/noBannedTypes: empty object is the expected result
		type _check = Expect<Equal<Result, {}>>;

		expect(true).toBe(true);
	});

	it("returns empty object for empty flags", () => {
		// biome-ignore lint/complexity/noBannedTypes: empty object is the expected result
		type Result = InheritableFlags<{}>;
		// biome-ignore lint/complexity/noBannedTypes: empty object is the expected result
		type _check = Expect<Equal<Result, {}>>;

		expect(true).toBe(true);
	});

	it("picks all flags when all have inherit: true", () => {
		type Flags = {
			verbose: { type: "boolean"; inherit: true };
			port: { type: "number"; inherit: true };
		};
		type Result = InheritableFlags<Flags>;
		type _check = Expect<Equal<Result, Flags>>;

		expect(true).toBe(true);
	});

	it("preserves full flag definition including short, required, etc.", () => {
		type Flags = {
			verbose: {
				type: "boolean";
				inherit: true;
				short: "v";
				description: "Enable verbose";
			};
		};
		type Result = InheritableFlags<Flags>;
		type _check = Expect<Equal<Result, Flags>>;

		expect(true).toBe(true);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// MergeFlags type-level tests
// ────────────────────────────────────────────────────────────────────────────

describe("MergeFlags type inference", () => {
	it("merges parent and local flags", () => {
		type Parent = {
			verbose: { type: "boolean" };
			port: { type: "number" };
		};
		type Local = {
			output: { type: "string" };
		};
		type Result = MergeFlags<Parent, Local>;
		type _check = Expect<
			Equal<
				Result,
				{
					verbose: { type: "boolean" };
					port: { type: "number" };
					output: { type: "string" };
				}
			>
		>;

		expect(true).toBe(true);
	});

	it("local overrides parent when keys conflict", () => {
		type Parent = {
			verbose: { type: "boolean" };
			port: { type: "number" };
		};
		type Local = {
			port: { type: "string" };
		};
		type Result = MergeFlags<Parent, Local>;
		type _check = Expect<
			Equal<
				Result,
				{
					verbose: { type: "boolean" };
					port: { type: "string" };
				}
			>
		>;

		expect(true).toBe(true);
	});

	it("returns parent when local is empty", () => {
		type Parent = {
			verbose: { type: "boolean" };
		};
		// biome-ignore lint/complexity/noBannedTypes: empty object for testing
		type Result = MergeFlags<Parent, {}>;
		type _check = Expect<Equal<Result, { verbose: { type: "boolean" } }>>;

		expect(true).toBe(true);
	});

	it("returns local when parent is empty", () => {
		type Local = {
			output: { type: "string" };
		};
		// biome-ignore lint/complexity/noBannedTypes: empty object for testing
		type Result = MergeFlags<{}, Local>;
		type _check = Expect<Equal<Result, { output: { type: "string" } }>>;

		expect(true).toBe(true);
	});

	it("returns empty when both are empty", () => {
		// biome-ignore lint/complexity/noBannedTypes: empty object for testing
		type Result = MergeFlags<{}, {}>;
		// biome-ignore lint/complexity/noBannedTypes: empty object is the expected result
		type _check = Expect<Equal<Result, {}>>;

		expect(true).toBe(true);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// EffectiveFlags type-level tests
// ────────────────────────────────────────────────────────────────────────────

describe("EffectiveFlags type inference", () => {
	it("filters inherited to inherit:true and merges with local", () => {
		type Inherited = {
			verbose: { type: "boolean"; inherit: true };
			port: { type: "number" };
		};
		type Local = {
			output: { type: "string" };
		};
		type Result = EffectiveFlags<Inherited, Local>;
		type _check = Expect<
			Equal<
				Result,
				{
					verbose: { type: "boolean"; inherit: true };
					output: { type: "string" };
				}
			>
		>;

		expect(true).toBe(true);
	});

	it("local overrides inherited flag with same key", () => {
		type Inherited = {
			verbose: { type: "boolean"; inherit: true };
			port: { type: "number"; inherit: true };
		};
		type Local = {
			port: { type: "string" };
		};
		type Result = EffectiveFlags<Inherited, Local>;
		type _check = Expect<
			Equal<
				Result,
				{
					verbose: { type: "boolean"; inherit: true };
					port: { type: "string" };
				}
			>
		>;

		expect(true).toBe(true);
	});

	it("returns only local when no inherited flags have inherit: true", () => {
		type Inherited = {
			verbose: { type: "boolean" };
			port: { type: "number" };
		};
		type Local = {
			output: { type: "string" };
		};
		type Result = EffectiveFlags<Inherited, Local>;
		type _check = Expect<Equal<Result, { output: { type: "string" } }>>;

		expect(true).toBe(true);
	});

	it("returns only inheritable flags when local is empty", () => {
		type Inherited = {
			verbose: { type: "boolean"; inherit: true };
			port: { type: "number" };
		};
		// biome-ignore lint/complexity/noBannedTypes: empty object for testing
		type Result = EffectiveFlags<Inherited, {}>;
		type _check = Expect<
			Equal<Result, { verbose: { type: "boolean"; inherit: true } }>
		>;

		expect(true).toBe(true);
	});

	it("returns empty when both inherited and local are empty", () => {
		// biome-ignore lint/complexity/noBannedTypes: empty object for testing
		type Result = EffectiveFlags<{}, {}>;
		// biome-ignore lint/complexity/noBannedTypes: empty object is the expected result
		type _check = Expect<Equal<Result, {}>>;

		expect(true).toBe(true);
	});

	it("short-circuits to local when inherited is wide FlagsDef", () => {
		type Local = {
			output: { type: "string" };
		};
		type Result = EffectiveFlags<FlagsDef, Local>;
		type _check = Expect<Equal<Result, Local>>;

		expect(true).toBe(true);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// FlagDef inherit toggle field tests
// ────────────────────────────────────────────────────────────────────────────

describe("FlagDef inherit toggle field", () => {
	it("accepts inherit: true on flag definitions", () => {
		const flag: FlagDef = { type: "boolean", inherit: true };
		expect(flag.inherit).toBe(true);
	});

	it("accepts inherit: true alongside other fields", () => {
		const flag: FlagDef = {
			type: "string",
			inherit: true,
			short: "v",
			required: true,
		};
		expect(flag.inherit).toBe(true);
		expect(flag.required).toBe(true);
	});

	it("accepts inherit: true on multi-value flags", () => {
		const flag: FlagDef = {
			type: "string",
			multiple: true,
			inherit: true,
		};
		expect(flag.inherit).toBe(true);
		expect(flag.multiple).toBe(true);
	});

	it("rejects inherit: false at type level", () => {
		// @ts-expect-error — toggle fields only accept `true`, not `false`
		const _bad: FlagDef = { type: "boolean", inherit: false };
		expect(true).toBe(true);
	});

	it("rejects non-boolean values for inherit", () => {
		// @ts-expect-error — toggle fields only accept `true`, not string
		const _bad: FlagDef = { type: "boolean", inherit: "yes" };
		expect(true).toBe(true);
	});
});
