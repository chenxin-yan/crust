import type { Equal, Expect } from "../tests/helpers.ts";
import type { ArgDef, InferArgs, InferArgValue } from "./types.ts";

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
