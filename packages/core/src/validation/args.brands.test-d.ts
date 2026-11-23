import type { StandardSchema } from "@crustjs/utils/schema";

import type { Equal, Expect } from "../../tests/helpers.ts";
import { Crust } from "../command/crust.ts";
import type { AppendArgsChecks, AppendArgsErrors, ValidateArgs } from "./args.brands.ts";

// ValidateArgs type inference
{
	// resolves to identity when variadic is the last arg
	type Args = readonly [
		{ name: "name"; type: "string"; required: true },
		{ name: "files"; type: "string"; variadic: true },
	];
	type Result = ValidateArgs<Args>;
	type _check = Expect<Equal<Result, Args>>;
}

{
	// brands the specific non-last arg that is variadic
	type Args = readonly [
		{ name: "files"; type: "string"; variadic: true },
		{ name: "name"; type: "string" },
	];
	type Result = ValidateArgs<Args>;
	// First arg (variadic, non-last) gets branded error
	type _checkFirst = Expect<
		Equal<
			Result[0],
			Args[0] & {
				readonly FIX_VARIADIC_POSITION: 'Only the last argument, or the one before a final "afterDoubleDash" argument, can be variadic';
			}
		>
	>;
	// Second arg (last) is unchanged
	type _checkSecond = Expect<Equal<Result[1], Args[1]>>;
}

{
	// brands a repeated name within one tuple
	type Args = readonly [{ name: "file"; type: "string" }, { name: "file"; type: "string" }];
	type Result = ValidateArgs<Args>;
	type _checkFirst = Expect<Equal<Result[0], Args[0]>>;
	type _checkSecond = Expect<
		Equal<Result[1]["FIX_DUPLICATE_ARG"], 'Argument name "file" is already defined'>
	>;
}

{
	// brands names duplicated across append calls
	type Existing = readonly [{ name: "source"; type: "string" }];
	type Added = readonly [{ name: "source"; type: "string" }];
	type Result = AppendArgsChecks<Existing, Added>;
	type _check = Expect<
		Equal<Result[0]["FIX_DUPLICATE_ARG"], 'Argument name "source" is already defined'>
	>;
}

{
	// brands Promise-returning custom parsers
	type Args = readonly [
		{ name: "remote"; type: "string"; parse: (raw: string) => Promise<string> },
	];
	type Result = ValidateArgs<Args>;
	type _check = Expect<
		Equal<Result[0]["FIX_ASYNC_PARSE"], "parse must be synchronous; do async work in run()">
	>;
}

{
	// opts widened definitions out of compile-time checks
	// Widened names opt out instead of receiving false-positive duplicate
	// branding.
	type Defs = readonly [{ name: string; type: "string" }, { name: string; type: "string" }];
	type Result = ValidateArgs<Defs, "file">;
	type _first = Expect<Equal<Extract<keyof Result[0], `FIX_${string}`>, never>>;
	type _second = Expect<Equal<Extract<keyof Result[1], `FIX_${string}`>, never>>;
}

{
	// brands literal defaults outside literal choices
	type Invalid = ValidateArgs<
		readonly [{ name: "mode"; type: "string"; choices: ["a", "b"]; default: "z" }]
	>;
	type Valid = ValidateArgs<
		readonly [{ name: "mode"; type: "string"; choices: ["a", "b"]; default: "a" }]
	>;
	type Widened = ValidateArgs<
		readonly [{ name: "mode"; type: "string"; choices: readonly string[]; default: string }]
	>;
	type _invalid = Expect<Equal<Invalid[0]["FIX_DEFAULT_CHOICE"], "default must be one of choices">>;
	// an error on one branch of a conditional tuple still surfaces through AppendArgsErrors
	type Conditional = AppendArgsErrors<
		[],
		| readonly [{ name: "mode"; type: "string" }]
		| readonly [{ name: "mode"; type: "string"; choices: ["a"]; default: "z" }]
	>;
	// Checks for the brand itself: `unknown` (no errors) and `never` (every call rejected) both fail.
	type _conditional = Expect<
		Equal<
			[
				Extract<
					Conditional[number],
					{ readonly FIX_DEFAULT_CHOICE: "default must be one of choices" }
				>,
			] extends [never]
				? false
				: true,
			true
		>
	>;
	type _valid = Expect<Equal<Extract<keyof Valid[0], "FIX_DEFAULT_CHOICE">, never>>;
	type _widened = Expect<Equal<Extract<keyof Widened[0], "FIX_DEFAULT_CHOICE">, never>>;
}

{
	// .args() rejects a conditional tuple when either branch is invalid, even if the invalid
	// branch is assignable to the valid one
	const cond = Math.random() > 0.5;
	const typo = cond
		? ([{ name: "x", type: "string", requried: true }] as const)
		: ([{ name: "x", type: "string" }] as const);
	// @ts-expect-error `requried` is not an argument property
	new Crust("cli").args(...typo);
	const position = cond
		? ([
				{ name: "a", type: "string", variadic: true },
				{ name: "b", type: "string" },
			] as const)
		: ([
				{ name: "a", type: "string" },
				{ name: "b", type: "string" },
			] as const);
	// @ts-expect-error a variadic that is not last
	new Crust("cli").args(...position);
	const valid = cond
		? ([{ name: "x", type: "string", required: true }] as const)
		: ([{ name: "y", type: "boolean" }] as const);
	new Crust("cli").args(...valid);
}

{
	// "afterDoubleDash" and "passthrough": only on the last argument; a plain variadic may precede "afterDoubleDash"
	type Message = 'Only the last argument can be variadic "afterDoubleDash" or "passthrough"';
	type VariadicMessage =
		'Only the last argument, or the one before a final "afterDoubleDash" argument, can be variadic';
	type TaskRunner = readonly [
		{ name: "task"; type: "string"; required: true },
		{ name: "pkgs"; type: "string"; variadic: true },
		{ name: "extra"; type: "string"; variadic: "afterDoubleDash" },
	];
	type _taskRunner = Expect<Equal<ValidateArgs<TaskRunner>, TaskRunner>>;
	type Docker = readonly [
		{ name: "image"; type: "string"; required: true },
		{ name: "command"; type: "string"; variadic: "passthrough" },
	];
	type _docker = Expect<Equal<ValidateArgs<Docker>, Docker>>;

	type NotLast = ValidateArgs<
		readonly [
			{ name: "extra"; type: "string"; variadic: "afterDoubleDash" },
			{ name: "file"; type: "string" },
		]
	>;
	type _notLast = Expect<Equal<NotLast[0]["FIX_LAST_ARGUMENT_POSITION"], Message>>;
	type _notLastSecond = Expect<Equal<Extract<keyof NotLast[1], `FIX_${string}`>, never>>;
	type PassthroughNotLast = ValidateArgs<
		readonly [
			{ name: "command"; type: "string"; variadic: "passthrough" },
			{ name: "extra"; type: "string"; variadic: "afterDoubleDash" },
		]
	>;
	type _passthroughNotLast = Expect<
		Equal<PassthroughNotLast[0]["FIX_LAST_ARGUMENT_POSITION"], Message>
	>;

	// The variadic must sit right before the "afterDoubleDash" argument, and only that one.
	type Gap = ValidateArgs<
		readonly [
			{ name: "pkgs"; type: "string"; variadic: true },
			{ name: "file"; type: "string" },
			{ name: "extra"; type: "string"; variadic: "afterDoubleDash" },
		]
	>;
	type _gap = Expect<Equal<Gap[0]["FIX_VARIADIC_POSITION"], VariadicMessage>>;
	type BeforePassthrough = ValidateArgs<
		readonly [
			{ name: "pkgs"; type: "string"; variadic: true },
			{ name: "command"; type: "string"; variadic: "passthrough" },
		]
	>;
	type _beforePassthrough = Expect<
		Equal<BeforePassthrough[0]["FIX_VARIADIC_POSITION"], VariadicMessage>
	>;

	// Across `.args()` calls
	type AfterLast = AppendArgsChecks<
		readonly [{ name: "extra"; type: "string"; variadic: "passthrough" }],
		readonly [{ name: "file"; type: "string" }]
	>;
	type _afterLast = Expect<Equal<AfterLast[0]["FIX_LAST_ARGUMENT_POSITION"], Message>>;
	type AfterVariadic = readonly [{ name: "extra"; type: "string"; variadic: "afterDoubleDash" }];
	type _afterVariadic = Expect<
		Equal<
			AppendArgsChecks<readonly [{ name: "pkgs"; type: "string"; variadic: true }], AfterVariadic>,
			AfterVariadic
		>
	>;
	type _afterVariadicErrors = Expect<
		Equal<
			AppendArgsErrors<readonly [{ name: "pkgs"; type: "string"; variadic: true }], AfterVariadic>,
			unknown
		>
	>;
}

{
	// a required argument cannot follow an optional one, except an "afterDoubleDash" one
	type Message = "A required argument cannot follow an optional one";
	type Tag = ValidateArgs<
		readonly [
			{ name: "source"; type: "string" },
			{ name: "target"; type: "string"; required: true },
		]
	>;
	type _tag = Expect<Equal<Tag[1]["FIX_REQUIRED_AFTER_OPTIONAL"], Message>>;
	type _tagFirst = Expect<Equal<Extract<keyof Tag[0], `FIX_${string}`>, never>>;

	// A default makes an argument optional, and a later required variadic counts too.
	type Defaulted = ValidateArgs<
		readonly [
			{ name: "mode"; type: "string"; default: "fast" },
			{ name: "files"; type: "string"; variadic: true; required: true },
		]
	>;
	type _defaulted = Expect<Equal<Defaulted[1]["FIX_REQUIRED_AFTER_OPTIONAL"], Message>>;

	// A schema that accepts absence is optional; one that rejects it is required.
	type Optional = { "~standard": { types?: { input: string | undefined; output: string } } };
	type Required = { "~standard": { types?: { input: string; output: string } } };
	type Schemas = ValidateArgs<
		readonly [
			{ name: "a"; schema: Optional & StandardSchema },
			{ name: "b"; schema: Required & StandardSchema },
		]
	>;
	type _schemas = Expect<Equal<Schemas[1]["FIX_REQUIRED_AFTER_OPTIONAL"], Message>>;
	// An `unknown` input (`z.coerce.number()`) says nothing about absence, so it opens no gap.
	type Coerced = { "~standard": { types?: { input: unknown; output: number } } };
	type CoercedFirst = readonly [
		{ name: "port"; schema: Coerced & StandardSchema },
		{ name: "host"; type: "string"; required: true },
	];
	type _coercedFirst = Expect<Equal<ValidateArgs<CoercedFirst>, CoercedFirst>>;

	type Exec = readonly [
		{ name: "pod"; type: "string" },
		{ name: "command"; type: "string"; variadic: "afterDoubleDash"; required: true },
	];
	type _exec = Expect<Equal<ValidateArgs<Exec>, Exec>>;
	type Ordered = readonly [
		{ name: "src"; type: "string"; required: true },
		{ name: "dest"; type: "string" },
		{ name: "rest"; type: "string"; variadic: true },
	];
	type _ordered = Expect<Equal<ValidateArgs<Ordered>, Ordered>>;

	// Across `.args()` calls
	type Appended = AppendArgsChecks<
		readonly [{ name: "source"; type: "string" }],
		readonly [{ name: "target"; type: "string"; required: true }]
	>;
	type _appended = Expect<Equal<Appended[0]["FIX_REQUIRED_AFTER_OPTIONAL"], Message>>;
}
