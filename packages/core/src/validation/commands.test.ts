import { describe, expect, it } from "bun:test";

import { createCommandNode } from "../command/node.ts";
import {
	type CommandDefinitionSpellings,
	validateIncomingAliases,
	type ValidateCommandConfig,
	type ValidateCommandDefinitions,
} from "./commands.ts";

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

describe("validateIncomingAliases", () => {
	function sibling(name: string, aliases?: readonly string[]) {
		const node = createCommandNode(name);
		if (aliases) node.meta.aliases = aliases;
		return node;
	}

	it("accepts non-colliding command aliases", () => {
		expect(() =>
			validateIncomingAliases(
				{ canonicalName: "version", aliases: ["v"] },
				{ issue: sibling("issue", ["issues", "i"]) },
				"version",
			),
		).not.toThrow();
	});

	it("rejects an alias colliding with a sibling canonical name", () => {
		expect(() =>
			validateIncomingAliases(
				{ canonicalName: "compile", aliases: ["build"] },
				{ build: sibling("build") },
				"compile",
			),
		).toThrow(/collides with sibling canonical name "build"/);
	});

	it("rejects aliases colliding across sibling commands", () => {
		expect(() =>
			validateIncomingAliases(
				{ canonicalName: "info", aliases: ["i"] },
				{ issue: sibling("issue", ["i"]) },
				"info",
			),
		).toThrow(/collides with alias of sibling "issue"/);
	});

	it("rejects a canonical name colliding with a sibling alias", () => {
		expect(() =>
			validateIncomingAliases({ canonicalName: "i" }, { issue: sibling("issue", ["i"]) }, "i"),
		).toThrow(/canonical name "i" collides with alias of sibling "issue"/);
	});

	it("rejects duplicate and shape-invalid aliases", () => {
		expect(() =>
			validateIncomingAliases({ canonicalName: "issue", aliases: ["i", "i"] }, {}, "issue"),
		).toThrow(/lists alias "i" more than once/);
		expect(() =>
			validateIncomingAliases({ canonicalName: "issue", aliases: ["my issue"] }, {}, "issue"),
		).toThrow(/must not contain whitespace/);
	});

	it('rejects aliases beginning with "-"', () => {
		expect(() =>
			validateIncomingAliases({ canonicalName: "issue", aliases: ["--issues"] }, {}, "issue"),
		).toThrow('alias "--issues" must not start with "-" (reserved for flags)');
	});
});
