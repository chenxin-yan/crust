/* oxlint-disable anti-slop/no-unknown-returns, anti-slop/no-known-value-widening -- compile-only probes deliberately expose unproven parser contracts. */
import { Crust } from "../command/crust.ts";

// Compile-time regression checks; intentionally never invoked.
// rejects invalid choice defaults and reserved spellings at the builder call
function _typecheckRejectsInvalidChoiceDefaultsAndReservedSpellingsAtTheBuilderCall() {
	// @ts-expect-error -- default falls outside the literal choices
	new Crust("cli").flags({ name: "mode", type: "string", choices: ["a", "b"], default: "z" });
	// @ts-expect-error -- __proto__ would mutate the plain-object flag registry
	new Crust("cli").flags({ name: "__proto__", type: "boolean" });
	// @ts-expect-error -- aliases share the same reserved spelling rule
	new Crust("cli").flags({ name: "safe", type: "boolean", aliases: ["__proto__"] });
}

// rejects defaults outside literal choices at the builder call
function _typecheckRejectsDefaultsOutsideLiteralChoicesAtTheBuilderCall() {
	// @ts-expect-error -- default falls outside the literal choices
	new Crust("cli").args({ name: "mode", type: "string", choices: ["a", "b"], default: "z" });
}

import { defineArg, defineFlag } from "./flags.ts";

function _localDefinitions(name: string, aliases: string[], choices: string[], value: string) {
	// @ts-expect-error -- helpers own local spelling checks, not just attachments
	defineFlag("bad", { type: "boolean", short: "xx" });
	// @ts-expect-error -- scan alias tuples before extracting their union
	defineFlag("bad", { type: "boolean", aliases: ["b", "b"] });
	// @ts-expect-error -- short and long aliases share one namespace
	defineFlag("bad", { type: "boolean", short: "b", aliases: ["b"] });
	defineFlag(name, { type: "boolean" });
	defineFlag("bad", { type: "boolean", aliases });
	defineArg("bad", { type: "string", parse: (_raw): unknown => 1 });
	defineFlag("bad", { type: "string", parse: (_raw): object => ({}) });
	defineFlag("mode", { type: "string", choices, default: value });
	// @ts-expect-error -- literal membership is owned by the helper
	defineArg("mode", { type: "string", choices: ["a"], default: "b" });
	defineFlag(name, { type: "boolean" });
	defineArg(name, { type: "string", choices, default: value });
	defineFlag("mode", { type: "string", choices, default: value });
}

import { defineCommand } from "../command/crust.ts";
import type { ArgsDef, NamedFlagDef } from "../types.ts";
function _attachments(flags: NamedFlagDef[], args: ArgsDef, aliases: string[], cond: boolean) {
	new Crust("cli").flags(...flags);
	new Crust("cli").flags(cond ? { name: "a", type: "boolean" } : { name: "b", type: "boolean" });
	new Crust("cli").args(...args);
	new Crust("cli").flags({ name: "a", type: "boolean", aliases });
	new Crust("cli").args({ name: "a", type: "string", parse: (_raw): unknown => 1 });
	const open = new Crust("cli").flags(...flags);
	open.flags({ name: "known", type: "boolean" });
	open.flags({ name: "known", type: "boolean" });
	const openArgs = new Crust("cli").args(...args);
	openArgs.args({ name: "known", type: "string" });
	openArgs.args({ name: "known", type: "string" });
	// @ts-expect-error -- appending known args must not erase prior unknown args for run
	void openArgs.args({ name: "known", type: "string" }).run([], {});
	defineCommand("child", (b) => b.flags(...flags).args(...args));
	const known = new Crust("cli").flags({ name: "mode", type: "string", required: true });
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
	// @ts-expect-error -- a conditional name cannot hide an invalid member
	defineArg(cond ? "valid" : "", { type: "string" });
	// @ts-expect-error -- wrapping the definition does not excuse a known invalid ordinary name
	defineFlag("__proto__", { type: "boolean" });
	const maybeParser = cond
		? { type: "string" as const, parse: (_s: string): unknown => 1 }
		: { type: "string" as const };
	defineArg("value", maybeParser);
	// @ts-expect-error -- any return is not synchronous proof
	defineFlag("value", { type: "string", parse: JSON.parse });
	const choices: string[] = ["a"];
	const defaults: string[] = ["a"];
	const owned = defineFlag("value", { type: "string", multiple: true, choices, default: defaults });
	// @ts-expect-error -- proof-bearing collections exposed from helpers are readonly
	owned.choices.push("b");
	// @ts-expect-error -- occurrence default arrays are readonly (contained JSON/URLs are not frozen)
	owned.default.push("b");
}

function _mixedCheckedNamespaces(
	aliases: string[],
	cond: boolean,
	maybe: { name: "maybe"; type: "string"; variadic?: true },
) {
	const app = new Crust("cli").flags(
		{ name: "static", type: "boolean" },
		{ name: "dynamic", type: "boolean", aliases },
	);
	app.flags({ name: "later", type: "boolean" });
	const args = new Crust("cli").args({ name: "first", type: "string" }, maybe);
	args.args({ name: "last", type: "string" });
	// @ts-expect-error -- every possible canonical spelling must be usable
	new Crust("cli").flags({ name: cond ? "good" : "no-bad", type: "boolean" });
	// @ts-expect-error -- every possible short spelling must be one character
	defineFlag("flag", { type: "boolean", short: cond ? "f" : "ff" });
}

function _broadFlagHolders(
	app: Crust<import("../types.ts").FlagsDef>,
	aliases: Crust<{ known: { type: "boolean"; aliases: string[] } }>,
) {
	app.flags({ name: "new", type: "boolean" });
	aliases.flags({ name: "new", type: "boolean" });
	app.flags({ name: "new", type: "boolean" });
}

function _emptyAttachmentsPreserveKnownState() {
	const app = new Crust("cli").flags().args();
	void app.run([]);
}

function _conditionalCanonicalIdentity(cond: boolean) {
	const flag = {
		name: cond ? ("a" as const) : ("b" as const),
		type: "string" as const,
		required: true as const,
	};
	new Crust("cli").flags(flag);
	const flags = new Crust("cli").flags(flag);
	void flags.run([], { flags: { a: "a", b: "b" } });
	const arg = {
		name: cond ? ("a" as const) : ("b" as const),
		type: "string" as const,
		required: true as const,
	};
	new Crust("cli").args(arg);
	const args = new Crust("cli").args(arg);
	void args.run([], { args: { a: "a", b: "b" } });
}
