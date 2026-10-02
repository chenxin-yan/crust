import type { ResolvePrimitive } from "./primitive.ts";

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

type _Distributive = Expect<Equal<ResolvePrimitive<"number" | "boolean">, number | boolean>>;
