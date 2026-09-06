import type { Equal, Expect } from "../../tests/helpers.ts";
import type {
	CommandDefinitionSpellings,
	ValidateCommandConfig,
	ValidateCommandDefinitions,
	ValidateExtensionCommands,
} from "./commands.brands.ts";
type Def<Name extends string, Aliases extends readonly string[] = readonly string[]> = {
	readonly name: Name;
	readonly _aliases?: Aliases;
};

// compile-time command validation
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
	// brands sibling collisions across and within add batches
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
}

{
	// brands Extension command collisions and lets widened commands opt out
	type Ext<Commands extends readonly unknown[]> = { readonly commands?: Commands };
	type AppCollision = ValidateExtensionCommands<
		readonly [Ext<readonly [Def<"inspect", readonly ["scan"]>]>],
		"scan"
	>;
	type CrossExtension = ValidateExtensionCommands<
		readonly [Ext<readonly [Def<"build", readonly ["b"]>]>, Ext<readonly [Def<"b">]>],
		never
	>;
	type Clean = ValidateExtensionCommands<readonly [Ext<readonly [Def<"inspect">]>], "build">;
	type Widened = ValidateExtensionCommands<readonly [Ext<readonly [Def<string>]>], "build">;
	type _app = Expect<
		Equal<
			AppCollision[0]["FIX_COMMAND_COLLISION"],
			'Extension command "scan" collides with an existing command'
		>
	>;
	type _cross = Expect<
		Equal<
			CrossExtension[1]["FIX_COMMAND_COLLISION"],
			'Extension command "b" collides with an existing command'
		>
	>;
	type _clean = Expect<Equal<Extract<keyof Clean[0], "FIX_COMMAND_COLLISION">, never>>;
	type _widened = Expect<Equal<Extract<keyof Widened[0], "FIX_COMMAND_COLLISION">, never>>;
}

{
	// brands empty command names at the composition site and lets widened names opt out
	type Empty = ValidateCommandDefinitions<readonly [Def<"">]>;
	type Valid = ValidateCommandDefinitions<readonly [Def<"issue">]>;
	type Widened = ValidateCommandDefinitions<readonly [Def<string>]>;
	type _empty = Expect<
		Equal<Empty[0]["FIX_EMPTY_NAME"], "Command name must be a non-empty string">
	>;
	type _valid = Expect<Equal<Extract<keyof Valid[0], "FIX_EMPTY_NAME">, never>>;
	type _widened = Expect<Equal<Extract<keyof Widened[0], "FIX_EMPTY_NAME">, never>>;
}

{
	// brands every statically known invalid alias shape
	type Empty = ValidateCommandConfig<"issue", { aliases: readonly [""] }>;
	type Dash = ValidateCommandConfig<"issue", { aliases: readonly ["-i"] }>;
	type Space = ValidateCommandConfig<"issue", { aliases: readonly ["my issue"] }>;
	type Tab = ValidateCommandConfig<"issue", { aliases: readonly ["my\tissue"] }>;
	type Newline = ValidateCommandConfig<"issue", { aliases: readonly ["my\nissue"] }>;
	// .as() rename landing on an own alias: composition-site brand
	type SelfAlias = ValidateCommandDefinitions<
		readonly [{ name: "i"; _aliases?: readonly ["i", "iss"] }]
	>;
	type _selfAlias = Expect<
		Equal<
			SelfAlias[0]["FIX_ALIAS_SHAPE"],
			'Command "i" must not list its own canonical name as an alias'
		>
	>;
	type Carriage = ValidateCommandConfig<"issue", { aliases: readonly ["my\rissue"] }>;
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
	type _newline = Expect<
		Equal<
			Newline["FIX_ALIAS_SHAPE"],
			'Subcommand "issue" alias "my\nissue" must not contain whitespace'
		>
	>;
	type _carriage = Expect<
		Equal<
			Carriage["FIX_ALIAS_SHAPE"],
			'Subcommand "issue" alias "my\rissue" must not contain whitespace'
		>
	>;
	type _ownName = Expect<
		Equal<
			OwnName["FIX_ALIAS_SHAPE"],
			'Subcommand "issue" alias "issue" must not equal its own canonical name'
		>
	>;
}

{
	// opts widened aliases out of shape validation
	type Widened = ValidateCommandConfig<"issue", { aliases: readonly string[] }>;
	type _check = Expect<Equal<keyof Widened, never>>;
}
