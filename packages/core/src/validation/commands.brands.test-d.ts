import type { Equal, Expect } from "../../tests/helpers.ts";
import type { CommandDefinitionSpellings } from "./commands.brands.ts";

type Def<Name extends string, Aliases extends readonly string[] = readonly []> = {
	readonly name: Name;
	readonly _aliases?: Aliases;
};

// command tree spellings
{
	// extracts narrowed command and alias spellings
	type _check = Expect<
		Equal<
			CommandDefinitionSpellings<Def<"issue", readonly ["issues", "i"]>>,
			"issue" | "issues" | "i"
		>
	>;
	type _widened = Expect<Equal<CommandDefinitionSpellings<Def<string, readonly ["i"]>>, never>>;
	type _mixedUnion = Expect<
		Equal<
			CommandDefinitionSpellings<Def<"logs", readonly ["log"]> | Def<"init">>,
			"logs" | "log" | "init"
		>
	>;
}

{
	// open members keep the attachment namespace open
	type Mixed = `mode-${string}`;
	type _spellings = Expect<Equal<CommandDefinitionSpellings<Def<"fixed" | Mixed>>, never>>;
	type _aliasSpellings = Expect<
		Equal<CommandDefinitionSpellings<Def<"issue", readonly ["i" | Mixed]>>, "issue">
	>;
}
