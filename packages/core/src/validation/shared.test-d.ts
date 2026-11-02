import type { Equal, Expect } from "../../tests/helpers.ts";
import type { IsUnion } from "./shared.ts";

// IsUnion
{
	type _never = Expect<Equal<IsUnion<never>, false>>;
	type _any = Expect<Equal<IsUnion<any>, false>>;
	type _unknown = Expect<Equal<IsUnion<unknown>, false>>;
	type _literal = Expect<Equal<IsUnion<"a">, false>>;
	type _literals = Expect<Equal<IsUnion<"a" | "b">, true>>;
	type _boolean = Expect<Equal<IsUnion<boolean>, true>>;
	// a member that covers every other member must not make the result `boolean`
	type _supertypeMember = Expect<Equal<IsUnion<{ a: 1 } | { a: 1; b: 2 }>, true>>;
}
