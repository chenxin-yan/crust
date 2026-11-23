import type { Equal, Expect } from "../../tests/helpers.ts";
import type { FlagsDef } from "../types.ts";
import type { ContextOwnedFlags, FlagRecordErrors } from "./flags.brands.ts";

{
	// record errors are keyed by the offending flag's name; valid flags stay out
	type Bad = { type: "string"; choices: ["x", "y"]; default: "z" };
	type Named = FlagRecordErrors<{ a: { type: "boolean" }; c: Bad }>;
	type _named = Expect<Equal<Named["c"]["FIX_DEFAULT_CHOICE"], "default must be one of choices">>;
	type _clean = Expect<Equal<keyof Named, "c">>;

	// names, spellings and collisions are left to the definition checks
	type Spellings = FlagRecordErrors<{
		a: { type: "boolean"; short: "z" };
		b: { type: "boolean"; short: "z" };
		"no-c": { type: "boolean"; aliases: ["a b"] };
		"2": { type: "string" };
	}>;
	type _spellings = Expect<Equal<Spellings, unknown>>;

	// an index signature is open; literal keys beside it are still checked
	type Dynamic = FlagRecordErrors<FlagsDef>;
	type Mixed = FlagRecordErrors<FlagsDef & { out: Bad }>;
	type _dynamic = Expect<Equal<Dynamic, unknown>>;
	type _mixed = Expect<Equal<keyof Mixed, "out">>;
}

{
	// distributes over a Context union: one flagless member must not erase the others' owned flags
	type Owner = { readonly _ownedFlags?: { alpha: { type: "string" } } };
	type Plain = { readonly _ownedFlags?: {} };
	type _union = Expect<Equal<ContextOwnedFlags<Owner | Plain>, { alpha: { type: "string" } } | {}>>;
}
