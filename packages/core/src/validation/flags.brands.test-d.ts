import type { Equal, Expect } from "../../tests/helpers.ts";
import type { FlagsDef } from "../types.ts";
import type {
	ContextOwnedFlags,
	FlagRecordErrors,
	LocalSpellingsOf,
	DefinitionTreeSpellings,
	ProvideChecks,
	SpellingsOf,
	TreeSpellings,
	ValidateDefinitionFlags,
	ValidateExtensionFlags,
	LocalFlagBrand,
} from "./flags.brands.ts";

{
	// extracts all literal spellings from an existing flags record
	type Existing = {
		verbose: { type: "boolean"; short: "v" };
		output: { type: "string"; aliases: ["out", "destination"] };
	};
	type _check = Expect<
		Equal<SpellingsOf<Existing>, "verbose" | "v" | "output" | "out" | "destination">
	>;
}

{
	// derives local spellings from a closed flag record; a dynamic record stays open
	type Local = LocalSpellingsOf<{
		verbose: { type: "boolean"; short: "v" };
		output: { type: "string"; short: "o"; aliases: ["out"] };
	}>;
	type _check = Expect<Equal<Local, "verbose" | "v" | "output" | "o" | "out">>;
	type _open = Expect<Equal<LocalSpellingsOf<FlagsDef>, string>>;
	type _openAlias = Expect<
		Equal<LocalSpellingsOf<{ a: { type: "string"; aliases: string[] } }>, string>
	>;
}

{
	// brands Context-owned flag collisions inside one .provide() batch
	type First = { readonly _ownedFlags?: { token: { type: "string"; required: true } } };
	type Second = { readonly _ownedFlags?: { auth: { type: "string"; aliases: ["token"] } } };
	type Batch = ProvideChecks<never, readonly [First, Second]>;
	type _first = Expect<Equal<Extract<keyof Batch[0], "FIX_ALIAS_COLLISION">, never>>;
	type _second = Expect<
		Equal<Batch[1]["FIX_ALIAS_COLLISION"], 'Flag spelling "token" collides with an existing flag'>
	>;
}

{
	// brands Extension flag spellings colliding with existing or earlier-Extension flags
	type Ext<Flags extends FlagsDef, Provide extends readonly unknown[] = []> = {
		readonly _flagDefs?: Flags;
		readonly provide?: Provide;
	};
	type AppCollision = ValidateExtensionFlags<readonly [Ext<{ mode: { type: "boolean" } }>], "mode">;
	type CrossExtension = ValidateExtensionFlags<
		readonly [Ext<{ verbose: { type: "boolean" } }>, Ext<{ verbose: { type: "string" } }>],
		never
	>;
	type Provided = ValidateExtensionFlags<
		readonly [Ext<{}, readonly [{ _ownedFlags?: { mode: { type: "string" } } }]>],
		"mode"
	>;
	type Clean = ValidateExtensionFlags<readonly [Ext<{ verbose: { type: "boolean" } }>], "mode">;
	type Widened = ValidateExtensionFlags<readonly [{ readonly _flagDefs?: FlagsDef }], "mode">;
	type _app = Expect<
		Equal<
			AppCollision[0]["FIX_ALIAS_COLLISION"],
			'Extension flag spelling "mode" collides with an existing flag'
		>
	>;
	type _cross = Expect<
		Equal<
			CrossExtension[1]["FIX_ALIAS_COLLISION"],
			'Extension flag spelling "verbose" collides with an existing flag'
		>
	>;
	type _provided = Expect<
		Equal<
			Provided[0]["FIX_ALIAS_COLLISION"],
			'Extension flag spelling "mode" collides with an existing flag'
		>
	>;
	type _clean = Expect<Equal<Extract<keyof Clean[0], "FIX_ALIAS_COLLISION">, never>>;
	type _widened = Expect<Equal<Extract<keyof Widened[0], "FIX_ALIAS_COLLISION">, never>>;
}

{
	// recurses flag spellings through nested subcommand shapes
	type Tree = {
		deploy: {
			readonly flags: {};
			readonly children: {
				prod: {
					readonly flags: { force: { type: "boolean"; short: "f" } };
					readonly children: {};
				};
			};
		};
	};
	type _nested = Expect<Equal<TreeSpellings<Tree>, "force" | "f">>;
	type _any = Expect<Equal<TreeSpellings<any>, string>>;
}

{
	// brands a definition whose nested child flag collides with an Extension flag
	type Def = {
		readonly _shape?: {
			readonly flags: {};
			readonly children: {
				prod: {
					readonly flags: { force: { type: "boolean" } };
					readonly children: {};
				};
			};
		};
	};
	type _spellings = Expect<Equal<DefinitionTreeSpellings<readonly [Def]>, "force">>;

	type Branded = ValidateDefinitionFlags<readonly [Def], "force">;
	type _collision = Expect<
		Equal<
			Branded[0]["FIX_ALIAS_COLLISION"],
			'Flag spelling "force" collides with a registered Extension flag'
		>
	>;

	type Clean = ValidateDefinitionFlags<readonly [Def], "verbose">;
	type _clean = Expect<Equal<Extract<keyof Clean[0], "FIX_ALIAS_COLLISION">, never>>;

	// Widened shapes opt out via the `0 extends 1 & S` any-guard.
	type Widened = ValidateDefinitionFlags<readonly [{ readonly _shape?: any }], "force">;
	type _widened = Expect<Equal<Extract<keyof Widened[0], "FIX_ALIAS_COLLISION">, never>>;
}

{
	// brands invalid literal spellings beside an open template member (#357)
	type Mixed = `y-${string}`;
	type Reserved = LocalFlagBrand<{ name: "__proto__" | Mixed; type: "boolean" }>;
	type Empty = LocalFlagBrand<{ name: "" | Mixed; type: "boolean" }>;
	type NoPrefix = LocalFlagBrand<{ name: "no-x" | Mixed; type: "boolean" }>;
	type EmptyAlias = LocalFlagBrand<{ name: "x"; type: "boolean"; aliases: ["" | Mixed] }>;
	type NoPrefixAlias = LocalFlagBrand<{ name: "x"; type: "boolean"; aliases: ["no-x" | Mixed] }>;
	type ShortNoPrefix = LocalFlagBrand<{ name: "x"; type: "boolean"; short: "n" | Mixed }>;
	type EmptyShort = LocalFlagBrand<{ name: "x"; type: "boolean"; short: "" | Mixed }>;
	type Valid = LocalFlagBrand<{ name: "fixed" | Mixed; type: "boolean"; aliases: ["f" | Mixed] }>;
	type _reserved = Expect<
		Equal<Reserved["FIX_RESERVED_SPELLING"], 'Flag spelling "__proto__" is reserved'>
	>;
	type _empty = Expect<
		Equal<Empty["FIX_EMPTY_SPELLING"], "Flag names and aliases must be non-empty strings">
	>;
	type _noPrefix = Expect<Equal<NoPrefix["FIX_NO_PREFIX"], "Names must not start with no-">>;
	type _emptyAlias = Expect<
		Equal<EmptyAlias["FIX_EMPTY_SPELLING"], "Flag names and aliases must be non-empty strings">
	>;
	type _noPrefixAlias = Expect<
		Equal<NoPrefixAlias["FIX_NO_PREFIX"], "Names must not start with no-">
	>;
	type _shortNoPrefix = Expect<Equal<Extract<keyof ShortNoPrefix, "FIX_NO_PREFIX">, never>>;
	type _emptyShort = Expect<
		Equal<EmptyShort["FIX_EMPTY_SPELLING"], "Flag names and aliases must be non-empty strings">
	>;
	type _valid = Expect<Equal<Extract<keyof Valid, `FIX_${string}`>, never>>;

	// the same brands reach record keys, with or without risky fields
	type Record = FlagRecordErrors<
		{
			__proto__: { type: "boolean" };
			"": { type: "boolean" };
			"no-x": { type: "string"; short: "x" };
			fixed: { type: "boolean"; aliases: ["f" | Mixed] };
		},
		never
	>;
	type _recordReserved = Expect<
		Equal<Record["__proto__"]["FIX_RESERVED_SPELLING"], 'Flag spelling "__proto__" is reserved'>
	>;
	type _recordEmpty = Expect<
		Equal<Record[""]["FIX_EMPTY_SPELLING"], "Flag names and aliases must be non-empty strings">
	>;
	type _recordNoPrefix = Expect<
		Equal<Record["no-x"]["FIX_NO_PREFIX"], "Names must not start with no-">
	>;
	type _recordValid = Expect<Equal<keyof Record, "__proto__" | "" | "no-x">>;

	// a `string`-typed field must not absorb a sibling field's invalid literal
	type BroadName = LocalFlagBrand<{ name: string; type: "boolean"; aliases: [""] }>;
	type BroadNameNoPrefix = LocalFlagBrand<{ name: string; type: "boolean"; aliases: ["no-x"] }>;
	type BroadAliases = LocalFlagBrand<{ name: ""; type: "boolean"; aliases: string[] }>;
	type BroadShort = LocalFlagBrand<{ name: "__proto__"; type: "boolean"; short: string }>;
	type _broadName = Expect<
		Equal<BroadName["FIX_EMPTY_SPELLING"], "Flag names and aliases must be non-empty strings">
	>;
	type _broadNameNoPrefix = Expect<
		Equal<BroadNameNoPrefix["FIX_NO_PREFIX"], "Names must not start with no-">
	>;
	type _broadAliases = Expect<
		Equal<BroadAliases["FIX_EMPTY_SPELLING"], "Flag names and aliases must be non-empty strings">
	>;
	type _broadShort = Expect<
		Equal<BroadShort["FIX_RESERVED_SPELLING"], 'Flag spelling "__proto__" is reserved'>
	>;
}

{
	// record errors are keyed by the offending flag's name; valid flags stay out
	type Bad = { type: "string"; choices: ["x", "y"]; default: "z" };
	type Named = FlagRecordErrors<{ a: { type: "boolean" }; c: Bad }, never>;
	type _named = Expect<Equal<Named["c"]["FIX_DEFAULT_CHOICE"], "default must be one of choices">>;
	type _clean = Expect<Equal<keyof Named, "c">>;

	// every flag in a collision carries it, against peers and existing spellings
	type Collisions = {
		a: { type: "boolean"; short: "z" };
		b: { type: "boolean"; short: "z" };
		c: { type: "boolean"; short: "a" };
		d: { type: "boolean"; aliases: ["taken"] };
		e: { type: "boolean" };
	};
	type Checked = FlagRecordErrors<Collisions, "taken">;
	type _b = Expect<
		Equal<Checked["b"]["FIX_ALIAS_COLLISION"], 'Flag spelling "z" collides with an existing flag'>
	>;
	type _c = Expect<
		Equal<Checked["c"]["FIX_ALIAS_COLLISION"], 'Flag spelling "a" collides with an existing flag'>
	>;
	type _d = Expect<
		Equal<
			Checked["d"]["FIX_ALIAS_COLLISION"],
			'Flag spelling "taken" collides with an existing flag'
		>
	>;
	type _flagged = Expect<Equal<keyof Checked, "a" | "b" | "c" | "d">>;
	type _rejected = Expect<Equal<Collisions extends Collisions & Checked ? true : false, false>>;

	// integer-like keys are rejected; non-index numeric-looking keys are not
	type Integer = FlagRecordErrors<
		{
			"2": { type: "string" };
			"10": { type: "string" };
			"0": { type: "string" };
			"01": { type: "string" };
			"-1": { type: "string" };
			"1.5": { type: "string" };
		},
		never
	>;
	type _integer = Expect<Equal<keyof Integer, "2" | "10" | "0" | "-1">>;
	type _negative = Expect<Equal<Extract<keyof Integer["-1"], "FIX_INTEGER_LIKE_NAME">, never>>;
	type _integerMessage = Expect<
		Equal<
			Integer["10"]["FIX_INTEGER_LIKE_NAME"],
			"Flag names must not be integer-like; JavaScript lists such keys first"
		>
	>;

	// number keys must be quoted, integer-like or not
	type NumberKeys = FlagRecordErrors<{ 2: { type: "string" }; 1.5: { type: "string" } }, never>;
	type _numberKeys = Expect<Equal<keyof NumberKeys, 2 | 1.5>>;
	type _numberMessage = Expect<
		Equal<NumberKeys[1.5]["FIX_NUMBER_KEY"], "Flag names must be string keys; quote a numeric name">
	>;

	// an index signature is runtime-checked; literal keys beside it are still checked
	type Dynamic = FlagRecordErrors<FlagsDef, never>;
	type Mixed = FlagRecordErrors<FlagsDef & { out: { type: "string"; short: "oo" } }, never>;
	type _dynamic = Expect<Equal<keyof Dynamic, never>>;
	type _mixed = Expect<Equal<keyof Mixed, "out">>;
}

{
	// spellings that no argv token can match, keyed by the offending literal
	type Mixed = `y-${string}`;
	type Name = LocalFlagBrand<{ name: "a=b" | "-x" | "dry run" | Mixed; type: "boolean" }>;
	type Alias = LocalFlagBrand<{ name: "out"; type: "string"; aliases: ["o=x", "--output"] }>;
	type Short = LocalFlagBrand<{ name: "out"; type: "boolean"; short: "-" | " " }>;
	type ShortEquals = LocalFlagBrand<{ name: "eq"; type: "boolean"; short: "=" }>;
	type Open = LocalFlagBrand<{ name: string; type: "boolean"; aliases: string[]; short: string }>;
	type _name = Expect<
		Equal<
			Name["FIX_SPELLING_SHAPE"],
			| 'Flag spelling "a=b" must not contain "="'
			| 'Flag spelling "-x" must not start with "-"; the parser adds the dashes'
			| 'Flag spelling "dry run" must not contain whitespace'
		>
	>;
	type _alias = Expect<
		Equal<
			Alias["FIX_SPELLING_SHAPE"],
			| 'Flag spelling "o=x" must not contain "="'
			| 'Flag spelling "--output" must not start with "-"; the parser adds the dashes'
		>
	>;
	type _short = Expect<
		Equal<
			Short["FIX_SPELLING_SHAPE"],
			| 'Flag spelling "-" must not start with "-"; the parser adds the dashes'
			| 'Flag spelling " " must not contain whitespace'
		>
	>;
	type _shortEquals = Expect<Equal<Extract<keyof ShortEquals, `FIX_${string}`>, never>>;
	// optional and undefined-unioned spellings are still checked when supplied
	type OptionalShort = LocalFlagBrand<{ name: "t"; type: "boolean"; short?: "-" }>;
	type OptionalAliases = LocalFlagBrand<{ name: "t"; type: "string"; aliases?: readonly ["a=b"] }>;
	type UndefinedShort = LocalFlagBrand<{ name: "t"; type: "boolean"; short: " " | undefined }>;
	type _optionalShort = Expect<
		Equal<
			OptionalShort["FIX_SPELLING_SHAPE"],
			'Flag spelling "-" must not start with "-"; the parser adds the dashes'
		>
	>;
	type _optionalAliases = Expect<
		Equal<OptionalAliases["FIX_SPELLING_SHAPE"], 'Flag spelling "a=b" must not contain "="'>
	>;
	type _undefinedShort = Expect<
		Equal<UndefinedShort["FIX_SPELLING_SHAPE"], 'Flag spelling " " must not contain whitespace'>
	>;
	type OptionalOpen = LocalFlagBrand<{
		name: "t";
		type: "string";
		aliases?: readonly string[];
		short?: string;
	}>;
	type _optionalOpen = Expect<Equal<Extract<keyof OptionalOpen, `FIX_${string}`>, never>>;
	type _open = Expect<Equal<Extract<keyof Open, `FIX_${string}`>, never>>;
	// the per-flag and collision checks read optional fields too
	type OptionalLongShort = LocalFlagBrand<{ name: "t"; type: "boolean"; short?: "ab" }>;
	type OptionalSelfAlias = LocalFlagBrand<{ name: "t"; type: "boolean"; aliases?: readonly ["t"] }>;
	type _optionalLongShort = Expect<
		Equal<OptionalLongShort["FIX_SHORT_LENGTH"], "Short flags must be one character">
	>;
	type _optionalSelfAlias = Expect<
		Equal<OptionalSelfAlias["FIX_ALIAS_COLLISION"], "Flag repeats one of its own spellings">
	>;
	type OptionalShortCollision = FlagRecordErrors<
		{ verbose: { type: "boolean"; short: "v" }; t: { type: "boolean"; short?: "v" } },
		never
	>;
	type OptionalAliasCollision = FlagRecordErrors<
		{ verbose: { type: "boolean" }; t: { type: "boolean"; aliases?: readonly ["verbose"] } },
		never
	>;
	type OptionalExistingCollision = FlagRecordErrors<{ t: { type: "boolean"; short?: "v" } }, "v">;
	type _optionalShortCollision = Expect<
		Equal<"FIX_ALIAS_COLLISION" extends keyof OptionalShortCollision["t"] ? true : false, true>
	>;
	type _optionalAliasCollision = Expect<
		Equal<"FIX_ALIAS_COLLISION" extends keyof OptionalAliasCollision["t"] ? true : false, true>
	>;
	type _optionalExistingCollision = Expect<
		Equal<"FIX_ALIAS_COLLISION" extends keyof OptionalExistingCollision["t"] ? true : false, true>
	>;

	// record keys get the same check, with or without risky fields
	type Record = FlagRecordErrors<
		{ "a=b": { type: "boolean" }; "-x": { type: "string"; short: "x" }; ok: { type: "boolean" } },
		never
	>;
	type _recordKeys = Expect<Equal<keyof Record, "a=b" | "-x">>;
	type _recordPlain = Expect<
		Equal<Record["a=b"]["FIX_SPELLING_SHAPE"], 'Flag spelling "a=b" must not contain "="'>
	>;
}

{
	// empty env names and delimiters; widened values stay runtime-checked
	type EnvName = LocalFlagBrand<{ name: "t"; type: "string"; env: { name: "" } }>;
	type Delimiter = LocalFlagBrand<{ name: "t"; type: "string"; multiple: true; delimiter: "" }>;
	type EnvDelimiter = LocalFlagBrand<{
		name: "t";
		type: "string";
		multiple: true;
		delimiter: string;
		env: { name: "T"; delimiter: "" };
	}>;
	type Open = LocalFlagBrand<{
		name: "t";
		type: "string";
		multiple: true;
		delimiter: string;
		env: { name: string; delimiter: string };
	}>;
	type _envName = Expect<Equal<EnvName["FIX_EMPTY_ENV"], "env.name must be a non-empty string">>;
	type _delimiter = Expect<
		Equal<Delimiter["FIX_EMPTY_DELIMITER"], "delimiter and env.delimiter must be non-empty strings">
	>;
	type _envDelimiter = Expect<
		Equal<
			EnvDelimiter["FIX_EMPTY_DELIMITER"],
			"delimiter and env.delimiter must be non-empty strings"
		>
	>;
	type _open = Expect<Equal<Extract<keyof Open, `FIX_${string}`>, never>>;
	type Record = FlagRecordErrors<{ t: { type: "string"; env: { name: "" } } }, never>;
	type _record = Expect<Equal<Record["t"]["FIX_EMPTY_ENV"], "env.name must be a non-empty string">>;

	// optional and undefined-unioned literals are still known-empty when supplied
	type OptionalEnvDelimiter = LocalFlagBrand<{
		name: "t";
		type: "string";
		multiple: true;
		env: { name: "T"; delimiter?: "" };
	}>;
	type OptionalDelimiter = LocalFlagBrand<{
		name: "t";
		type: "string";
		multiple: true;
		delimiter?: "";
	}>;
	type UndefinedDelimiter = LocalFlagBrand<{
		name: "t";
		type: "string";
		multiple: true;
		delimiter: "" | undefined;
	}>;
	type OptionalEnv = LocalFlagBrand<{ name: "t"; type: "string"; env?: { name: "" } }>;
	type _optionalEnvDelimiter = Expect<
		Equal<
			OptionalEnvDelimiter["FIX_EMPTY_DELIMITER"],
			"delimiter and env.delimiter must be non-empty strings"
		>
	>;
	type _optionalDelimiter = Expect<
		Equal<
			OptionalDelimiter["FIX_EMPTY_DELIMITER"],
			"delimiter and env.delimiter must be non-empty strings"
		>
	>;
	type _undefinedDelimiter = Expect<
		Equal<
			UndefinedDelimiter["FIX_EMPTY_DELIMITER"],
			"delimiter and env.delimiter must be non-empty strings"
		>
	>;
	type _optionalEnv = Expect<
		Equal<OptionalEnv["FIX_EMPTY_ENV"], "env.name must be a non-empty string">
	>;
	type OptionalOpen = LocalFlagBrand<{
		name: "t";
		type: "string";
		multiple: true;
		delimiter?: string;
		env?: { name: string; delimiter?: string };
	}>;
	type _optionalOpen = Expect<Equal<Extract<keyof OptionalOpen, `FIX_${string}`>, never>>;
}

{
	// distributes over a Context union: one flagless member must not erase the others' owned flags
	type Owner = { readonly _ownedFlags?: { alpha: { type: "string" } } };
	type Plain = { readonly _ownedFlags?: {} };
	type _union = Expect<Equal<ContextOwnedFlags<Owner | Plain>, { alpha: { type: "string" } } | {}>>;
}
