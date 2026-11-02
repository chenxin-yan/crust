import type { Equal, Expect } from "../../tests/helpers.ts";
import type { HasClosedNames, IsUnion } from "./shared.ts";

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

// HasClosedNames
{
	type _closed = Expect<Equal<HasClosedNames<readonly [{ name: "a" }, { name: "b" }]>, true>>;
	type _open = Expect<Equal<HasClosedNames<readonly [{ name: "a" }, { name: string }]>, false>>;
	type _array = Expect<Equal<HasClosedNames<readonly { name: "a" }[]>, false>>;
	// a conditional member (`[cond ? a : b]`) may carry either name
	type _unionMember = Expect<
		Equal<HasClosedNames<readonly [{ name: "a" } | { name: "b" }]>, false>
	>;
}
