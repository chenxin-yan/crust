import type { Equal, Expect } from "../../tests/helpers.ts";
import type { AppendArgsChecks, ValidateVariadicArgs } from "./args.brands.ts";

// ValidateVariadicArgs type inference
{
	// resolves to identity when variadic is the last arg
	type Args = readonly [
		{ name: "name"; type: "string"; required: true },
		{ name: "files"; type: "string"; variadic: true },
	];
	type Result = ValidateVariadicArgs<Args>;
	type _check = Expect<Equal<Result, Args>>;
}

{
	// brands empty argument names
	type Result = ValidateVariadicArgs<readonly [{ name: ""; type: "string" }]>;
	type _empty = Expect<Equal<Result[0]["FIX_EMPTY_NAME"], "Argument names must be non-empty">>;
	type Widened = ValidateVariadicArgs<readonly [{ name: string; type: "string" }]>;
	type _widened = Expect<Equal<Extract<keyof Widened[0], "FIX_EMPTY_NAME">, never>>;
}

{
	// brands the specific non-last arg that is variadic
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
}

{
	// brands a repeated name within one tuple
	type Args = readonly [{ name: "file"; type: "string" }, { name: "file"; type: "string" }];
	type Result = ValidateVariadicArgs<Args>;
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
	type Result = ValidateVariadicArgs<Args>;
	type _check = Expect<
		Equal<Result[0]["FIX_ASYNC_PARSE"], "parse must be synchronous; do async work in run()">
	>;
}

{
	// opts widened definitions out of compile-time checks
	// Widened names opt out instead of receiving false-positive duplicate
	// branding.
	type Defs = readonly [{ name: string; type: "string" }, { name: string; type: "string" }];
	type Result = ValidateVariadicArgs<Defs, "file">;
	type _first = Expect<Equal<Extract<keyof Result[0], `FIX_${string}`>, never>>;
	type _second = Expect<Equal<Extract<keyof Result[1], `FIX_${string}`>, never>>;
}

{
	// brands literal defaults outside literal choices
	type Invalid = ValidateVariadicArgs<
		readonly [{ name: "mode"; type: "string"; choices: ["a", "b"]; default: "z" }]
	>;
	type Valid = ValidateVariadicArgs<
		readonly [{ name: "mode"; type: "string"; choices: ["a", "b"]; default: "a" }]
	>;
	type Widened = ValidateVariadicArgs<
		readonly [{ name: "mode"; type: "string"; choices: readonly string[]; default: string }]
	>;
	type _invalid = Expect<Equal<Invalid[0]["FIX_DEFAULT_CHOICE"], "default must be one of choices">>;
	type _valid = Expect<Equal<Extract<keyof Valid[0], "FIX_DEFAULT_CHOICE">, never>>;
	type _widened = Expect<Equal<Extract<keyof Widened[0], "FIX_DEFAULT_CHOICE">, never>>;
}

{
	// resolves to identity for empty args
	type Args = readonly [];
	type Result = ValidateVariadicArgs<Args>;
	type _check = Expect<Equal<Result, Args>>;
}
