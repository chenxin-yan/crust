import type { InferOutput, StandardSchema } from "./schema.ts";

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

// Compile-time compatibility and inference; checked by check:types.
const schema = {
	"~standard": {
		version: 1 as const,
		vendor: "crust-test",
		types: undefined as { input: string; output: number } | undefined,
		validate: (value: NonNullable<StandardSchema["~standard"]["types"]>["input"]) => ({
			value: Number(value),
		}),
	},
};
schema satisfies StandardSchema<string, number>;
type _Output = Expect<Equal<InferOutput<typeof schema>, number>>;
