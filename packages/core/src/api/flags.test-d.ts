/* oxlint-disable anti-slop/no-unknown-returns, anti-slop/no-known-value-widening -- compile-only probes deliberately expose unproven parser contracts. */
import { Crust, defineCommand } from "../command/crust.ts";
import { defineExtensionId } from "../identity.ts";
import type { ArgsDef, FlagsDef, NamedFlagDef } from "../types.ts";
import { defineContext } from "./context.ts";
import { defineExtension } from "./extension.ts";
import { defineArg, defineFlag } from "./flags.ts";

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
	defineArg(name, { type: "string", choices, default: value });
}

function _attachments(flags: NamedFlagDef[], args: ArgsDef, aliases: string[], cond: boolean) {
	new Crust("cli").flags(...flags);
	new Crust("cli").flags(cond ? { name: "a", type: "boolean" } : { name: "b", type: "boolean" });
	new Crust("cli").args(...args);
	new Crust("cli").flags({ name: "a", type: "boolean", aliases });
	new Crust("cli").args({ name: "a", type: "string", parse: (_raw): unknown => 1 });
	const open = new Crust("cli").flags(...flags);
	open.flags({ name: "known", type: "boolean" });
	const openArgs = new Crust("cli").args(...args);
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
	app: Crust<FlagsDef>,
	aliases: Crust<{ known: { type: "boolean"; aliases: string[] } }>,
) {
	app.flags({ name: "new", type: "boolean" });
	aliases.flags({ name: "new", type: "boolean" });
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
	const flags = new Crust("cli").flags(flag);
	void flags.run([], { flags: { a: "a", b: "b" } });
	const arg = {
		name: cond ? ("a" as const) : ("b" as const),
		type: "string" as const,
		required: true as const,
	};
	const args = new Crust("cli").args(arg);
	void args.run([], { args: { a: "a", b: "b" } });
}

function _mixedDefinitions(condition: boolean, name: string, invalidName: "" | "valid") {
	const mixed = condition
		? { type: "string" as const, short: "long" as const }
		: { type: "string" as const };
	// @ts-expect-error -- an uncertain definition cannot hide a known invalid short spelling
	defineFlag(name, mixed);
	// @ts-expect-error -- one valid branch cannot hide an invalid flag name
	defineFlag(invalidName, { type: "string" });
	// @ts-expect-error -- overlapping collision diagnostics must not cancel each other out
	defineFlag("value", { type: "string", short: "v", aliases: ["value", "v"] });
}

function _openInvalidDefinitions(condition: boolean) {
	const args: { name: string; type: "string"; choices: readonly ["ok"]; default: "bad" }[] = [];
	// @ts-expect-error -- an open collection must retain independently invalid default membership
	new Crust("app").args(...args);
	const flags = condition
		? ([{ name: "ok", type: "string" } as const] as const)
		: ([{ name: "bad", type: "string", short: "long" } as const] as const);
	// @ts-expect-error -- an uncertain collection must not hide its independently invalid branch
	new Crust("app").flags(...flags);
	// @ts-expect-error -- multiple reserved-prefix diagnostics must not cancel each other out
	new Crust("app").flags({ name: "no-value", type: "string", aliases: ["no-alias"] });
}

function _otherFlagSpellingEntryPoints() {
	defineContext(
		"context",
		// @ts-expect-error -- Context flags use the same local spelling contract
		{ flags: [{ name: "flag", type: "boolean", aliases: ["f", "f"] }] },
		() => true,
	);
	defineExtension(defineExtensionId("extension"), {
		// @ts-expect-error -- Extension flags use the same local spelling contract
		flags: [{ name: "flag", type: "boolean", short: "ff" }],
	});
	defineCommand("child", (command) =>
		command
			// @ts-expect-error -- recipe flags use the same local spelling contract
			.flags({ name: "flag", type: "boolean", aliases: ["f", "f"] }),
	);
	new Crust("cli").flags({ name: "flag", type: "boolean", short: "f", aliases: ["again"] });
}
