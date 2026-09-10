import type { StandardSchema } from "@crustjs/utils/schema";

import type { Equal, Expect, Repeat } from "../tests/helpers.ts";
import {
	Crust,
	defineCommand,
	type AnyCrust,
	type ArgsDef,
	type CommandShape,
	type InputArgs,
	type InputFlags,
	type RunInput,
	type RunOutcome,
	defineFlag,
	defineArg,
	defineContext,
	defineExtension,
	defineExtensionId,
	type NamedFlagDef,
} from "./index.ts";
import type { CommandSectionInput } from "./types.ts";

function _checkedInvocation(
	broad: AnyCrust,
	openArgs: Crust<{}, ArgsDef>,
	path: readonly string[],
) {
	const root = new Crust("root");
	void root.run([]);
	// @ts-expect-error -- a fresh root has no positional definitions
	void root.run([], { args: { unknown: "value" } });
	void broad.run([]);
	void broad.run([], {});
	void openArgs.run([], {});
	void broad.run(path, {});
	const app = root.action(() => "known" as const);
	const known = app.run([], {});
	type _known = Expect<Equal<typeof known, Promise<RunOutcome<"known">>>>;
	interface Payload {
		ok: boolean;
	}
	const payload: Payload = { ok: true };
	const jsonApp = root.flags({ name: "config", type: "json" }, { name: "endpoint", type: "url" });
	void jsonApp.run([], { flags: { config: payload, endpoint: new URL("https://example.com") } });
	void jsonApp.run([], { flags: { config: payload } });
}

function _explicitConstructorArguments() {
	new Crust<{}>("root");
	void new Crust<{}>("root").run([]);
}

function _widenedArgumentName(name: string) {
	const app = new Crust("open").args({ name, type: "string" });
	void app.run([], { args: { arbitrary: "value" } });
	void app.run([], { args: { [name]: "value" } });
}

function _checkedCommandNames(name: string) {
	const plain: string = name;
	new Crust(name);
	defineCommand(name, (command) => command);
	// @ts-expect-error -- a dynamic name does not erase known alias grammar
	defineCommand(name, { aliases: ["bad alias"] }, (command) => command);
	defineCommand(name, { aliases: ["alternate"] }, (command) => command);
	const app = new Crust(name)
		.flags({ name: "verbose", type: "boolean" })
		.args({ name: "file", type: "string", required: true })
		.action(({ args }) => args.file);
	const result = app.run([], { args: { file: "input" }, flags: { verbose: true } });
	type _result = Expect<Equal<typeof result, Promise<RunOutcome<string>>>>;
	// @ts-expect-error -- a dynamic root name does not erase known required input
	void app.run([]);
	// @ts-expect-error -- independent known flags retain value types
	void app.run([], { args: { file: "input" }, flags: { verbose: "true" } });
	void plain;
}

function _genericCommandName<Name extends string>(name: Name) {
	// @ts-expect-error -- a generic string constraint does not prove canonical validity
	const command = defineCommand(name, (builder) => builder);
	// @ts-expect-error -- a generic name does not prove valid renaming
	const renamed = command.as(name);
	type _name = Expect<Equal<typeof renamed.name, Name>>;
	return command;
}

function _localMetadata(
	title: string,
	aliases: string[],
	only: ReturnType<typeof defineExtensionId>[],
	text: string,
) {
	// @ts-expect-error -- audiences are constructively nonempty
	const _empty: CommandSectionInput = { title: "Notes", body: "text", only: [] };
	// @ts-expect-error -- trusted metadata owns nonblank section text
	new Crust("cli", { sections: [{ title: " ", body: "text" }] });
	// @ts-expect-error -- titles are single line
	defineCommand("child", { sections: [{ title: "a\nb", body: "text" }] }, (b) => b);
	new Crust("cli", { sections: [{ title, body: "text" }] });
	defineCommand("child", { aliases }, (b) => b);
	new Crust("cli", { sections: [{ title, body: "text", only }] });
	defineCommand("child", { aliases, sections: [{ title, body: "text" }] }, (b) => b);
	// @ts-expect-error -- a dynamic body cannot hide a known invalid title
	new Crust("app", { sections: [{ title: "two\nlines", body: text }] });
	// @ts-expect-error -- a dynamic title cannot hide a known invalid body
	new Crust("app", { sections: [{ title: text, body: " " }] });
}

function _conditionalSectionText(cond: boolean) {
	const section = cond
		? { title: "Valid" as const, body: "Body" as const }
		: { title: "" as const, body: "Body" as const };
	// @ts-expect-error -- one valid branch cannot erase the invalid title of another
	defineCommand("child", { sections: [section] }, (b) => b);
}

function _localAliasProofIsNotDestinationProof(aliases: string[]) {
	const dynamic = defineCommand("child", { aliases }, (b) => b);
	new Crust("cli").add(dynamic);
	defineCommand("parent", (b) => b.add(dynamic));
	new Crust("cli").add(defineCommand("child", { aliases: ["c", "c"] }, (b) => b));
}

function _rootVersionOwnership() {
	// @ts-expect-error -- versions belong to the root, not command configs
	defineCommand("child", { version: "1" }, (b) => b);
}

function _sectionShapesStayTyped() {
	// @ts-expect-error -- an envelope is not an unknown decoder
	new Crust("cli", { sections: [{ title: 1, body: "text" }] });
	// @ts-expect-error -- consumer identities are branded, including on checked configs
	new Crust("cli", { sections: [{ title: "Notes", body: "text", only: ["unbranded"] }] });
	new Crust("cli", {
		sections: [
			// @ts-expect-error -- section audiences cannot specify both only and except
			{
				title: "Notes",
				body: "text",
				only: [defineExtensionId("a")],
				except: [defineExtensionId("b")],
			},
		],
	});
}

function _overlappingFlagContributions(
	flag:
		| { name: "mode"; type: "string" }
		| { name: "mode"; type: "string"; aliases: readonly ["m"] },
) {
	new Crust("cli").flags(flag);
	defineCommand("child", (command) => command.flags(flag));
	const checked = new Crust("cli").flags(flag);
	checked.flags({ name: "next", type: "boolean" });
}

type FlagBatch = Repeat<100, "flag-", { readonly type: "boolean" }>;

function _largeFlagBatch(defs: FlagBatch) {
	new Crust("cli").flags(...defs).action(({ flags }) => {
		const last: boolean | undefined = flags["flag-99"];
		// @ts-expect-error -- a large fixed batch remains closed
		void flags["flag-100"];
		void last;
	});
}

function _contextBoundaries(name: string, flags: readonly NamedFlagDef[]) {
	defineContext(name, () => 1);
	defineContext("auth", { flags }, () => 1);
	// @ts-expect-error -- Context config closes the same local spelling proof
	defineContext("auth", { flags: [{ name: "token", type: "string", short: "xx" }] }, () => 1);
	const auth = defineContext(
		name,
		{ flags: [{ name: "token", type: "string" }] },
		({ flags }) => flags.token,
	);
	const checked = defineContext("auth", { flags }, () => 1);
	void [auth, checked];
}

function _providedContextCollections(
	instances: readonly ReturnType<ReturnType<typeof defineContext>>[],
) {
	new Crust("cli").provide(...instances);
}

function _commandCompositionBoundary(definitions: readonly ReturnType<typeof defineCommand>[]) {
	new Crust("cli").add(...definitions);
	const app = new Crust("cli").flags({ name: "known", type: "number" }).add(...definitions);
	void app.run([], { flags: { known: 1 } });
	// @ts-expect-error -- opening child paths does not erase root flag value types
	void app.run([], { flags: { known: "wrong" } });
	const owner = defineContext("owner", { flags: [{ name: "token", type: "string" }] }, () => 1);
	const colliding = defineCommand("child", (b) => b.flags({ name: "token", type: "number" }));
	// @ts-expect-error -- sealed recipes must prove their relation to inherited Context flags
	new Crust("cli").provide(owner()).add(colliding);
	// @ts-expect-error -- nested sealed recipes share the inherited Context namespace
	defineCommand("parent", (b) => b.provide(owner()).add(colliding));
}

function _contextProofCannotBeForged() {
	// @ts-expect-error -- handwritten instances have no owned private definition
	new Crust("cli").provide({ name: "fake", ownedFlags: {}, uses: [], setup: () => 1 });
	const instance = defineContext("real", () => 1)();
	// @ts-expect-error -- public renaming cannot contradict the retained defining instance
	new Crust("cli").provide({ ...instance, name: "fake" });
	new Crust("cli")
		.provide({ ...instance, setup: () => "fake", ownedFlags: { fake: { type: "boolean" } } })
		.action(async ({ ctx, flags }) => {
			const value: number = await ctx.real;
			// @ts-expect-error -- overridden public fields do not manufacture owned flags
			void flags.fake;
			void value;
		});
}

function _checkedExtensionConfigMetadata() {
	const requiresVersion = defineExtension<"version">()(defineExtensionId("version"), {});
	// @ts-expect-error -- checked local configs do not erase TS-owned metadata requirements
	new Crust("missing").extend(requiresVersion);
	new Crust("present", { version: "1" }).extend(requiresVersion);
}

function _uncertainContextIdentity(name: "a" | "b") {
	const factory = defineContext(name, () => 1);
	new Crust("cli").provide(factory()).action(async ({ ctx }) => {
		// @ts-expect-error -- one dynamic provider does not promise every alternative name
		const value: number = await ctx.a;
		void value;
	});
}

// @ts-expect-error The typed dynamic envelope does not decode arbitrary objects or erase audience XOR.
new Crust("app", { sections: [{ title: "Notes", body: "Body", only: [], except: [] }] });

function _uncertainRequiredFlags(defaultValue: string | undefined, required: true | undefined) {
	const absent = new Crust("app").flags({
		name: "token",
		type: "string",
		required: true,
		default: undefined,
	});
	// @ts-expect-error -- undefined is not a default that discharges requiredness
	void absent.run([]);
	// @ts-expect-error -- the compatibility overload must retain requiredness
	void absent.run([], {});
	const maybeDefault = new Crust("app").flags({
		name: "token",
		type: "string",
		required: true,
		default: defaultValue,
	});
	// @ts-expect-error -- a possibly absent default cannot discharge requiredness
	void maybeDefault.run([]);
	const maybeRequired = new Crust("app").flags({ name: "token", type: "string", required });
	// @ts-expect-error -- a possibly required flag must be supplied
	void maybeRequired.run([], {});
	void maybeRequired.run([], { flags: { token: "value" } });
	type RequiredInput = InputFlags<{
		token: { type: "string"; required: true; default: string | undefined };
	}>;
	// @ts-expect-error -- exported input retains a possible requirement
	const _exported: RequiredInput = {};
	const assigned = {};
	// @ts-expect-error -- assigned values cannot omit a possible requirement
	void maybeRequired.run([], assigned);
	void new Crust("app")
		.flags({ name: "token", type: "string", required: true, default: "safe" })
		.run([]);
}

function _localInputHolders() {
	const flag = new Crust("app").flags({ name: "optional", type: "string" });
	const arg = new Crust("app").args({ name: "optional", type: "string" });
	// @ts-expect-error -- optional flag proof cannot erase to a fresh root
	const _erasedFlag: Crust = flag;
	// @ts-expect-error -- optional positional proof cannot erase to a fresh root
	const _erasedArg: Crust = arg;
	const broad: AnyCrust = flag;
	void broad.run([]);
	function identity<T extends AnyCrust>(app: T): T {
		return app;
	}
	void identity(flag).run([], { flags: { optional: "ok" } });
	void identity(arg).run([], { args: { optional: "ok" } });
}

function _unprovenChoices(
	choices: string[],
	optional: readonly ["allowed"] | undefined,
	conditional: readonly ["allowed"] | readonly ["other"],
) {
	const app = new Crust("app").flags(
		{ name: "mode", type: "string", choices },
		{ name: "safe", type: "boolean" },
	);
	// @ts-expect-error -- a widened collection does not prove future membership
	void app.run([], { flags: { mode: "forbidden" } });
	const assigned = { flags: { mode: "forbidden" } };
	// @ts-expect-error -- compatibility must not bypass choice membership
	void app.run([], assigned);
	void app.run([], { flags: { safe: true } });
	const local = importFlag(choices);
	// @ts-expect-error -- a locally checked definition is not future input proof
	void new Crust("app").flags(local).run([], { flags: { mode: "forbidden" } });
	type Flags = InputFlags<{ mode: { type: "string"; choices: string[] } }>;
	// @ts-expect-error -- exported flags cannot prove widened membership
	const _flags: Flags = { mode: "forbidden" };
	type Args = InputArgs<[{ name: "mode"; type: "string"; choices: string[] }]>;
	// @ts-expect-error -- arguments use the same membership owner
	const _args: Args = { mode: "forbidden" };
	void new Crust("app")
		.args({ name: "mode", type: "string", choices: optional })
		// @ts-expect-error -- optional choices can constrain a supplied value
		.run([], { args: { mode: "forbidden" } });
	void new Crust("app")
		.flags({ name: "mode", type: "string", choices: conditional })
		// @ts-expect-error -- one conditional set cannot prove the other set's members
		.run([], { flags: { mode: "allowed" } });
	void new Crust("app")
		.flags({ name: "mode", type: "string", choices: ["allowed"] })
		.run([], { flags: { mode: "allowed" } });
}

function importFlag(choices: string[]) {
	return defineFlag("mode", { type: "string", choices });
}

function _possibleNoNegate(noNegate: true | undefined) {
	const app = new Crust("app").flags({ name: "yes", type: "boolean", noNegate });
	// @ts-expect-error -- false is unsafe when negation may be disabled
	void app.run([], { flags: { yes: false } });
	const assigned = { flags: { yes: false } };
	// @ts-expect-error -- assigned input cannot bypass possible noNegate
	void app.run([], assigned);
	type Flags = InputFlags<{ yes: { type: "boolean"; noNegate?: true } }>;
	// @ts-expect-error -- exported input retains possible noNegate
	const _flags: Flags = { yes: false };
	void app.run([], { flags: { yes: true } });
	void app.run([]);
}

function _conditionalValueContracts(
	multiple: true | undefined,
	parse: ((raw: string) => number) | undefined,
) {
	const schema: StandardSchema = {
		"~standard": { version: 1, vendor: "test", validate: (value) => ({ value }) },
	};
	const app = new Crust("app").flags({ name: "value", type: "string", schema, multiple });
	// @ts-expect-error -- a possible occurrence array cannot accept a scalar unchecked
	void app.run([], { flags: { value: "text" } });
	void app.run([]);
	const arg = new Crust("app").args({ name: "value", type: "string", variadic: multiple });
	// @ts-expect-error -- possible variadic input cannot accept an unchecked scalar
	void arg.run([], { args: { value: "text" } });
	const parser = new Crust("app").flags(defineFlag("value", { type: "string", parse }));
	// Safe in either parser branch: the input is always raw string.
	void parser.run([], { flags: { value: "text" } });
	const definition =
		Math.random() > 0.5 ? { name: "value", type: "number" as const } : { name: "value", schema };
	const mixed = new Crust("app").args(definition);
	void mixed.run([], { args: { value: 42 } });
}

function _optionalParserOutput(parse: ((raw: string) => number) | undefined) {
	const definition = defineFlag("value", { type: "string", parse });
	new Crust("app").flags(definition).action(({ flags }) => {
		// @ts-expect-error -- absent parser yields string, present parser yields number
		const wrong: string | undefined = flags.value;
		const correct: string | number | undefined = flags.value;
		void [wrong, correct];
	});
}
function _conditionalRequiredArg(required: true | undefined) {
	const app = new Crust("app").args({ name: "token", type: "string", required });
	// @ts-expect-error -- possible positional requiredness cannot disappear
	void app.run([]);
}

function _conditionalOutputs(variadic: true | undefined, defaultValue: string | undefined) {
	new Crust("app").args({ name: "value", type: "string", variadic }).action(({ args }) => {
		// @ts-expect-error -- checked optional variadic may produce an array
		const _scalar: string | undefined = args.value;
		const _correct: string | string[] | undefined = args.value;
	});
	new Crust("app")
		.flags({ name: "value", type: "string", default: defaultValue })
		.action(({ flags }) => {
			// @ts-expect-error -- an optional absent default does not guarantee presence
			const _present: string = flags.value;
		});
}

function _conditionalDefinitions(toggle: boolean) {
	const value = toggle ? { type: "string" as const } : { type: "number" as const };
	const app = new Crust("app").flags({ name: "value", ...value });
	// @ts-expect-error -- possible primitive kinds do not certify one supplied kind
	void app.run([], { flags: { value: 42 } });
	const choices = toggle
		? { type: "string" as const, choices: ["one"] as const }
		: { type: "string" as const, choices: ["two"] as const };
	const selected = new Crust("app").flags({ name: "value", ...choices });
	// @ts-expect-error -- a union of definitions cannot prove one choice member
	void selected.run([], { flags: { value: "one" } });
}

function _possiblyRequiredVariadic(required: true | undefined, defaultValue: string | undefined) {
	const app = new Crust("app").args({ name: "values", type: "string", variadic: true, required });
	// @ts-expect-error -- possible required variadic must supply an occurrence
	void app.run([], { args: { values: [] } });
	const maybeDefault = new Crust("app").args({
		name: "values",
		type: "string",
		variadic: true,
		required: true,
		default: defaultValue,
	});
	// @ts-expect-error -- a possibly absent variadic default cannot establish an occurrence
	void maybeDefault.run([], { args: { values: [] } });
}

function _openInheritedFlags(recursive: boolean) {
	const owner = defineContext(
		"owner",
		{
			flags: [{ name: "token", type: "string", required: true }],
		},
		() => 1,
	);
	const providers = [owner()];
	const child = defineCommand("child", (c) =>
		c.add(defineCommand("leaf", (c) => c.action(() => 1))),
	);
	const inherited = new Crust("app").provide(...providers).add(child);
	void inherited.run(["child"]);
	void inherited.run(["child", "leaf"]);
	void inherited.run(["child", "leaf"], { flags: { token: "ok" } });
	// Ordinary providers added later do not retroactively reach materialized children.
	void new Crust("app")
		.add(child)
		.provide(...providers)
		.run(["child", "leaf"]);
	const ext = defineExtension(defineExtensionId("recursive-open"), {
		flags: [{ name: "token", type: "string", required: true, recursive }],
	});
	const after = new Crust("app").add(child).extend(ext);
	const before = new Crust("app").extend(ext).add(child);
	void after.run(["child", "leaf"]);
	void before.run(["child", "leaf"]);
	void after.run([], { flags: { token: "ok" } });
	void before.run([], { flags: { token: "ok" } });
	void after.run(["child", "leaf"], { flags: { token: "ok" } });
}

function _infiniteNames(
	name: `mode-${string}`,
	numeric: `${number}`,
	blank: `${string} `,
	mixed: "fixed" | `mode-${string}`,
	branded: string & { readonly brand: unique symbol },
) {
	defineFlag(name, { type: "string", required: true });
	defineArg(numeric, { type: "string", required: true });
	new Crust(blank);
	defineCommand(name, (c) => c);
	defineContext(name, () => 1);
	defineFlag(mixed, { type: "string" });
	defineFlag(branded, { type: "string" });
	const flag = defineFlag(name, { type: "string", required: true });
	const flags = new Crust("app").flags(flag);
	void flags.run([]);
	void flags.run([], { flags: { [name]: "ok" } });
	const args = new Crust("app").args(defineArg(numeric, { type: "string", required: true }));
	void args.run([]);
	const command = defineCommand(name, (c) =>
		c.args({ name: "value", type: "string", required: true }),
	);
	const tree = new Crust("app").add(command);
	void tree.run([name]);
	void tree.run([]);
	void tree.run([name], { args: { value: "ok" } });
	const provider = defineContext(name, () => 1);
	defineCommand("consumer", (c) => c.use(provider));
	const provided = new Crust("app").provide(provider());
	provided.provide(defineContext("other", () => 1)());
	void provided.run([]);
	const alias = defineFlag("safe", { type: "string", aliases: [name] as const });
	const aliased = new Crust("app").flags(alias);
	void aliased.run([], { flags: { safe: "ok" } });
	aliased.flags({ name: "other", type: "boolean" });
	const ext = defineExtension(defineExtensionId("infinite-recursive"), { flags: [flag] as const });
	const extended = new Crust("app").add(defineCommand("child", (c) => c)).extend(ext);
	void extended.run(["child"]);
	const replacement = new Crust("app")
		.add(defineCommand("known", (c) => c))
		.extend(
			defineExtension(defineExtensionId("open-replacement"), { commands: [command] as const }),
		);
	void replacement.run([name]);
}

function _finiteAndConditionalNames(name: `mode-${"a" | "b"}`) {
	const flag = defineFlag(name, { type: "string", required: true });
	const arg = defineArg(name, { type: "string", required: true });
	const command = defineCommand(name, (c) => c);
	const provider = defineContext(name, () => 1);
	new Crust("app").flags(flag);
	void new Crust("app").flags(flag).run([]);
	void new Crust("app").args(arg).run([]);
	void new Crust("app").add(command).run([name]);
	void new Crust("app").add(command).run(["mode-a"]);
	new Crust("app").provide(provider()).provide(defineContext("other", () => 1)());
	void new Crust("app").flags(defineFlag("mode-a", { type: "string" })).run([]);
	void new Crust("app")
		.flags(defineFlag("mode", { type: "string", choices: ["mode-a", "mode-b"] }))
		.run([], { flags: { mode: name } });
	// Fixed finite spellings retain ordinary proof.
	const alias = "mode-a";
	void new Crust("app").flags(defineFlag("safe", { type: "boolean", aliases: [alias] }));
}

function _genericNameWrapper<N extends string>(name: N) {
	// @ts-expect-error -- a generic constraint is not local name evidence
	return defineFlag(name, { type: "string" });
}
void new Crust("app").flags(_genericNameWrapper("known")).run([]);

function _conditionalArgumentTuples(condition: boolean) {
	const a = defineArg("a", { type: "string", required: true });
	const b = defineArg("b", { type: "string", required: true });
	const definitions = condition ? ([a] as const) : ([b] as const);
	const app = new Crust("app").args(...definitions);
	void app.run([]);
	void app.run([], { args: { a: "ok" } });
	type Input = RunInput<CommandShape<typeof definitions>>;
	// @ts-expect-error -- exported input types must not collapse disjoint required keys to empty
	const input: Input = {};
	void input;
	type Args = InputArgs<typeof definitions>;
	// @ts-expect-error -- the public positional input contract retains conditional uncertainty
	const args: Args = {};
	void args;
	void app.run([], { args: condition ? { a: "ok" } : { b: "ok" } });
	const tree = new Crust("app")
		.flags({ name: "root", type: "string", required: true })
		.add(defineCommand("safe", (c) => c.action(() => "safe" as const)))
		.add(defineCommand("conditional", (c) => c.args(...definitions)));
	void tree.run([], { flags: { root: "ok" } });
	// @ts-expect-error -- independent root requiredness survives the conditional child
	void tree.run([]);
	const safe = tree.run(["safe"]);
	type _safe = Expect<Equal<typeof safe, Promise<RunOutcome<"safe">>>>;
	void tree.run(["conditional"]);
	void tree.run(["conditional"], { args: condition ? { a: "ok" } : { b: "ok" } });
}

function _infiniteChoiceMembers(choice: `mode-${string}`, numeric: `${number}`) {
	const choices = [choice] as const;
	const flag = defineFlag("mode", { type: "string", choices });
	const app = new Crust("app").flags(flag);
	// @ts-expect-error -- one actual choice does not prove every member of its template domain
	void app.run([], { flags: { mode: "mode-other" } });
	void app.run([]);
	// @ts-expect-error -- an infinite choice domain does not prove supplied membership
	void app.run([], { flags: { mode: choice } });
	const checked = new Crust("app").flags(defineFlag("mode", { type: "string", choices }));
	// @ts-expect-error -- local checking cannot prove an infinite set of supplied values
	void checked.run([], { flags: { mode: "mode-other" } });
	type Input = InputFlags<{
		mode: { type: "string"; choices: typeof choices };
	}>;
	// @ts-expect-error -- assigned exported inputs use the same membership proof
	const input: Input = { mode: "mode-other" };
	void input;
	defineFlag("mode", { type: "string", choices, default: "mode-other" });
	defineArg("mode", { type: "string", choices, default: "mode-other" });
	const args = new Crust("app").args(defineArg("mode", { type: "string", choices: [numeric] }));
	// @ts-expect-error -- fixed-length numeric choice tuples are not finite identity evidence
	void args.run([], { args: { mode: "123" } });
	void new Crust("app")
		.flags(defineFlag("mode", { type: "string", choices: ["mode-a", "mode-b"] }))
		.run([], { flags: { mode: "mode-b" } });
}

function _disjointOpenProviderFlags(condition: boolean) {
	const a = defineContext("a", { flags: [{ name: "a", type: "string", required: true }] }, () => 1);
	const b = defineContext("b", { flags: [{ name: "b", type: "string", required: true }] }, () => 1);
	const providers = condition ? [a()] : [b()];
	const child = defineCommand("child", (c) => c);
	const app = new Crust("app").provide(...providers).add(child);
	void app.run(["child"]);
	void app.run([]);
	const ext = defineExtension(defineExtensionId("disjoint-owned"), { provides: providers });
	void new Crust("app").add(child).extend(ext).run(["child"]);
}

function _nonrecursiveTemplateFlags(name: `mode-${string}`) {
	const ext = defineExtension(defineExtensionId("local-template"), {
		flags: [{ name, type: "string", required: true, recursive: false }] as const,
	});
	const child = defineCommand("child", (c) => c.action(() => "safe" as const));
	// A definitely nonrecursive contribution cannot affect either child attachment order.
	void new Crust("app").add(child).extend(ext).run(["child"]);
	void new Crust("app").extend(ext).add(child).run(["child"]);
}

function _templateSpellingEntryPoints(
	name: `mode-${string}`,
	numeric: `${number}`,
	branded: "mode-known" & { readonly brand: unique symbol },
) {
	new Crust("app").flags({ name, type: "string" });
	new Crust("app").args({ name: numeric, type: "string" });
	new Crust("app").command(name, (c) => c);
	defineArg(branded, { type: "string" });
	defineFlag("safe", { type: "string", aliases: [name] });
	defineCommand("safe", { aliases: [name] }, (c) => c);
	const command = defineCommand("safe", { aliases: [name] as const }, (c) =>
		c.args({ name: "value", type: "string", required: true }),
	);
	const app = new Crust("app").add(command);
	void app.run(["safe"], { args: { value: "ok" } });
	// @ts-expect-error -- known canonical requirements remain known despite open aliases
	void app.run(["safe"]);
	void app.run(["mode-other"]);
	const inline = new Crust("app").command(name, (c) => c);
	void inline.run(["mode-other"]);
	type Flags = InputFlags<Record<`mode-${string}`, { type: "string"; required: true }>>;
	const flags: Flags = {};
	void flags;
	type Args = InputArgs<readonly [{ name: `${number}`; type: "string"; required: true }]>;
	// @ts-expect-error -- exported positional inputs also need finite identities
	const args: Args = {};
	void args;
}

function _uncertainPositionalKind(type: "string" | "number", condition: boolean) {
	const root = new Crust("app").args({ name: "value", type, required: true });
	// @ts-expect-error -- either actual kind can reject a number
	void root.run([], { args: { value: 42 } });
	// @ts-expect-error -- either actual kind can reject a string
	void root.run([], { args: { value: "text" } });
	const child = defineCommand("child", (c) => c.args({ name: "value", type, required: true }));
	// @ts-expect-error -- descendants retain the same uncertain input kind
	void new Crust("app").add(child).run(["child"], { args: { value: 42 } });
	const arg = defineArg("value", { type, required: true });
	// @ts-expect-error -- checked local definitions do not prove a future supplied kind
	void new Crust("app").args(arg).run([], { args: { value: 42 } });
	const conditional = defineArg(
		"value",
		condition ? { type: "string", required: true } : { type: "number", required: true },
	);
	// @ts-expect-error -- definition unions cannot distribute into permissive value unions
	void new Crust("app").args(conditional).run([], { args: { value: 42 } });
	const input: InputArgs<readonly [{ name: "value"; type: typeof type; required: true }]> = {
		// @ts-expect-error -- exported inputs retain discriminator uncertainty
		value: 42,
	};
	void input;
	void new Crust("optional").args({ name: "value", type }).run([]);
	void new Crust("stable")
		.args({ name: "value", type: "number", required: true })
		.run([], { args: { value: 42 } });
}

function _conditionalExportedFlags() {
	type Flags =
		| { a: { type: "string"; required: true } }
		| { b: { type: "string"; required: true } };
	// @ts-expect-error -- no actual branch has an empty required flag record
	const flags: InputFlags<Flags> = {};
	// @ts-expect-error -- a conditional record cannot certify either supplied branch
	const partial: InputFlags<Flags> = { a: "value" };
	// @ts-expect-error -- exported run inputs must not turn disjoint keys into empty proof
	const input: RunInput<CommandShape<[], Flags, {}, void>> = {};
	const empty: InputFlags<{}> = {};
	const optional: InputFlags<{ a: { type: "string" } }> = {};
	const required: InputFlags<{ a: { type: "string"; required: true } }> = { a: "value" };
	void [flags, partial, input, empty, optional, required];
}

function _conditionalDefinitionKinds() {
	type Definition =
		| { name: "value"; type: "string"; required: true }
		| { name: "value"; type: "number"; required: true };
	// @ts-expect-error -- a definition union cannot distribute before input-kind proof
	const args: InputArgs<readonly [Definition]> = { value: 42 };
	// @ts-expect-error -- the same uncertainty applies within one known flag key
	const flags: InputFlags<{ value: Definition }> = { value: 42 };
	void [args, flags];
}

function _conditionalLocalHelperProof(condition: boolean) {
	const required: { type: "string"; required: true } | { type: "string" } = condition
		? { type: "string", required: true }
		: { type: "string" };
	const flag = defineFlag("mode", required);
	const app = new Crust("app").flags(flag);
	// @ts-expect-error A conditional helper cannot erase a possible requirement.
	void app.run([]);
	// @ts-expect-error -- a conditional helper does not prove supplied value compatibility
	void app.run([], { flags: { mode: "value" } });
	const arg = defineArg("mode", required);
	// @ts-expect-error The same proof must survive argument normalization.
	void new Crust("app").args(arg).run([]);
	const child = defineCommand("child", (c) => c.flags(flag));
	// @ts-expect-error Checked descendants retain conditional helper uncertainty.
	void new Crust("app").add(child).run(["child"]);

	const boolean: { type: "boolean"; noNegate: true } | { type: "boolean" } = condition
		? { type: "boolean", noNegate: true }
		: { type: "boolean" };
	const toggle = defineFlag("toggle", boolean);
	// @ts-expect-error The actual helper definition may prohibit false.
	void new Crust("app").flags(toggle).run([], { flags: { toggle: false } });

	const parsed: { type: "string"; parse: (raw: string) => number } | { type: "string" } = condition
		? { type: "string", parse: Number }
		: { type: "string" };
	const value = defineFlag("value", parsed);
	const argument = defineArg("value", parsed);
	type ParsedDefinition =
		| Readonly<{ name: "value"; type: "string"; parse: (raw: string) => number }>
		| Readonly<{ name: "value"; type: "string" }>;
	type _parsedFlag = Expect<Equal<typeof value, ParsedDefinition>>;
	type _parsedArg = Expect<Equal<typeof argument, ParsedDefinition>>;
	new Crust("app").flags(value).action(({ flags }) => {
		// @ts-expect-error A conditional parser may return a number.
		flags.value?.toUpperCase();
	});
	new Crust("app").args(argument).action(({ args }) => {
		// @ts-expect-error An open argument attachment cannot promise a string output.
		args.value?.toUpperCase();
	});
	type _flag = Expect<
		Equal<
			typeof flag,
			| Readonly<{ name: "mode"; type: "string"; required: true }>
			| Readonly<{ name: "mode"; type: "string" }>
		>
	>;
	const defaults: { type: "string"; default: "a" } | { type: "string"; default: "b" } = condition
		? { type: "string", default: "a" }
		: { type: "string", default: "b" };
	const defaulted = defineFlag("defaulted", defaults);
	type _defaults = Expect<Equal<typeof defaulted.default, "a" | "b">>;
	// @ts-expect-error Normalized helper fields remain readonly in every branch.
	defaulted.default = "a";
}

function _conditionalExportedDefinitionProof() {
	type Choice =
		| { type: "string"; choices: readonly ["a"]; required: true }
		| { type: "string"; choices: readonly ["b"]; required: true };
	// @ts-expect-error Same-kind alternatives do not prove membership in the actual choices.
	const flags: InputFlags<{ mode: Choice }> = { mode: "a" };
	// @ts-expect-error Exported arguments preserve the same membership obligation.
	const args: InputArgs<readonly [Choice & { name: "mode" }]> = { mode: "a" };
	type Required = { type: "string"; required: true } | { type: "string" };
	// @ts-expect-error One alternative requires supplied input.
	const missing: InputFlags<{ mode: Required }> = {};
	// @ts-expect-error Optional metadata must not turn a possibly-required key into an optional never field.
	const optionalMetadata: InputFlags<{
		mode: { type: "string"; required?: true } | { type: "string" };
	}> = {};
	// @ts-expect-error A possibly absent default cannot discharge the required branch.
	const absentDefault: InputFlags<{
		mode: { type: "string"; required: true; default?: string } | { type: "string" };
	}> = {};
	type Boolean = { type: "boolean"; noNegate: true } | { type: "boolean" };
	// @ts-expect-error Same-kind definition alternatives cannot prove false is accepted.
	const toggle: InputFlags<{ toggle: Boolean }> = { toggle: false };
	const omitted: InputFlags<{ toggle: Boolean; stable: { type: "number" } }> = { stable: 1 };
	type Defaulted = { type: "string"; required: true; default: string } | { type: "string" };
	const defaults: InputFlags<{ mode: Defaulted }> = {};
	const defaultArgs: InputArgs<readonly [Defaulted & { name: "mode" }]> = {};
	const allDefaults: InputFlags<{
		mode:
			| { type: "string"; required: true; default: "a" }
			| { type: "string"; required: true; default: "b" };
	}> = {};
	const optionalArgs: InputArgs<
		readonly [
			| { name: "mode"; type: "string"; choices: readonly ["a"] }
			| { name: "mode"; type: "string"; choices: readonly ["b"] },
		]
	> = {};
	void [
		flags,
		args,
		missing,
		optionalMetadata,
		absentDefault,
		toggle,
		omitted,
		defaults,
		defaultArgs,
		allDefaults,
		optionalArgs,
	];
}

function _conditionalOccurrenceDoesNotWrapMissingProof() {
	type Flag = { type: "string"; multiple: true } | { type: "string" };
	// @ts-expect-error Empty arrays are not accepted by the scalar alternative.
	const flag: InputFlags<{ value: Flag }> = { value: [] };
	type Arg = { name: "value"; type: "string"; variadic: true } | { name: "value"; type: "string" };
	// @ts-expect-error Occurrence wrapping cannot turn missing value proof into never[].
	const arg: InputArgs<readonly [Arg]> = { value: [] };
	const omittedFlag: InputFlags<{ value: Flag; stable: { type: "boolean" } }> = { stable: true };
	const omittedArg: InputArgs<readonly [Arg]> = {};
	void [flag, arg, omittedFlag, omittedArg];
}

function _conditionalHelperReadonlyCollections(condition: boolean) {
	const definition:
		| { type: "string"; multiple: true; aliases: ["m"]; choices: ["a"]; default: ["a"] }
		| { type: "string" } = condition
		? { type: "string", multiple: true, aliases: ["m"], choices: ["a"], default: ["a"] }
		: { type: "string" };
	const flag = defineFlag("mode", definition);
	type _normalized = Expect<
		Equal<
			typeof flag,
			| Readonly<{
					name: "mode";
					type: "string";
					multiple: true;
					aliases: readonly ["m"];
					choices: readonly ["a"];
					default: readonly ["a"];
			  }>
			| Readonly<{ name: "mode"; type: "string" }>
		>
	>;
	const payload = { value: 1 };
	const json: { type: "json"; default: typeof payload } | { type: "json" } = condition
		? { type: "json", default: payload }
		: { type: "json" };
	const data = defineFlag("data", json);
	if ("default" in data) data.default.value = 2; // Payload mutability is not definition proof.
}
