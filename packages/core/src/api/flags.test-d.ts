import type { StandardSchema } from "@crustjs/utils/schema";

import { Crust, defineCommand } from "../command/crust.ts";
import type { ArgsDef, FlagsDef } from "../types.ts";
import { defineArg, defineFlag } from "./flags.ts";

// Compile-time regression checks; intentionally never invoked.
// rejects invalid choice defaults at the builder call
function _typecheckRejectsInvalidChoiceDefaultsAtTheBuilderCall() {
	// @ts-expect-error -- default falls outside the literal choices
	new Crust("cli").flags({ mode: { type: "string", choices: ["a", "b"], default: "z" } });
}

function _optionalParserDefinitions(maybeAsync: ((raw: string) => Promise<number>) | undefined) {
	type OptionalAsyncDefinition = {
		readonly type: "string";
		readonly parse?: (raw: string) => Promise<number>;
	};
	const asyncDefinition: OptionalAsyncDefinition = {
		type: "string",
		parse: async (raw) => Number(raw),
	};
	// @ts-expect-error -- optional declared parsers must still be synchronous when present
	defineFlag(asyncDefinition);
	// @ts-expect-error -- a parser that may be unset must be synchronous when it is set
	defineFlag({ type: "string", parse: maybeAsync });
	// @ts-expect-error -- the same for an argument
	defineArg("value", { type: "string", parse: maybeAsync });

	type OptionalSyncDefinition = {
		readonly type: "string";
		readonly parse?: (raw: string) => number;
	};
	const syncDefinition: OptionalSyncDefinition = {
		type: "string",
		parse: (raw) => Number(raw),
	};
	defineFlag(syncDefinition);
}

function _localDefinitions(name: string, aliases: string[], choices: string[], value: string) {
	new Crust("cli").flags({ [name]: { type: "boolean" } });
	defineFlag({ type: "boolean", aliases });
	defineArg("bad", { type: "string", parse: (_raw): unknown => 1 });
	defineFlag({ type: "string", parse: (_raw): object => ({}) });
	defineFlag({ type: "string", choices, default: value });
	// @ts-expect-error -- literal membership is owned by the helper
	defineArg("mode", { type: "string", choices: ["a"], default: "b" });
	defineArg(name, { type: "string", choices, default: value });
}

// `env` is a variable name or a non-empty list of names on every variant except `count`;
// `delimiter`, which also splits the variable's text, requires `multiple: true`.
function _envAndDelimiter(schema: StandardSchema, names: string[]) {
	defineFlag({ type: "string", env: "APP_TOKEN", required: true });
	defineFlag({ type: "number", env: ["APP_PORT", "PORT"], default: 3000 });
	defineFlag({ type: "boolean", env: "APP_COLOR", negatable: true });
	defineFlag({ type: "string", schema, env: "APP_PORT" });
	defineFlag({ type: "string", multiple: true, env: "APP_TAGS", delimiter: "," });
	defineFlag({ type: "number", multiple: true, delimiter: ":" });
	defineFlag({ type: "string", schema, multiple: true, env: "APP_TAGS", delimiter: "," });
	defineFlag({ type: "boolean", schema, multiple: true, env: "APP_ENABLED", delimiter: "," });
	// @ts-expect-error -- the `{ name, delimiter }` object is gone
	defineFlag({ type: "string", env: { name: "APP_TOKEN" } });
	// @ts-expect-error -- an empty list names no variable
	defineFlag({ type: "string", env: [] });
	// @ts-expect-error -- a list that may be empty names no variable either
	defineFlag({ type: "string", env: names });
	// @ts-expect-error -- a count reads no variable
	defineFlag({ type: "count", env: "VERBOSE" });
	// @ts-expect-error -- delimiter requires multiple: true
	defineFlag({ type: "string", env: "APP_TAGS", delimiter: "," });
	// @ts-expect-error -- schema-backed flags use the same occurrence restriction
	defineFlag({ type: "string", schema, env: "APP_TAGS", delimiter: "," });
	// @ts-expect-error -- delimiter requires multiple: true
	defineFlag({ type: "string", delimiter: "," });
	// @ts-expect-error -- delimiter requires multiple: true on schema-backed flags too
	defineFlag({ type: "string", schema, delimiter: "," });
	// @ts-expect-error -- delimiter requires multiple: true
	new Crust("cli").flags({ tag: { type: "string", delimiter: "," } });
}

// `negatable` is for booleans; `min` and `max` for numbers and integers; `count` takes neither.
function _negatableRangeCount(schema: StandardSchema) {
	defineFlag({ type: "boolean", negatable: true, multiple: true });
	defineFlag({ type: "integer", min: 1, max: 65535, default: 80 });
	defineFlag({ type: "number", min: 0, max: 1, multiple: true });
	defineArg("port", { type: "integer", min: 1 });
	defineFlag({ type: "count", short: "v", aliases: ["verbose"] });
	// @ts-expect-error -- only a boolean can be negatable
	defineFlag({ type: "string", negatable: true });
	// @ts-expect-error -- only a boolean can be negatable
	defineFlag({ type: "string", schema, negatable: true });
	// @ts-expect-error -- only a boolean can be negatable
	defineFlag({ type: "count", negatable: true });
	// @ts-expect-error -- negatable is `true` or left out
	defineFlag({ type: "boolean", negatable: false });
	// @ts-expect-error -- noNegate is gone: negation is opt-in
	defineFlag({ type: "boolean", noNegate: true });
	// @ts-expect-error -- min applies to numbers and integers
	defineFlag({ type: "string", min: 1 });
	// @ts-expect-error -- max applies to numbers and integers
	defineArg("name", { type: "string", max: 1 });
	// @ts-expect-error -- a count has no default: it is 0
	defineFlag({ type: "count", default: 1 });
	// @ts-expect-error -- a count is never required
	defineFlag({ type: "count", required: true });
	// @ts-expect-error -- a count does not repeat into an array
	defineFlag({ type: "count", multiple: true });
	// @ts-expect-error -- an integer default is a number
	defineFlag({ type: "integer", default: "1" });
}

function _ownedEnvList() {
	const env: [string, string] = ["APP_TAGS", "TAGS"];
	const flag = defineFlag({ type: "string", multiple: true, env });
	// @ts-expect-error -- an owned list of names is read-only
	flag.env[0] = "OTHER";
	env[0] = "OTHER";
}

function _attachments(flags: FlagsDef, args: ArgsDef, aliases: string[], cond: boolean) {
	new Crust("cli").flags(flags);
	new Crust("cli").flags(cond ? { a: { type: "boolean" } } : { b: { type: "boolean" } });
	new Crust("cli").args(...args);
	new Crust("cli").flags({ a: { type: "boolean", aliases } });
	new Crust("cli").args({ name: "a", type: "string", parse: (_raw): unknown => 1 });
	const open = new Crust("cli").flags(flags);
	open.flags({ known: { type: "boolean" } });
	const openArgs = new Crust("cli").args(...args);
	openArgs.args({ name: "known", type: "string" });
	// @ts-expect-error -- appending known args must not erase prior unknown args for run
	void openArgs.args({ name: "known", type: "string" }).run([], {});
	defineCommand("child", (b) => b.flags(flags).args(...args));
	const known = new Crust("cli").flags({ mode: { type: "string", required: true } });
	void known.run([], { flags: { mode: "a" } });
	// @ts-expect-error -- a narrow checked tuple retains known required fields
	void known.run([], {});
}

function _remainingLocalProofs(
	cond: boolean,
	optional: { name: "maybe"; type: "string"; variadic?: true },
) {
	new Crust("cli").args(optional, { name: "last", type: "string" });
	const prior = new Crust("cli").args(optional);
	prior.args({ name: "last", type: "string" });
	const maybeParser = cond
		? { type: "string" as const, parse: (_s: string): unknown => 1 }
		: { type: "string" as const };
	defineArg("value", maybeParser);
	// @ts-expect-error -- any return is not synchronous proof
	defineFlag({ type: "string", parse: JSON.parse });
	const choices: string[] = ["a"];
	const defaults: string[] = ["a"];
	const owned = defineFlag({ type: "string", multiple: true, choices, default: defaults });
	// @ts-expect-error -- proof-bearing collections exposed from helpers are readonly
	owned.choices.push("b");
	// @ts-expect-error -- occurrence default arrays are readonly (contained JSON/URLs are not frozen)
	owned.default.push("b");
	const requires: "json"[] = ["json"];
	const needs = defineFlag({ type: "string", requires });
	// @ts-expect-error -- `requires` is frozen
	needs.requires.push("json");
	const aliases: string[] = ["a"];
	const group = defineFlag({ type: "exclusive", flags: { all: { type: "boolean", aliases } } });
	// @ts-expect-error -- each member is frozen as defineFlag() freezes it
	group.flags.all.aliases.push("b");
}

function _mixedCheckedNamespaces(
	aliases: string[],
	cond: boolean,
	maybe: { name: "maybe"; type: "string"; variadic?: true },
) {
	const app = new Crust("cli").flags({
		static: { type: "boolean" },
		dynamic: { type: "boolean", aliases },
	});
	app.flags({ later: { type: "boolean" } });
	const args = new Crust("cli").args({ name: "first", type: "string" }, maybe);
	args.args({ name: "last", type: "string" });
}

function _broadFlagHolders(
	app: Crust<FlagsDef>,
	aliases: Crust<{ known: { type: "boolean"; aliases: string[] } }>,
) {
	app.flags({ new: { type: "boolean" } });
	aliases.flags({ new: { type: "boolean" } });
}

function _emptyAttachmentsPreserveKnownState() {
	const app = new Crust("cli").flags({}).args();
	void app.run([]);
}

function _conditionalCanonicalIdentity(cond: boolean) {
	const arg = {
		name: cond ? ("a" as const) : ("b" as const),
		type: "string" as const,
		required: true as const,
	};
	const args = new Crust("cli").args(arg);
	void args.run([], { args: { a: "a", b: "b" } });
}

function _openInvalidDefinitions() {
	const args: { name: string; type: "string"; choices: readonly ["ok"]; default: "bad" }[] = [];
	// @ts-expect-error -- an open collection must retain independently invalid default membership
	new Crust("app").args(...args);
}

// `parse` on a non-string flag names the fix
function _typecheckParseIsForStringFlags() {
	// @ts-expect-error -- FIX_PARSE: `parse` is for string flags
	new Crust("cli").flags({ n: { type: "number", parse: (raw: string) => Number(raw) } });
	new Crust("cli").flags({ n: { type: "string", parse: (raw: string) => Number(raw) } });
}

// A required `multiple` flag is a non-empty tuple, in the action and in typed input
function _typecheckRequiredMultipleIsNonEmpty() {
	const app = new Crust("cli")
		.flags({
			id: { type: "string", multiple: true, required: true },
			tag: { type: "string", multiple: true },
		})
		.action(({ flags }) => {
			const first: string = flags.id[0];
			const tags: string[] | undefined = flags.tag;
			return [first, tags];
		});
	const ids: readonly string[] = ["a"];
	void app.run([], { flags: { id: ["a"], tag: ids } });
	// @ts-expect-error -- a required multiple flag needs at least one value
	void app.run([], { flags: { id: [] } });
}
