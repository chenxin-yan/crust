import { describe, expect, it } from "bun:test";
import type {
	ArgDef,
	ArgsDef,
	CheckFlagAliasCollisions,
	CheckVariadicArgs,
	Command,
	CommandContext,
	CommandMeta,
	FlagDef,
	FlagsDef,
	InferArgs,
	InferFlags,
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
	it("maps basic String arg to string | undefined", () => {
		type Args = readonly [{ name: "name"; type: StringConstructor }];
		type Result = InferArgs<Args>;
		type _check = Expect<Equal<Result, { name: string | undefined }>>;

		// Runtime assertion to make the test non-empty
		const val: Result = { name: undefined };
		expect(val).toBeDefined();
	});

	it("maps basic Number arg to number | undefined", () => {
		type Args = readonly [{ name: "port"; type: NumberConstructor }];
		type Result = InferArgs<Args>;
		type _check = Expect<Equal<Result, { port: number | undefined }>>;

		const val: Result = { port: undefined };
		expect(val).toBeDefined();
	});

	it("maps basic Boolean arg to boolean | undefined", () => {
		type Args = readonly [{ name: "flag"; type: BooleanConstructor }];
		type Result = InferArgs<Args>;
		type _check = Expect<Equal<Result, { flag: boolean | undefined }>>;

		const val: Result = { flag: undefined };
		expect(val).toBeDefined();
	});

	it("maps required arg to non-optional type", () => {
		type Args = readonly [
			{ name: "name"; type: StringConstructor; required: true },
		];
		type Result = InferArgs<Args>;
		type _check = Expect<Equal<Result, { name: string }>>;

		const val: Result = { name: "hello" };
		expect(val.name).toBe("hello");
	});

	it("maps arg with default to non-optional type", () => {
		type Args = readonly [
			{ name: "port"; type: NumberConstructor; default: 3000 },
		];
		type Result = InferArgs<Args>;
		type _check = Expect<Equal<Result, { port: number }>>;

		const val: Result = { port: 3000 };
		expect(val.port).toBe(3000);
	});

	it("maps variadic arg to array type", () => {
		type Args = readonly [
			{ name: "files"; type: StringConstructor; variadic: true },
		];
		type Result = InferArgs<Args>;
		type _check = Expect<Equal<Result, { files: string[] }>>;

		const val: Result = { files: ["a.ts", "b.ts"] };
		expect(val.files).toEqual(["a.ts", "b.ts"]);
	});

	it("maps variadic Number arg to number[]", () => {
		type Args = readonly [
			{ name: "ports"; type: NumberConstructor; variadic: true },
		];
		type Result = InferArgs<Args>;
		type _check = Expect<Equal<Result, { ports: number[] }>>;

		const val: Result = { ports: [3000, 4000] };
		expect(val.ports).toEqual([3000, 4000]);
	});

	it("maps multiple args together", () => {
		type Args = readonly [
			{ name: "name"; type: StringConstructor; required: true },
			{ name: "port"; type: NumberConstructor; default: 3000 },
			{ name: "verbose"; type: BooleanConstructor },
			{ name: "files"; type: StringConstructor; variadic: true },
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
	it("maps basic String flag to string | undefined", () => {
		type Flags = { output: { type: StringConstructor } };
		type Result = InferFlags<Flags>;
		type _check = Expect<Equal<Result, { output: string | undefined }>>;

		const val: Result = { output: undefined };
		expect(val).toBeDefined();
	});

	it("maps basic Boolean flag to boolean | undefined", () => {
		type Flags = { verbose: { type: BooleanConstructor } };
		type Result = InferFlags<Flags>;
		type _check = Expect<Equal<Result, { verbose: boolean | undefined }>>;

		const val: Result = { verbose: undefined };
		expect(val).toBeDefined();
	});

	it("maps required flag to non-optional type", () => {
		type Flags = { name: { type: StringConstructor; required: true } };
		type Result = InferFlags<Flags>;
		type _check = Expect<Equal<Result, { name: string }>>;

		const val: Result = { name: "test" };
		expect(val.name).toBe("test");
	});

	it("maps flag with default to non-optional type", () => {
		type Flags = { port: { type: NumberConstructor; default: 8080 } };
		type Result = InferFlags<Flags>;
		type _check = Expect<Equal<Result, { port: number }>>;

		const val: Result = { port: 8080 };
		expect(val.port).toBe(8080);
	});

	it("maps multiple flags together", () => {
		type Flags = {
			verbose: { type: BooleanConstructor };
			port: { type: NumberConstructor; default: 3000 };
			output: { type: StringConstructor; required: true };
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

	it("maps multiple String flag to string[] | undefined", () => {
		type Flags = { file: { type: StringConstructor; multiple: true } };
		type Result = InferFlags<Flags>;
		type _check = Expect<Equal<Result, { file: string[] | undefined }>>;

		const val: Result = { file: undefined };
		expect(val).toBeDefined();
	});

	it("maps multiple Number flag with required to number[]", () => {
		type Flags = {
			port: { type: NumberConstructor; multiple: true; required: true };
		};
		type Result = InferFlags<Flags>;
		type _check = Expect<Equal<Result, { port: number[] }>>;

		const val: Result = { port: [80, 443] };
		expect(val.port).toEqual([80, 443]);
	});

	it("maps multiple Boolean flag to boolean[] | undefined", () => {
		type Flags = { verbose: { type: BooleanConstructor; multiple: true } };
		type Result = InferFlags<Flags>;
		type _check = Expect<Equal<Result, { verbose: boolean[] | undefined }>>;

		const val: Result = { verbose: [true, true] };
		expect(val).toBeDefined();
	});

	it("maps multiple flag with default to non-optional array type", () => {
		type Flags = {
			file: {
				type: StringConstructor;
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
			file: { type: StringConstructor; multiple: true };
			verbose: { type: BooleanConstructor };
			port: { type: NumberConstructor; multiple: true; required: true };
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
		const stringArg: ArgDef = { name: "str", type: String };
		const numberArg: ArgDef = { name: "port", type: Number, default: 3000 };
		const boolArg: ArgDef = {
			name: "flag",
			type: Boolean,
			description: "A flag",
			required: true,
		};
		const variadicArg: ArgDef = { name: "files", type: String, variadic: true };

		expect(stringArg.type).toBe(String);
		expect(numberArg.default).toBe(3000);
		expect(boolArg.required).toBe(true);
		expect(variadicArg.variadic).toBe(true);
	});

	it("allows ArgsDef array", () => {
		const args: ArgsDef = [
			{ name: "name", type: String, required: true },
			{ name: "port", type: Number, default: 3000 },
			{ name: "files", type: String, variadic: true },
		];

		expect(args.map((a) => a.name)).toEqual(["name", "port", "files"]);
	});
});

describe("FlagDef interface", () => {
	it("accepts valid flag definitions", () => {
		const boolFlag: FlagDef = { type: Boolean, alias: "v" };
		const stringFlag: FlagDef = {
			type: String,
			alias: ["o", "out"],
			required: true,
		};
		const numberFlag: FlagDef = { type: Number, default: 8080 };
		const multipleFlag: FlagDef = { type: String, multiple: true };

		expect(boolFlag.alias).toBe("v");
		expect(stringFlag.required).toBe(true);
		expect(numberFlag.default).toBe(8080);
		expect(multipleFlag.multiple).toBe(true);
	});

	it("allows FlagsDef record", () => {
		const flags: FlagsDef = {
			verbose: { type: Boolean, alias: "v" },
			port: { type: Number, default: 3000, description: "Port number" },
		};

		expect(Object.keys(flags)).toEqual(["verbose", "port"]);
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
			args: [{ name: "path", type: String, required: true }],
			flags: {
				port: { type: Number, default: 3000 },
				verbose: { type: Boolean, alias: "v" },
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
		type MyArgs = readonly [
			{ name: "name"; type: StringConstructor; required: true },
		];
		type MyFlags = { verbose: { type: BooleanConstructor } };

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
// CheckFlagAliasCollisions type-level tests
// ────────────────────────────────────────────────────────────────────────────

describe("CheckFlagAliasCollisions type inference", () => {
	it("resolves to unknown when no aliases collide with flag names", () => {
		type Flags = {
			output: { type: StringConstructor; alias: ["o"] };
			verbose: { type: BooleanConstructor; alias: "v" };
		};
		type Result = CheckFlagAliasCollisions<Flags>;
		type _check = Expect<Equal<Result, unknown>>;

		expect(true).toBe(true);
	});

	it("resolves to unknown when no aliases are defined", () => {
		type Flags = {
			verbose: { type: BooleanConstructor };
			port: { type: NumberConstructor };
		};
		type Result = CheckFlagAliasCollisions<Flags>;
		type _check = Expect<Equal<Result, unknown>>;

		expect(true).toBe(true);
	});

	it("resolves to error tuple when a long alias shadows a flag name", () => {
		type Flags = {
			out: { type: StringConstructor };
			output: { type: StringConstructor; alias: ["o", "out"] };
		};
		type Result = CheckFlagAliasCollisions<Flags>;
		type _check = Expect<
			Equal<
				Result,
				[
					"ERROR: Flag alias collides with a flag name. Colliding name(s):",
					"out",
				]
			>
		>;

		expect(true).toBe(true);
	});

	it("resolves to error tuple when two flags share the same alias", () => {
		type Flags = {
			verbose: { type: BooleanConstructor; alias: "v" };
			version: { type: BooleanConstructor; alias: "v" };
		};
		type Result = CheckFlagAliasCollisions<Flags>;
		type _check = Expect<
			Equal<
				Result,
				[
					"ERROR: Duplicate flag alias across different flags. Colliding alias(es):",
					"v",
				]
			>
		>;

		expect(true).toBe(true);
	});

	it("resolves to unknown for single-char aliases that don't match flag names", () => {
		type Flags = {
			verbose: { type: BooleanConstructor; alias: "v" };
			port: { type: NumberConstructor; alias: "p" };
			output: { type: StringConstructor; alias: "o" };
		};
		type Result = CheckFlagAliasCollisions<Flags>;
		type _check = Expect<Equal<Result, unknown>>;

		expect(true).toBe(true);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// CheckVariadicArgs type-level tests
// ────────────────────────────────────────────────────────────────────────────

describe("CheckVariadicArgs type inference", () => {
	it("resolves to unknown when variadic is the last arg", () => {
		type Args = readonly [
			{ name: "name"; type: StringConstructor; required: true },
			{ name: "files"; type: StringConstructor; variadic: true },
		];
		type Result = CheckVariadicArgs<Args>;
		type _check = Expect<Equal<Result, unknown>>;

		expect(true).toBe(true);
	});

	it("resolves to unknown when no args are variadic", () => {
		type Args = readonly [
			{ name: "name"; type: StringConstructor; required: true },
			{ name: "port"; type: NumberConstructor; default: 3000 },
		];
		type Result = CheckVariadicArgs<Args>;
		type _check = Expect<Equal<Result, unknown>>;

		expect(true).toBe(true);
	});

	it("resolves to error string when a non-last arg is variadic", () => {
		type Args = readonly [
			{ name: "files"; type: StringConstructor; variadic: true },
			{ name: "name"; type: StringConstructor; required: true },
		];
		type Result = CheckVariadicArgs<Args>;
		type _check = Expect<
			Equal<Result, "ERROR: Only the last positional argument can be variadic">
		>;

		expect(true).toBe(true);
	});
});
