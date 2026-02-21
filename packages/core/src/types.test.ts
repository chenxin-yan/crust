import { describe, expect, it } from "bun:test";
import type {
	ArgDef,
	ArgsDef,
	Command,
	CommandContext,
	CommandMeta,
	FlagDef,
	FlagsDef,
	InferArgs,
	InferFlags,
	ValidateFlagAliases,
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
		const boolFlag: FlagDef = { type: "boolean", alias: "v" };
		const stringFlag: FlagDef = {
			type: "string",
			alias: ["o", "out"],
			required: true,
		};
		const numberFlag: FlagDef = { type: "number", default: 8080 };
		const multipleFlag: FlagDef = { type: "string", multiple: true };

		expect(boolFlag.alias).toBe("v");
		expect(stringFlag.required).toBe(true);
		expect(numberFlag.default).toBe(8080);
		expect(multipleFlag.multiple).toBe(true);
	});

	it("allows FlagsDef record", () => {
		const flags: FlagsDef = {
			verbose: { type: "boolean", alias: "v" },
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
		};

		expect(meta.name).toBe("serve");
	});

	it("only requires name", () => {
		const meta: CommandMeta = { name: "serve" };
		expect(meta.name).toBe("serve");
	});
});

describe("Command interface", () => {
	it("accepts a minimal definition (meta only)", () => {
		const cmd: Command = {
			meta: { name: "test" },
		};
		expect(cmd.meta.name).toBe("test");
	});

	it("accepts a full definition with args, flags, and lifecycle hooks", () => {
		const cmd: Command = {
			meta: { name: "serve", description: "Start server" },
			args: [{ name: "path", type: "string", required: true }],
			flags: {
				port: { type: "number", default: 3000 },
				verbose: { type: "boolean", alias: "v" },
			},
			preRun: (_ctx) => {
				/* init */
			},
			run: (_ctx) => {
				/* execute */
			},
			postRun: (_ctx) => {
				/* teardown */
			},
		};

		expect(cmd.meta.name).toBe("serve");
		expect(cmd.args).toBeDefined();
		expect(cmd.flags).toBeDefined();
		expect(cmd.run).toBeFunction();
	});
});

describe("Command runtime shape", () => {
	it("accepts a command value used at runtime", () => {
		const cmd: Command = {
			meta: { name: "test" },
			run: (_ctx) => {
				/* execute */
			},
		};

		expect(cmd.meta.name).toBe("test");
		expect(cmd.run).toBeFunction();
	});
});

// ────────────────────────────────────────────────────────────────────────────
// CommandContext tests
// ────────────────────────────────────────────────────────────────────────────

describe("CommandContext interface", () => {
	it("has correct shape with default generics", () => {
		const ctx: CommandContext = {
			args: {},
			flags: {},
			rawArgs: ["--verbose"],
			command: { meta: { name: "test" } },
		};

		expect(ctx.rawArgs).toEqual(["--verbose"]);
		expect(ctx.command.meta.name).toBe("test");
	});

	it("infers typed args and flags from generics", () => {
		type MyArgs = readonly [{ name: "name"; type: "string"; required: true }];
		type MyFlags = { verbose: { type: "boolean" } };

		const ctx: CommandContext<MyArgs, MyFlags> = {
			args: { name: "hello" },
			flags: { verbose: true },
			rawArgs: [],
			command: { meta: { name: "test" } },
		};

		// These are compile-time verified type checks
		type _checkName = Expect<Equal<typeof ctx.args.name, string>>;
		type _checkVerbose = Expect<
			Equal<typeof ctx.flags.verbose, boolean | undefined>
		>;

		expect(ctx.args.name).toBe("hello");
		expect(ctx.flags.verbose).toBe(true);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// ValidateFlagAliases type-level tests
// ────────────────────────────────────────────────────────────────────────────

describe("ValidateFlagAliases type inference", () => {
	it("resolves to identity when no aliases collide with flag names", () => {
		type Flags = {
			output: { type: "string"; alias: ["o"] };
			verbose: { type: "boolean"; alias: "v" };
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
			output: { type: "string"; alias: ["o", "out"] };
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
			verbose: { type: "boolean"; alias: "v" };
			version: { type: "boolean"; alias: "v" };
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
			verbose: { type: "boolean"; alias: "v" };
			port: { type: "number"; alias: "p" };
			output: { type: "string"; alias: "o" };
		};
		type Result = ValidateFlagAliases<Flags>;
		type _check = Expect<Equal<Result, Flags>>;

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
