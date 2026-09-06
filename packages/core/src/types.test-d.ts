import type { StandardSchema } from "@crustjs/utils/schema";

import type { Equal, Expect } from "../tests/helpers.ts";
import type { ArgDef, ArgsDef, FlagDef, InferArgs, InferFlags } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// InferArgs type-level tests
// ────────────────────────────────────────────────────────────────────────────

// InferArgs type inference
{
	// maps basic "string" arg to string | undefined
	type Args = readonly [{ name: "name"; type: "string" }];
	type Result = InferArgs<Args>;
	type _check = Expect<Equal<Result, { name: string | undefined }>>;
}

{
	// maps basic "number" arg to number | undefined
	type Args = readonly [{ name: "port"; type: "number" }];
	type Result = InferArgs<Args>;
	type _check = Expect<Equal<Result, { port: number | undefined }>>;
}

{
	// maps basic "boolean" arg to boolean | undefined
	type Args = readonly [{ name: "flag"; type: "boolean" }];
	type Result = InferArgs<Args>;
	type _check = Expect<Equal<Result, { flag: boolean | undefined }>>;
}

{
	// schema args infer the schema output, untouched by choices narrowing
	type Args = readonly [{ name: "url"; schema: StandardSchema<string | undefined, URL> }];
	type Result = InferArgs<Args>;
	type _check = Expect<Equal<Result, { url: URL }>>;
}

{
	// maps required arg to non-optional type
	type Args = readonly [{ name: "name"; type: "string"; required: true }];
	type Result = InferArgs<Args>;
	type _check = Expect<Equal<Result, { name: string }>>;
}

{
	// maps arg with default to non-optional type
	type Args = readonly [{ name: "port"; type: "number"; default: 3000 }];
	type Result = InferArgs<Args>;
	type _check = Expect<Equal<Result, { port: number }>>;
}

{
	// maps variadic arg to array type
	type Args = readonly [{ name: "files"; type: "string"; variadic: true }];
	type Result = InferArgs<Args>;
	type _check = Expect<Equal<Result, { files: string[] }>>;
}

{
	// returns Record<string, never> for non-ArgsDef input
	type Result = InferArgs<undefined>;
	type _check = Expect<Equal<Result, Record<string, never>>>;
}

{
	// resolves a widened non-tuple ArgsDef to {} (not a string-indexed record)
	type Result = InferArgs<ArgsDef>;
	type _check = Expect<Equal<Result, {}>>;
}

{
	// distributes over a union of arg tuples instead of merging members
	type Result = InferArgs<
		| readonly [{ name: "x"; type: "string"; required: true }]
		| readonly [{ name: "y"; type: "number"; required: true }]
	>;
	type _check = Expect<Equal<Result, { x: string } | { y: number }>>;
}

{
	// turns duplicate arg names with conflicting types into never
	// The inferred conflict signal complements the builder's runtime
	// duplicate-name check.
	type Args = readonly [
		{ name: "x"; type: "string"; required: true },
		{ name: "x"; type: "number"; required: true },
	];
	type Result = InferArgs<Args>;
	type _check = Expect<Equal<Result["x"], never>>;
}

// ────────────────────────────────────────────────────────────────────────────
// InferFlags type-level tests
// ────────────────────────────────────────────────────────────────────────────

// InferFlags type inference
{
	// maps basic "string" flag to string | undefined
	type Flags = { output: { type: "string" } };
	type Result = InferFlags<Flags>;
	type _check = Expect<Equal<Result, { output: string | undefined }>>;
}

{
	// maps basic "boolean" flag to boolean | undefined
	type Flags = { verbose: { type: "boolean" } };
	type Result = InferFlags<Flags>;
	type _check = Expect<Equal<Result, { verbose: boolean | undefined }>>;
}

{
	// maps required flag to non-optional type
	type Flags = { name: { type: "string"; required: true } };
	type Result = InferFlags<Flags>;
	type _check = Expect<Equal<Result, { name: string }>>;
}

{
	// maps flag with default to non-optional type
	type Flags = { port: { type: "number"; default: 8080 } };
	type Result = InferFlags<Flags>;
	type _check = Expect<Equal<Result, { port: number }>>;
}

{
	// narrows a string flag with literal choices to the literal union
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
}

{
	// keeps plain string for choices widened to readonly string[]
	type Flags = { env: { type: "string"; choices: readonly string[] } };
	type Result = InferFlags<Flags>;
	type _check = Expect<Equal<Result, { env: string | undefined }>>;
}

{
	// returns Record<string, never> for non-FlagsDef input
	type Result = InferFlags<undefined>;
	type _check = Expect<Equal<Result, Record<string, never>>>;
}

{
	// maps multiple "string" flag to string[] | undefined
	type Flags = { file: { type: "string"; multiple: true } };
	type Result = InferFlags<Flags>;
	type _check = Expect<Equal<Result, { file: string[] | undefined }>>;
}

{
	// maps multiple "number" flag with required to number[]
	type Flags = {
		port: { type: "number"; multiple: true; required: true };
	};
	type Result = InferFlags<Flags>;
	type _check = Expect<Equal<Result, { port: number[] }>>;
}

{
	// maps multiple flag with default to non-optional array type
	type Flags = {
		file: {
			type: "string";
			multiple: true;
			default: ["default.ts"];
		};
	};
	type Result = InferFlags<Flags>;
	type _check = Expect<Equal<Result, { file: string[] }>>;
}

// ────────────────────────────────────────────────────────────────────────────
// ArgDef / FlagDef discriminated union narrowing tests
// ────────────────────────────────────────────────────────────────────────────

// ArgDef discriminated union narrowing
{
	// rejects default type mismatch
	// @ts-expect-error — default must be number when type is "number"
	const _bad1: ArgDef = { name: "port", type: "number", default: "oops" };

	// @ts-expect-error — default must be string when type is "string"
	const _bad2: ArgDef = { name: "name", type: "string", default: 42 };

	// @ts-expect-error — default must be boolean when type is "boolean"
	const _bad3: ArgDef = { name: "flag", type: "boolean", default: "yes" };
}

// FlagDef discriminated union narrowing
{
	// rejects default type mismatch for single-value flags
	// @ts-expect-error — default must be number when type is "number"
	const _bad1: FlagDef = { type: "number", default: "oops" };

	// @ts-expect-error — default must be string when type is "string"
	const _bad2: FlagDef = { type: "string", default: 123 };

	// @ts-expect-error — default must be boolean when type is "boolean"
	const _bad3: FlagDef = { type: "boolean", default: "yes" };
}

{
	// rejects scalar default for multi-value flags
	// @ts-expect-error — default must be string[] when multiple is true
	const _bad1: FlagDef = {
		type: "string",
		multiple: true,
		default: "scalar",
	};

	// @ts-expect-error — default must be number[] when multiple is true
	const _bad2: FlagDef = { type: "number", multiple: true, default: 42 };
}

{
	// rejects array default for single-value flags
	// @ts-expect-error — default must be string, not string[], for single-value
	const _bad1: FlagDef = { type: "string", default: ["a", "b"] };

	// @ts-expect-error — default must be number, not number[], for single-value
	const _bad2: FlagDef = { type: "number", default: [1, 2] };
}

{
	// rejects cross-type array defaults for multi-value flags
	// @ts-expect-error — default must be number[], not string[]
	const _bad1: FlagDef = { type: "number", multiple: true, default: ["a"] };

	// @ts-expect-error — default must be boolean[], not number[]
	const _bad2: FlagDef = { type: "boolean", multiple: true, default: [1, 2] };
}

// ────────────────────────────────────────────────────────────────────────────
// ArgDef / FlagDef toggle field tests
// ────────────────────────────────────────────────────────────────────────────

// ArgDef toggle fields
{
	// rejects false for toggle fields
	// @ts-expect-error — toggle fields only accept `true`, not `false`
	const _bad1: ArgDef = { name: "a", type: "string", required: false };

	// @ts-expect-error — toggle fields only accept `true`, not `false`
	const _bad2: ArgDef = { name: "a", type: "string", variadic: false };
}

// FlagDef toggle fields
{
	// rejects false for toggle fields
	// @ts-expect-error — toggle fields only accept `true`, not `false`
	const _bad1: FlagDef = { type: "string", required: false };

	// @ts-expect-error — toggle fields only accept `true`, not `false`
	const _bad2: FlagDef = { type: "string", multiple: false };
}

// ───────────────────────────────────────────────────────────────────────
// `choices` field — string-only on FlagDef and ArgDef
// ───────────────────────────────────────────────────────────────────────

// FlagDef choices field
{
	// accepts choices on a single-value string flag (no `as const` required)
	// Plain array literal — `readonly string[]` accepts `string[]`, so
	// users do not need to write `as const`. Regression guard for the
	// documented zero-friction shape.
	const _flag: FlagDef = {
		type: "string",
		choices: ["browser", "bun", "node"],
	};
}

{
	// accepts choices on a multi-value string flag (no `as const` required)
	const _flag: FlagDef = {
		type: "string",
		multiple: true,
		choices: ["unit", "integration"],
	};
}

{
	// rejects choices on a boolean flag
	// @ts-expect-error — `choices` is only supported on string-typed flags
	const _bad1: FlagDef = { type: "boolean", choices: ["a", "b"] };

	// @ts-expect-error — `choices` is only supported on string-typed flags
	const _bad2: FlagDef = {
		type: "boolean",
		multiple: true,
		choices: ["a", "b"],
	};
}

{
	// rejects choices on a number flag
	// @ts-expect-error — `choices` is only supported on string-typed flags
	const _bad1: FlagDef = { type: "number", choices: ["a", "b"] };

	// @ts-expect-error — `choices` is only supported on string-typed flags
	const _bad2: FlagDef = {
		type: "number",
		multiple: true,
		choices: ["a", "b"],
	};
}

// ArgDef choices field
{
	// accepts choices on a string positional arg (no `as const` required)
	const _arg: ArgDef = {
		name: "target",
		type: "string",
		choices: ["browser", "bun", "node"],
	};
}

{
	// rejects choices on a boolean positional arg
	// @ts-expect-error — `choices` is only supported on string-typed args
	const _bad: ArgDef = {
		name: "flag",
		type: "boolean",
		choices: ["a", "b"],
	};
}

{
	// rejects choices on a number positional arg
	// @ts-expect-error — `choices` is only supported on string-typed args
	const _bad: ArgDef = {
		name: "port",
		type: "number",
		choices: ["a", "b"],
	};
}

// ────────────────────────────────────────────────────────────────────────────
// InferFlags — url/path/json types
// ────────────────────────────────────────────────────────────────────────────

// InferFlags — url/path/json types
{
	// maps "url" flag to URL | undefined
	type Flags = { x: { type: "url" } };
	type Result = InferFlags<Flags>;
	type _check = Expect<Equal<Result, { x: URL | undefined }>>;
}

{
	// maps "path" flag with default to string (no undefined)
	type Flags = { x: { type: "path"; default: "/tmp" } };
	type Result = InferFlags<Flags>;
	type _check = Expect<Equal<Result, { x: string }>>;
}

{
	// maps required "json" flag to unknown
	type Flags = { x: { type: "json"; required: true } };
	type Result = InferFlags<Flags>;
	type _check = Expect<Equal<Result, { x: unknown }>>;
}

// ────────────────────────────────────────────────────────────────────────────
// InferFlags — parse field inference
// ────────────────────────────────────────────────────────────────────────────

// InferFlags — parse field inference
{
	// maps parse returning URL to URL | undefined
	type Flags = { x: { type: "string"; parse: (s: string) => URL } };
	type Result = InferFlags<Flags>;
	type _check = Expect<Equal<Result, { x: URL | undefined }>>;
}

{
	// maps multi-value parse returning number to number[] | undefined
	type Flags = {
		x: { type: "string"; multiple: true; parse: (s: string) => number };
	};
	type Result = InferFlags<Flags>;
	type _check = Expect<Equal<Result, { x: number[] | undefined }>>;
}

{
	// maps required parse to non-optional inferred type
	type Flags = {
		x: { type: "string"; required: true; parse: (s: string) => number };
	};
	type Result = InferFlags<Flags>;
	type _check = Expect<Equal<Result, { x: number }>>;
}

{
	// parse wins over literal choices (parse owns the output type)
	type Flags = {
		x: { type: "string"; choices: readonly ["1", "2"]; parse: (s: string) => number };
	};
	type Result = InferFlags<Flags>;
	type _check = Expect<Equal<Result, { x: number | undefined }>>;
}

{
	// narrows inference when parse + raw default are both present
	// Regression: a prior implementation of this conditional checked
	// `default: ResolveBaseType<F>` (the parsed type), so a raw string
	// default with a numeric parse return left the inferred type optional.
	type Flags = {
		x: { type: "string"; parse: (s: string) => number; default: "3000" };
	};
	type Result = InferFlags<Flags>;
	type _check = Expect<Equal<Result, { x: number }>>;
}

{
	// narrows multi-value inference when parse + raw default[] are both present
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
}

// ────────────────────────────────────────────────────────────────────────────
// FlagDef — parse?: never enforcement on non-string variants
// ────────────────────────────────────────────────────────────────────────────

// FlagDef — parse?: never enforcement
{
	// rejects parse on non-string flag variants
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
}
