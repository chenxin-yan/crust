import type { Equal, Expect } from "../../tests/helpers.ts";
import type {
	CommandDefinitionSpellings,
	LocalSectionsBrand,
	ValidateCommandConfig,
	ValidateCommandDefinitions,
	ValidateExtensionCommands,
} from "./commands.brands.ts";
type Def<Name extends string, Aliases extends readonly string[] = readonly []> = {
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
	// brands Extension command collisions, including an open command namespace
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
	// brands invalid literal members beside an open template member (#357)
	type Mixed = `mode-${string}`;
	type Empty = ValidateCommandDefinitions<readonly [Def<"" | Mixed>]>;
	type Reserved = ValidateCommandDefinitions<readonly [Def<"__proto__" | Mixed>]>;
	type Valid = ValidateCommandDefinitions<readonly [Def<"fixed" | Mixed>]>;
	type _empty = Expect<
		Equal<Empty[0]["FIX_EMPTY_NAME"], "Command name must be a non-empty string">
	>;
	type _reserved = Expect<
		Equal<Reserved[0]["FIX_RESERVED_NAME"], 'Command name "__proto__" is reserved'>
	>;
	type _valid = Expect<Equal<Extract<keyof Valid[0], `FIX_${string}`>, never>>;
	// a definition union: the open variant's `string` must not absorb the literal variant's name
	type EmptyDefs = ValidateCommandDefinitions<readonly [Def<""> | Def<string>]>;
	type ReservedDefs = ValidateCommandDefinitions<readonly [Def<"__proto__"> | Def<string>]>;
	type _emptyDefs = Expect<
		Equal<EmptyDefs[0]["FIX_EMPTY_NAME"], "Command name must be a non-empty string">
	>;
	type _reservedDefs = Expect<
		Equal<ReservedDefs[0]["FIX_RESERVED_NAME"], 'Command name "__proto__" is reserved'>
	>;

	type EmptyAlias = ValidateCommandConfig<"issue", { aliases: readonly ["", Mixed] }>;
	type DashAlias = ValidateCommandConfig<"issue", { aliases: readonly ["-i" | Mixed] }>;
	type OwnAlias = ValidateCommandConfig<"issue", { aliases: readonly ["issue" | Mixed] }>;
	type ValidAlias = ValidateCommandConfig<"issue", { aliases: readonly ["i" | Mixed] }>;
	type _emptyAlias = Expect<
		Equal<
			EmptyAlias["FIX_ALIAS_SHAPE"],
			'Subcommand "issue" has an invalid alias: must be a non-empty string'
		>
	>;
	type _dashAlias = Expect<
		Equal<
			DashAlias["FIX_ALIAS_SHAPE"],
			'Subcommand "issue" alias "-i" must not start with "-" (reserved for flags)'
		>
	>;
	type _ownAlias = Expect<
		Equal<
			OwnAlias["FIX_ALIAS_SHAPE"],
			'Subcommand "issue" alias "issue" must not equal its own canonical name'
		>
	>;
	type _validAlias = Expect<Equal<keyof ValidAlias, never>>;
	// .as() rename landing on a mixed alias union's literal member
	type SelfAlias = ValidateCommandDefinitions<
		readonly [{ name: "i"; _aliases?: readonly ["i" | Mixed] }]
	>;
	type _selfAlias = Expect<
		Equal<
			SelfAlias[0]["FIX_ALIAS_SHAPE"],
			'Command "i" must not list its own canonical name as an alias'
		>
	>;
	// variants of a definition union are compared with their own aliases only
	type CrossAlias = ValidateCommandDefinitions<
		readonly [Def<"x", readonly ["y"]> | Def<"y", readonly ["x"]>]
	>;
	type _crossAlias = Expect<Equal<keyof Omit<CrossAlias[0], "name" | "_aliases">, never>>;
	// a valid variant does not absorb a self-aliased sibling's brand
	type OneSelfAliased = ValidateCommandDefinitions<
		readonly [Def<"x", readonly ["x"]> | Def<"y", readonly ["z"]>]
	>;
	type _oneSelfAliased = Expect<
		Equal<
			OneSelfAliased[0]["FIX_ALIAS_SHAPE"],
			'Command "x" must not list its own canonical name as an alias'
		>
	>;
	// open members still keep the attachment namespace open
	type _spellings = Expect<Equal<CommandDefinitionSpellings<Def<"fixed" | Mixed>>, never>>;
	type _aliasSpellings = Expect<
		Equal<CommandDefinitionSpellings<Def<"issue", readonly ["i" | Mixed]>>, "issue">
	>;
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
	// brands an empty audience even when another section-union branch is valid
	type Mixed = LocalSectionsBrand<{
		sections: readonly [
			| { readonly title: "Bad"; readonly body: "Body"; readonly only: readonly [] }
			| { readonly title: "Good"; readonly body: "Body" },
		];
	}>;
	type Valid = LocalSectionsBrand<{
		sections: readonly [
			| { readonly title: "One"; readonly body: "Body" }
			| { readonly title: "Two"; readonly body: "Body" },
		];
	}>;
	type _mixed = Expect<
		Equal<Mixed["sections"][0]["FIX_SECTION_AUDIENCE"], "Section audience must be nonempty">
	>;
	type _valid = Expect<Equal<Extract<keyof Valid["sections"][0], "FIX_SECTION_AUDIENCE">, never>>;
}

{
	// opts widened aliases out of shape validation
	type Widened = ValidateCommandConfig<"issue", { aliases: readonly string[] }>;
	type _check = Expect<Equal<keyof Widened, never>>;
}
