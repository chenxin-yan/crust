import { describe, expect, it } from "bun:test";

import type { StandardSchema } from "@crustjs/utils/schema";

import type { Equal, Expect } from "../tests/helpers.ts";
import type { ArgDef, ArgsDef, FlagDef, InferArgs, InferFlags } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Type-level test utilities
// ────────────────────────────────────────────────────────────────────────────

/**
 * Asserts that two types are exactly equal.
 * If they differ, the assignment will produce a TypeScript compile error.
 */

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

	it("narrows raw args (no type/schema) with literal choices", () => {
		type Args = readonly [
			{ name: "mode"; choices: readonly ["dev", "prod"] },
			{ name: "env"; choices: readonly ["a", "b"]; default: "a" },
			{ name: "tags"; choices: readonly ["x", "y"]; variadic: true },
		];
		type Result = InferArgs<Args>;
		type _check = Expect<
			Equal<
				Result,
				{
					mode: "dev" | "prod" | undefined;
					env: "a" | "b";
					tags: ("x" | "y")[];
				}
			>
		>;
		expect(true).toBe(true);
	});

	it("schema args infer the schema output, untouched by choices narrowing", () => {
		type Args = readonly [{ name: "url"; schema: StandardSchema<string | undefined, URL> }];
		type Result = InferArgs<Args>;
		type _check = Expect<Equal<Result, { url: URL }>>;
		expect(true).toBe(true);
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

	it("returns Record<string, never> for non-ArgsDef input", () => {
		type Result = InferArgs<undefined>;
		type _check = Expect<Equal<Result, Record<string, never>>>;
		expect(true).toBe(true);
	});

	it("resolves a widened non-tuple ArgsDef to {} (not a string-indexed record)", () => {
		type Result = InferArgs<ArgsDef>;
		type _check = Expect<Equal<Result, {}>>;
		expect(true).toBe(true);
	});

	it("distributes over a union of arg tuples instead of merging members", () => {
		type Result = InferArgs<
			| readonly [{ name: "x"; type: "string"; required: true }]
			| readonly [{ name: "y"; type: "number"; required: true }]
		>;
		type _check = Expect<Equal<Result, { x: string } | { y: number }>>;
		expect(true).toBe(true);
	});

	it("turns duplicate arg names with conflicting types into never", () => {
		// The inferred conflict signal complements the builder's runtime
		// duplicate-name check.
		type Args = readonly [
			{ name: "x"; type: "string"; required: true },
			{ name: "x"; type: "number"; required: true },
		];
		type Result = InferArgs<Args>;
		type _check = Expect<Equal<Result["x"], never>>;
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

	it("narrows a string flag with literal choices to the literal union", () => {
		type Flags = {
			env: { type: "string"; choices: readonly ["staging", "production"]; default: "staging" };
			mode: { type: "string"; choices: readonly ["a", "b"] };
			tags: { type: "string"; multiple: true; choices: readonly ["x", "y"] };
		};
		type Result = InferFlags<Flags>;
		type _check = Expect<
			Equal<
				Result,
				{
					env: "staging" | "production";
					mode: "a" | "b" | undefined;
					tags: ("x" | "y")[] | undefined;
				}
			>
		>;

		const val: Result = { env: "staging", mode: undefined, tags: undefined };
		expect(val.env).toBe("staging");
	});

	it("keeps plain string for choices widened to readonly string[]", () => {
		type Flags = { env: { type: "string"; choices: readonly string[] } };
		type Result = InferFlags<Flags>;
		type _check = Expect<Equal<Result, { env: string | undefined }>>;
		expect(true).toBe(true);
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
	it("rejects false for toggle fields", () => {
		// @ts-expect-error — toggle fields only accept `true`, not `false`
		const _bad1: ArgDef = { name: "a", type: "string", required: false };

		// @ts-expect-error — toggle fields only accept `true`, not `false`
		const _bad2: ArgDef = { name: "a", type: "string", variadic: false };

		expect(true).toBe(true);
	});
});

describe("FlagDef toggle fields", () => {
	it("rejects false for toggle fields", () => {
		// @ts-expect-error — toggle fields only accept `true`, not `false`
		const _bad1: FlagDef = { type: "string", required: false };

		// @ts-expect-error — toggle fields only accept `true`, not `false`
		const _bad2: FlagDef = { type: "string", multiple: false };

		expect(true).toBe(true);
	});
});

// ───────────────────────────────────────────────────────────────────────
// `choices` field — string-only on FlagDef and ArgDef
// ───────────────────────────────────────────────────────────────────────

describe("FlagDef choices field", () => {
	it("accepts choices on a single-value string flag (no `as const` required)", () => {
		// Plain array literal — `readonly string[]` accepts `string[]`, so
		// users do not need to write `as const`. Regression guard for the
		// documented zero-friction shape.
		const flag: FlagDef = {
			type: "string",
			choices: ["browser", "bun", "node"],
		};
		expect(flag.type).toBe("string");
		expect(flag.choices).toEqual(["browser", "bun", "node"]);
	});

	it("accepts choices on a multi-value string flag (no `as const` required)", () => {
		const flag: FlagDef = {
			type: "string",
			multiple: true,
			choices: ["unit", "integration"],
		};
		expect(flag.multiple).toBe(true);
		expect(flag.choices).toEqual(["unit", "integration"]);
	});

	it("rejects choices on a boolean flag", () => {
		// @ts-expect-error — `choices` is only supported on string-typed flags
		const _bad1: FlagDef = { type: "boolean", choices: ["a", "b"] };

		// @ts-expect-error — `choices` is only supported on string-typed flags
		const _bad2: FlagDef = {
			type: "boolean",
			multiple: true,
			choices: ["a", "b"],
		};

		expect(_bad1.type).toBe("boolean");
		expect(_bad2.type).toBe("boolean");
	});

	it("rejects choices on a number flag", () => {
		// @ts-expect-error — `choices` is only supported on string-typed flags
		const _bad1: FlagDef = { type: "number", choices: ["a", "b"] };

		// @ts-expect-error — `choices` is only supported on string-typed flags
		const _bad2: FlagDef = {
			type: "number",
			multiple: true,
			choices: ["a", "b"],
		};

		expect(_bad1.type).toBe("number");
		expect(_bad2.type).toBe("number");
	});
});

describe("ArgDef choices field", () => {
	it("accepts choices on a string positional arg (no `as const` required)", () => {
		const arg: ArgDef = {
			name: "target",
			type: "string",
			choices: ["browser", "bun", "node"],
		};
		expect(arg.type).toBe("string");
		expect(arg.choices).toEqual(["browser", "bun", "node"]);
	});

	it("rejects choices on a boolean positional arg", () => {
		// @ts-expect-error — `choices` is only supported on string-typed args
		const _bad: ArgDef = {
			name: "flag",
			type: "boolean",
			choices: ["a", "b"],
		};
		expect(_bad.type).toBe("boolean");
	});

	it("rejects choices on a number positional arg", () => {
		// @ts-expect-error — `choices` is only supported on string-typed args
		const _bad: ArgDef = {
			name: "port",
			type: "number",
			choices: ["a", "b"],
		};
		expect(_bad.type).toBe("number");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// InferFlags — url/path/json types
// ────────────────────────────────────────────────────────────────────────────

describe("InferFlags — url/path/json types", () => {
	it('maps "url" flag to URL | undefined', () => {
		type Flags = { x: { type: "url" } };
		type Result = InferFlags<Flags>;
		type _check = Expect<Equal<Result, { x: URL | undefined }>>;
		const val: Result = { x: undefined };
		expect(val).toBeDefined();
	});

	it('maps "path" flag with default to string (no undefined)', () => {
		type Flags = { x: { type: "path"; default: "/tmp" } };
		type Result = InferFlags<Flags>;
		type _check = Expect<Equal<Result, { x: string }>>;
		const val: Result = { x: "/tmp" };
		expect(val.x).toBe("/tmp");
	});

	it('maps required "json" flag to unknown', () => {
		type Flags = { x: { type: "json"; required: true } };
		type Result = InferFlags<Flags>;
		type _check = Expect<Equal<Result, { x: unknown }>>;
		const val: Result = { x: { hello: "world" } };
		expect(val).toBeDefined();
	});
});

// ────────────────────────────────────────────────────────────────────────────
// InferFlags — parse field inference
// ────────────────────────────────────────────────────────────────────────────

describe("InferFlags — parse field inference", () => {
	it("maps parse returning URL to URL | undefined", () => {
		type Flags = { x: { type: "string"; parse: (s: string) => URL } };
		type Result = InferFlags<Flags>;
		type _check = Expect<Equal<Result, { x: URL | undefined }>>;
		const val: Result = { x: undefined };
		expect(val).toBeDefined();
	});

	it("maps multi-value parse returning number to number[] | undefined", () => {
		type Flags = {
			x: { type: "string"; multiple: true; parse: (s: string) => number };
		};
		type Result = InferFlags<Flags>;
		type _check = Expect<Equal<Result, { x: number[] | undefined }>>;
		const val: Result = { x: undefined };
		expect(val).toBeDefined();
	});

	it("maps required parse to non-optional inferred type", () => {
		type Flags = {
			x: { type: "string"; required: true; parse: (s: string) => number };
		};
		type Result = InferFlags<Flags>;
		type _check = Expect<Equal<Result, { x: number }>>;
		const val: Result = { x: 42 };
		expect(val.x).toBe(42);
	});

	it("parse wins over literal choices (parse owns the output type)", () => {
		type Flags = {
			x: { type: "string"; choices: readonly ["1", "2"]; parse: (s: string) => number };
		};
		type Result = InferFlags<Flags>;
		type _check = Expect<Equal<Result, { x: number | undefined }>>;
		expect(true).toBe(true);
	});

	it("narrows inference when parse + raw default are both present", () => {
		// Regression: a prior implementation of this conditional checked
		// `default: ResolveBaseType<F>` (the parsed type), so a raw string
		// default with a numeric parse return left the inferred type optional.
		type Flags = {
			x: { type: "string"; parse: (s: string) => number; default: "3000" };
		};
		type Result = InferFlags<Flags>;
		type _check = Expect<Equal<Result, { x: number }>>;
		const val: Result = { x: 3000 };
		expect(val.x).toBe(3000);
	});

	it("narrows multi-value inference when parse + raw default[] are both present", () => {
		type Flags = {
			x: {
				type: "string";
				multiple: true;
				parse: (s: string) => number;
				default: ["3000", "8080"];
			};
		};
		type Result = InferFlags<Flags>;
		type _check = Expect<Equal<Result, { x: number[] }>>;
		const val: Result = { x: [3000, 8080] };
		expect(val.x).toEqual([3000, 8080]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// FlagDef — parse?: never enforcement on non-string variants
// ────────────────────────────────────────────────────────────────────────────

describe("FlagDef — parse?: never enforcement", () => {
	it("rejects parse on non-string flag variants", () => {
		// @ts-expect-error — parse is forbidden on number flags
		const _n: FlagDef = { type: "number", parse: (s: string) => Number(s) };
		// @ts-expect-error — parse is forbidden on boolean flags
		const _b: FlagDef = { type: "boolean", parse: (s: string) => s };
		// @ts-expect-error — parse is forbidden on url flags
		const _u: FlagDef = { type: "url", parse: (s: string) => s };
		// @ts-expect-error — parse is forbidden on path flags
		const _p: FlagDef = { type: "path", parse: (s: string) => s };
		// @ts-expect-error — parse is forbidden on json flags
		const _j: FlagDef = { type: "json", parse: (s: string) => s };
		expect(true).toBe(true);
	});
});
