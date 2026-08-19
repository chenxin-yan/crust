import { describe, expect, it } from "bun:test";

import type {
	CommandDefinitionSpellings,
	ValidateCommandConfig,
	ValidateCommandDefinitions,
} from "./commands.brands.ts";

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;
type Def<Name extends string, Aliases extends readonly string[] = readonly string[]> = {
	readonly name: Name;
	readonly _aliases?: Aliases;
};

describe("compile-time command validation", () => {
	it("extracts narrowed command and alias spellings", () => {
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

		expect(true).toBe(true);
	});

	it("brands sibling collisions across and within add batches", () => {
		type Across = ValidateCommandDefinitions<readonly [Def<"info", readonly ["i"]>], "issue" | "i">;
		type _across = Expect<
			Equal<
				Across[0]["FIX_COMMAND_COLLISION"],
				'Command name or alias "i" collides with a sibling command'
			>
		>;

		type Within = ValidateCommandDefinitions<readonly [Def<"build", readonly ["b"]>, Def<"b">]>;
		type _within = Expect<
			Equal<
				Within[1]["FIX_COMMAND_COLLISION"],
				'Command name or alias "b" collides with a sibling command'
			>
		>;

		expect(true).toBe(true);
	});

	it("brands empty command names at the composition site and lets widened names opt out", () => {
		type Empty = ValidateCommandDefinitions<readonly [Def<"">]>;
		type Valid = ValidateCommandDefinitions<readonly [Def<"issue">]>;
		type Widened = ValidateCommandDefinitions<readonly [Def<string>]>;
		type _empty = Expect<
			Equal<Empty[0]["FIX_EMPTY_NAME"], "Command name must be a non-empty string">
		>;
		type _valid = Expect<Equal<Extract<keyof Valid[0], "FIX_EMPTY_NAME">, never>>;
		type _widened = Expect<Equal<Extract<keyof Widened[0], "FIX_EMPTY_NAME">, never>>;

		expect(true).toBe(true);
	});

	it("brands every statically known invalid alias shape", () => {
		type Empty = ValidateCommandConfig<"issue", { aliases: readonly [""] }>;
		type Dash = ValidateCommandConfig<"issue", { aliases: readonly ["-i"] }>;
		type Space = ValidateCommandConfig<"issue", { aliases: readonly ["my issue"] }>;
		type Tab = ValidateCommandConfig<"issue", { aliases: readonly ["my\tissue"] }>;
		type OwnName = ValidateCommandConfig<"issue", { aliases: readonly ["issue"] }>;

		type _empty = Expect<
			Equal<
				Empty["FIX_ALIAS_SHAPE"],
				'Subcommand "issue" has an invalid alias: must be a non-empty string'
			>
		>;
		type _dash = Expect<
			Equal<
				Dash["FIX_ALIAS_SHAPE"],
				'Subcommand "issue" alias "-i" must not start with "-" (reserved for flags)'
			>
		>;
		type _space = Expect<
			Equal<
				Space["FIX_ALIAS_SHAPE"],
				'Subcommand "issue" alias "my issue" must not contain whitespace'
			>
		>;
		type _tab = Expect<
			Equal<
				Tab["FIX_ALIAS_SHAPE"],
				'Subcommand "issue" alias "my\tissue" must not contain whitespace'
			>
		>;
		type _ownName = Expect<
			Equal<
				OwnName["FIX_ALIAS_SHAPE"],
				'Subcommand "issue" alias "issue" must not equal its own canonical name'
			>
		>;

		expect(true).toBe(true);
	});

	it("opts widened aliases out of shape validation", () => {
		type Widened = ValidateCommandConfig<"issue", { aliases: readonly string[] }>;
		type _check = Expect<Equal<keyof Widened, never>>;

		expect(true).toBe(true);
	});
});
