import type { Equal, Expect } from "../tests/helpers.ts";
import type {
	ArgDef,
	ArgsDef,
	ExecuteOptions,
	InferArgValue,
	InferArgs,
	InferFlags,
} from "./types.ts";

// InferArgs type inference
{
	// maps arg with default to non-optional type
	type Args = readonly [{ name: "port"; type: "number"; default: 3000 }];
	type Result = InferArgs<Args>;
	type _check = Expect<Equal<Result, { port: number }>>;
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

// InferFlags type inference
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

// InferFlags — parse field inference
{
	// maps parse returning URL to URL | undefined
	type Flags = { x: { type: "string"; parse: (s: string) => URL } };
	type Result = InferFlags<Flags>;
	type _check = Expect<Equal<Result, { x: URL | undefined }>>;
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
// InferArgs duplicate-name equivalence
// ────────────────────────────────────────────────────────────────────────────

{
	// Freeze the pre-accumulator algorithm as an equivalence oracle at the public seam.
	type LegacyDuplicates<
		A extends readonly ArgDef[],
		Seen extends string = never,
	> = A extends readonly [infer H extends ArgDef, ...infer T extends readonly ArgDef[]]
		? (H["name"] & Seen) | LegacyDuplicates<T, Seen | H["name"]>
		: never;
	type LegacyDuplicateArgs<A extends readonly ArgDef[]> = A extends readonly [
		infer H extends ArgDef,
		...infer T extends readonly ArgDef[],
	]
		? { [K in H["name"]]: InferArgValue<H> } & LegacyDuplicateArgs<T>
		: {};
	type LegacyTuple<A extends readonly ArgDef[]> = number extends A["length"]
		? {}
		: [LegacyDuplicates<A>] extends [never]
			? { [D in A[number] as D["name"]]: InferArgValue<D> }
			: LegacyDuplicateArgs<A>;
	type LegacyArgs<A> = A extends readonly ArgDef[]
		? { [K in keyof LegacyTuple<A>]: LegacyTuple<A>[K] }
		: Record<string, never>;
	type Text = { name: "x"; type: "string"; required: true };
	type Number = { name: "x"; type: "number"; required: true };
	type Other = { name: "y"; type: "boolean" };
	type Open = { name: string; type: "string" };
	type UnionName = { name: "x" | "y"; type: "number" };
	type Matrix = [
		readonly [],
		readonly [Text],
		readonly [Text, Other],
		readonly [Text, Text],
		readonly [Text, Number],
		readonly [Text, Other, Number, Other],
		readonly [Text] | readonly [Other],
		readonly [Text, Number] | readonly [Other],
		readonly [Text | Other, Number],
		readonly [UnionName, Text],
		readonly [Open, Text],
		readonly [never],
		readonly [Text, never, Number],
		never,
		readonly ArgDef[],
		readonly [Text, ...Other[]],
		readonly [Text, Number, ...Other[]],
		readonly [Text, Other?],
	];
	type Results = { [K in keyof Matrix]: Equal<InferArgs<Matrix[K]>, LegacyArgs<Matrix[K]>> };
	type _equivalent = Expect<Equal<Results[number], true>>;
	// Explicit incompatible duplicates stay impossible rather than becoming a scalar union.
	type _duplicate = Expect<Equal<InferArgs<readonly [Text, Number]>, { x: never }>>;
}

{
	// ExecuteOptions.argv accepts readonly arrays such as `as const` fixtures
	const argv = ["build", "--watch"] as const;
	const options: ExecuteOptions = { argv };
	void options;
}

{
	// An OutputSink receives bytes too, so a string-only writer is rejected; a Node.js stream fits.
	const lines: string[] = [];
	const textOnly: ExecuteOptions = {
		// @ts-expect-error -- `stdout.write(bytes)` would hand it a Uint8Array
		io: { stdout: { write: (line: string) => lines.push(line) } },
	};
	const stream: ExecuteOptions = { io: { stdout: process.stdout, stderr: process.stderr } };
	void textOnly;
	void stream;
}
