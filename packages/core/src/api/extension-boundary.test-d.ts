/* oxlint-disable anti-slop/no-unknown-returns, anti-slop/no-known-value-widening -- compile-only probes deliberately model opaque Context value contracts. */
import type { Equal, Expect } from "../../tests/helpers.ts";
import {
	Crust,
	defineCommand,
	type CommandDefinition,
	type CommandShape,
} from "../command/crust.ts";
import { defineExtensionId } from "../identity.ts";
import { runtime } from "../runtime.ts";
import { defineContext } from "./context.ts";
import { defineExtension, type Extension } from "./extension.ts";

const id = defineExtensionId("boundary");
const empty = defineExtension(id);
const nested = new Crust("app").extend(
	defineExtension(id, {
		build({ snapshot }) {
			const name: string = snapshot.meta.name;
			void name;
		},
	}),
	defineExtension(defineExtensionId("second")),
);
void nested.run([]);
const contributed = new Crust("app").extend(
	defineExtension(id, {
		flags: [{ name: "trace", type: "boolean" }],
		provides: [defineContext("logger", () => "logger")()],
		commands: [defineCommand("child", (command) => command.action(() => 42))],
		hooks: {
			preRun({ flags }) {
				const trace: boolean | undefined = flags.trace;
				void trace;
			},
		},
	}),
);
const result = contributed.run(["child"], { flags: { trace: true } });
type _Result = Expect<Equal<typeof result, Promise<import("../index.ts").RunOutcome<number>>>>;
const needsVersion = defineExtension<"version">()(id);
// @ts-expect-error Checked collections retain erased metadata requirements.
new Crust("app").extend(runtime([needsVersion]));
new Crust("app", { version: "1" }).extend(runtime([needsVersion]));
const list = [empty];
// @ts-expect-error An open collection is not a proven empty contribution.
new Crust("app").extend(...list);
new Crust("app").extend(runtime(list));
declare const broad: Extension;
// @ts-expect-error Broad contributions require explicit consumption.
new Crust("app").extend(broad);
new Crust("app").extend(runtime([broad]));
const choice = Math.random()
	? empty
	: defineExtension(id, { flags: [{ name: "trace", type: "boolean" }] });
// @ts-expect-error Conditional contributions cannot be treated as empty.
new Crust("app").extend(choice);
new Crust("app").extend(runtime([choice]));
function generic<E extends Extension>(extension: E) {
	// @ts-expect-error Unresolved contributions cannot use the trusted path.
	new Crust("app").extend(extension);
	// @ts-expect-error Unresolved generic callback value contracts also need static proof.
	new Crust("app").extend(runtime([extension]));
}
void generic;
new Crust("app").extend();

function _privateCommandProof() {
	const child = defineCommand("child", (c) =>
		c.flags({ name: "token", type: "string" }).action(() => 42),
	);
	const copy = {
		...child,
		_shape: { args: [] as const, flags: {}, children: {}, result: "fake" },
		_deps: {},
		_aliases: [] as const,
	};
	const app = new Crust("app").add(copy);
	const outcome = app.run(["child"], { flags: { token: "value" } });
	type _result = Expect<Equal<typeof outcome, Promise<import("../index.ts").RunOutcome<number>>>>;
	new Crust("app")
		.provide(defineContext("owner", { flags: [{ name: "token", type: "string" }] }, () => 1)())
		// @ts-expect-error Public phantom fields cannot erase carried flag relations.
		.add(copy);
	const db = defineContext("db", () => 1);
	const demanding = defineCommand("demand", (c) => c.use(db));
	// @ts-expect-error Public phantom fields cannot erase declared demands.
	new Crust("app").add({ ...demanding, _deps: {} });
}

function _holderErasure() {
	const db = defineContext("db", () => 1);
	const command = defineCommand("demand", (c) => c.use(db));
	// @ts-expect-error A typed holder cannot erase privately retained demands.
	const erasedCommand: import("../command/crust.ts").CommandDefinition<
		"demand",
		readonly [],
		import("../command/crust.ts").CommandShape<[], {}>,
		{}
	> = command;
	const extension = defineExtension(id, { uses: [db] });
	// @ts-expect-error An empty Extension holder cannot erase demands.
	const erasedExtension: Extension<{}, [], [], []> = extension;
	const instance = defineContext(
		"owned",
		{ flags: [{ name: "token", type: "string" }] },
		() => 1,
	)();
	// @ts-expect-error An empty Context holder cannot erase owned flag state.
	const erasedContext: import("./context.ts").ContextInstance<"owned", number, {}, {}> = instance;
	const app = new Crust("app").flags({ name: "token", type: "string", required: true });
	// @ts-expect-error Fresh-root defaults cannot be a holder for a nonempty root.
	const erasedRoot: Crust = app;
	void [erasedCommand, erasedExtension, erasedContext, erasedRoot];
}

function _completedHolder() {
	const db = defineContext("db", () => "value");
	const root = new Crust("app").provide(db());
	// @ts-expect-error A root holder cannot erase provided Context expectations.
	const empty: Crust = root;
	const broad: import("../command/crust.ts").AnyCrust = root;
	// @ts-expect-error Completed-application holders cannot regenerate empty-root proof.
	const regained: Crust = broad;
	// @ts-expect-error Completed holders are not an authoring escape hatch.
	broad.provide(runtime([db()]));
	void broad.execute();
	void broad.snapshot();
	void broad.run(runtime([]), runtime({}));
	// @ts-expect-error Unknown input namespaces require checked invocation.
	void broad.run([]);
	function identity<B extends import("../command/crust.ts").AnyCrust>(builder: B): B {
		return builder;
	}
	identity(root).action(async ({ ctx }) => {
		const value: string = await ctx.db;
		void value;
	});
	void [empty, regained];
}

function _checkedReplacementProof() {
	const name: string = "child";
	const commands = [defineCommand(runtime(name), (c) => c.action(() => "replacement"))];
	const app = new Crust("app")
		.flags({ name: "root", type: "number" })
		.command("child", (c) => c.action(() => 42))
		.extend(runtime([defineExtension(id, runtime({ commands }))]));
	// @ts-expect-error Open replacements cannot retain trusted child inputs/results.
	void app.run(["child"]);
	void app.run([], { flags: { root: 1 } });
	const narrow = new Crust("app")
		.command("child", (c) => c.action(() => 42))
		.command("sibling", (c) => c.action(() => true))
		.extend(
			runtime([
				defineExtension(id, {
					commands: [defineCommand("child", (c) => c.action(() => "replacement"))],
				}),
			]),
		);
	const result = narrow.run(["child"]);
	type _result = Expect<Equal<typeof result, Promise<import("../index.ts").RunOutcome<string>>>>;
	const sibling = narrow.run(["sibling"]);
	type _sibling = Expect<Equal<typeof sibling, Promise<import("../index.ts").RunOutcome<boolean>>>>;
}

function _recipeHolderProof() {
	const erase = (
		b: import("../command/crust.ts").CommandDefinitionBuilder,
	): import("../command/crust.ts").CommandDefinitionBuilder => b;
	defineCommand("child", (c) => {
		// @ts-expect-error A public default holder cannot erase a recipe's local flags.
		return erase(c.flags({ name: "token", type: "number" }));
	});
	function identity<
		B extends import("../command/crust.ts").CommandDefinitionBuilder<
			any,
			any,
			any,
			any,
			any,
			any,
			any,
			any,
			any
		>,
	>(b: B): B {
		return b;
	}
	const child = defineCommand("child", (c) => identity(c.flags({ name: "token", type: "number" })));
	const owner = defineContext("owner", { flags: [{ name: "token", type: "string" }] }, () => 1);
	// @ts-expect-error Generic identity retains the destination collision proof.
	new Crust("app").provide(owner()).add(child);
}

function _openInlineOwnedFlags() {
	const name: string = "token";
	const owner = defineContext(
		runtime("owner"),
		runtime({ flags: [{ name, type: "string" }] }),
		() => 1,
	);
	const app = new Crust("app").provide(runtime([owner()]));
	app.command("child", (c) => {
		// @ts-expect-error Open inherited spellings require checked recipe attachment.
		return c.flags({ name: "token", type: "number" });
	});
	app.command(runtime("child"), (c) => {
		// @ts-expect-error A checked name does not prove a recipe's local flag relations.
		return c.flags({ name: "token", type: "number" });
	});
	app.command(runtime("child"), (c) => c.flags(runtime([{ name: "safe", type: "number" }])));
}

function _demandValues() {
	const text = defineContext("db", () => "db");
	const number = defineContext("db", () => 42);
	const command = defineCommand("child", (c) =>
		c.use(text).action(async ({ ctx }) => (await ctx.db).toUpperCase()),
	);
	const extension = defineExtension(id, { uses: [text] });
	const app = new Crust("app").provide(number());
	// @ts-expect-error A name does not prove the command's demanded value type.
	app.add(command);
	// @ts-expect-error Checked availability cannot reflect erased callback value types.
	app.add(runtime([command]));
	// @ts-expect-error Extension demands retain their value contracts.
	app.extend(extension);
	// @ts-expect-error Checked Extension collections retain value contracts.
	app.extend(runtime([extension]));
	// @ts-expect-error Inline demands also compare provider values.
	app.command("child", (c) => c.use(text));
	// @ts-expect-error Checked inline names do not erase value contracts.
	app.command(runtime("child"), (c) => c.use(text));
	new Crust("app").provide(text()).add(command);
	new Crust("app").provide(text()).add(runtime([command]));
	new Crust("app").add(runtime([command])); // Missing names are checked at consumption.
}

function _descendantExtensionDemand() {
	const text = defineContext("db", () => "db");
	const number = defineContext("db", () => 42);
	const child = defineCommand("child", (c) => c.provide(number()));
	const extension = defineExtension(id, {
		uses: [text],
		hooks: {
			preRun: async ({ ctx }) => {
				(await ctx.db).toUpperCase();
			},
		},
	});
	// @ts-expect-error Existing descendant shadowing must satisfy application-wide hook demands.
	new Crust("app").provide(text()).add(child).extend(extension);
	// @ts-expect-error Future descendants must satisfy retained hook demands.
	new Crust("app").provide(text()).extend(extension).add(child);
	new Crust("app")
		.provide(text())
		.extend(extension)
		// @ts-expect-error Checked child collections cannot erase callback value contracts.
		.add(runtime([child]));
	new Crust("app")
		.provide(text())
		.add(child)
		// @ts-expect-error Checked Extension collections cannot erase descendant value contracts.
		.extend(runtime([extension]));
	const compatible = defineCommand("child", (c) => c.provide(text()));
	new Crust("app").provide(text()).extend(extension).add(compatible);
	new Crust("app").provide(text()).add(compatible).extend(extension);
	new Crust("app").provide(text()).add(child); // Replacement without an applicable hook demand is allowed.
}

function _dynamicDemandValues() {
	const text = defineContext("db", () => "db");
	const extension = defineExtension(id, { uses: [text] });
	const unknownProvider = defineContext("db", (): unknown => 42);
	const unknownChild = defineCommand("child", (c) => c.provide(runtime([unknownProvider()])));
	new Crust("app")
		.provide(text())
		.extend(extension)
		// @ts-expect-error Unknown shadowing cannot establish a string demand.
		.add(runtime([unknownChild]));
	const dynamicName: string = "db";
	const homogeneous = defineContext(runtime(dynamicName), () => "compatible");
	const providers = [homogeneous()];
	new Crust("app").provide(runtime(providers)).extend(runtime([extension]));
	const unknowns = [defineContext(runtime(dynamicName), (): unknown => 42)()];
	// @ts-expect-error A potentially applicable unknown provider is not string proof.
	new Crust("app").provide(runtime(unknowns)).extend(runtime([extension]));
	new Crust("app")
		.provide(text())
		.extend(extension)
		// @ts-expect-error A later checked replacement must preserve previously declared hook demands.
		.provide(runtime([unknownProvider()]));
	new Crust("app")
		.provide(text())
		.extend(extension)
		// @ts-expect-error Inline checked descendants must preserve retained hook demands.
		.command(runtime("child"), (c) => c.provide(runtime([unknownProvider()])));
}

function _contributedDemandValues() {
	const text = defineContext("db", () => "db");
	const number = defineContext("db", () => 42);
	const demand = defineExtension(id, { uses: [text] });
	const child = defineCommand("child", (c) => c.provide(number()));
	const contribute = defineExtension(defineExtensionId("commands"), { commands: [child] });
	// @ts-expect-error Contributed children also run applicable hooks.
	new Crust("app").provide(text()).extend(demand).extend(contribute);
	// @ts-expect-error Existing contributed children cannot invalidate new hooks.
	new Crust("app").provide(text()).extend(contribute).extend(demand);
	new Crust("app")
		.provide(text())
		.extend(demand)
		// @ts-expect-error Checked contributed provider replacement retains prior hook contracts.
		.extend(runtime([defineExtension(defineExtensionId("provider"), { provides: [number()] })]));
	// @ts-expect-error An open holder cannot erase a concrete provider shape.
	const broad: import("../command/crust.ts").CommandDefinition = child;
	new Crust("app")
		.provide(text())
		.extend(demand)
		// @ts-expect-error A broad child holder cannot certify unknown descendant providers.
		.add(runtime([broad]));
	const dependent = defineContext("dependent", { uses: [text] }, () => true);
	// @ts-expect-error Checked Context dependency names do not establish promised values.
	new Crust("app").provide(number()).provide(runtime([dependent()]));
}

function _onlyHookDemandsAreApplicationWide() {
	const text = defineContext("db", () => "db");
	const unrelated = defineCommand("other", (c) => c.provide(defineContext("db", () => 42)()));
	const command = defineCommand("consumer", (c) => c.use(text));
	const extension = defineExtension(id, { commands: [command] });
	new Crust("app").provide(text()).extend(extension).add(unrelated);
	new Crust("app")
		.provide(text())
		.add(unrelated)
		.extend(runtime([extension]));
}

function _hookDemandProofCannotBeErased() {
	const text = defineContext("db", () => "db");
	const extension = defineExtension(id, { uses: [text] });
	// @ts-expect-error Keeping aggregate demands cannot erase separately retained hook demands.
	const erased: Extension<{ db: string }, [], [], [], never, {}> = extension;
	const root = new Crust("app").provide(text()).extend(extension);
	const empty = new Crust("app").provide(text());
	// @ts-expect-error Application holders cannot erase retained hook obligations.
	const holder: typeof empty = root;
	void [erased, holder];
}

function _commandLocalDemandValues() {
	const text = defineContext("db", () => "db");
	const number = defineContext("db", () => 42);
	defineCommand("child", (c) => {
		// @ts-expect-error Local checked providers cannot invalidate an existing demand.
		return c.use(text).provide(runtime([number()]));
	});
	defineCommand("child", (c) => {
		// @ts-expect-error Demands also compare previously provided local values.
		return c.provide(number()).use(text);
	});
}

function _replacementOrderAndFixedDynamicNames() {
	const name: string = "child";
	const open = defineExtension(
		id,
		runtime({ commands: [defineCommand(runtime(name), (c) => c.action(() => "dynamic"))] }),
	);
	const root = new Crust("app").command("child", (c) => c.action(() => 42));
	const replaced = root.extend(runtime([open]));
	// @ts-expect-error A fixed tuple does not make a dynamic canonical name proven.
	void replaced.run(["child"]);
	const last = defineExtension(defineExtensionId("last"), {
		commands: [defineCommand("child", (c) => c.action(() => true))],
	});
	const commands = [defineCommand(runtime(name), (c) => c.action(() => "dynamic"))];
	const broad = defineExtension(id, runtime({ commands }));
	const restored = root.extend(runtime([broad, last]));
	const result = restored.run(["child"]);
	type _result = Expect<Equal<typeof result, Promise<import("../index.ts").RunOutcome<boolean>>>>;
}

function _checkedAliasReplacementProof() {
	const old = defineCommand("old", { aliases: ["shared"] }, (c) => c.action(() => 42));
	const incoming = defineCommand("incoming", { aliases: ["shared", "old"] }, (c) =>
		c.action(() => "new"),
	);
	const app = new Crust("app")
		.add(old)
		.extend(runtime([defineExtension(id, { commands: [incoming] })]));
	// @ts-expect-error Competing aliases cannot certify the newly registered action's shape.
	void app.run(["shared"]);
	// @ts-expect-error The tree does not distinguish an existing canonical key from its aliases.
	void app.run(["old"]);
	const unknown = app.run(["shared"], runtime({}));
	type _unknown = Expect<Equal<typeof unknown, Promise<import("../index.ts").RunOutcome<unknown>>>>;
	const canonical = new Crust("app")
		.add(old)
		.extend(
			runtime([
				defineExtension(id, { commands: [defineCommand("shared", (c) => c.action(() => true))] }),
			]),
		);
	const result = canonical.run(["shared"]);
	type _canonical = Expect<
		Equal<typeof result, Promise<import("../index.ts").RunOutcome<boolean>>>
	>;
}

function _providersAfterPendingCommands() {
	const owner = defineContext("owner", { flags: [{ name: "token", type: "string" }] }, () => 1);
	const child = defineCommand("child", (c) => c.flags({ name: "token", type: "boolean" }));
	const ext = defineExtension(id, { commands: [child] });
	// @ts-expect-error -- providers added later reach pending contributed commands
	new Crust("app").extend(ext).provide(owner());
	// @ts-expect-error -- the opposite attachment order has the same relation
	new Crust("app").provide(owner()).extend(ext);
	const nested = defineExtension(id, { commands: [defineCommand("parent", (c) => c.add(child))] });
	// @ts-expect-error -- descendant spellings participate in pending relations
	new Crust("app").extend(nested).provide(owner());
	// Ordinary children have already materialized; later providers remain positional.
	new Crust("app").add(child).provide(owner());
	new Crust("app").extend(ext).provide(runtime([owner()]));
}

function _conditionalDescendantDemand(condition: boolean) {
	const text = defineContext("db", () => "db");
	const number = defineContext("db", () => 42);
	const other = defineContext("other", () => true);
	const demand = defineExtension(id, { uses: [text] });
	const child = defineCommand("child", (c) => (condition ? c.provide(number()) : c));
	const root = new Crust("app").provide(text());
	// @ts-expect-error An absent branch cannot hide an incompatible descendant provider.
	root.add(child).extend(demand);
	// @ts-expect-error Retained demands apply to every conditional recipe branch.
	root.extend(demand).add(child);
	// @ts-expect-error Checked child attachment cannot erase provider value contracts.
	root.extend(demand).add(runtime([child]));
	// @ts-expect-error Checked demand attachment checks every existing child branch.
	root.add(runtime([child])).extend(runtime([demand]));
	// @ts-expect-error Inline recipes retain every provider branch.
	root.extend(demand).command("child", (c) => (condition ? c.provide(runtime([number()])) : c));
	root
		.extend(demand)
		// @ts-expect-error Checked inline recipes retain every provider branch.
		.command(runtime("child"), (c) => (condition ? c.provide(runtime([number()])) : c));
	// @ts-expect-error Later hooks check existing conditional inline recipes.
	root.command("child", (c) => (condition ? c.provide(runtime([number()])) : c)).extend(demand);
	root
		.command(runtime("child"), (c) => (condition ? c.provide(runtime([number()])) : c))
		// @ts-expect-error Checked later hooks check existing conditional inline recipes.
		.extend(runtime([demand]));
	const contribution = defineExtension(defineExtensionId("conditional"), { commands: [child] });
	// @ts-expect-error Contributed conditional recipes must satisfy existing hooks.
	root.extend(demand).extend(contribution);
	// @ts-expect-error Later hooks must check contributed conditional recipes.
	root.extend(contribution).extend(demand);
	// @ts-expect-error Checked contributed recipes retain obligations.
	root.extend(runtime([demand])).extend(runtime([contribution]));
	// @ts-expect-error Checked later hooks retain obligations.
	root.extend(runtime([contribution])).extend(runtime([demand]));

	const leaf = defineCommand("leaf", (c) => c.provide(number()));
	const nested = defineCommand("nested", (c) => (condition ? c.add(leaf) : c));
	// @ts-expect-error An absent child branch cannot hide a nested incompatible provider.
	root.add(nested).extend(demand);
	// @ts-expect-error Nested conditional children preserve retained demands.
	root.extend(demand).add(nested);
	// @ts-expect-error Checked nested conditional children preserve retained demands.
	root.extend(runtime([demand])).add(runtime([nested]));
	// @ts-expect-error Existing checked nested conditional children preserve later demands.
	root.add(runtime([nested])).extend(runtime([demand]));
	const mixed = defineCommand("mixed", (c) =>
		condition ? c.provide(number()) : c.provide(other()),
	);
	// @ts-expect-error Disjoint provider names do not imply an empty provider record.
	root.extend(demand).add(mixed);
	const unknown = defineContext("db", (): unknown => 42);
	const uncertain = defineCommand("uncertain", (c) => (condition ? c.provide(unknown()) : c));
	// @ts-expect-error Unknown outputs remain unproven even beside an empty branch.
	root.add(uncertain).extend(runtime([demand]));

	const compatible = defineCommand("compatible", (c) => (condition ? c.provide(text()) : c));
	root.extend(demand).add(compatible);
	root.add(compatible).extend(demand);
	root.extend(runtime([demand])).add(runtime([compatible]));
	root.add(runtime([compatible])).extend(runtime([demand]));
	root.extend(demand).command("inline", (c) => (condition ? c.provide(runtime([text()])) : c));
	const compatibleContribution = defineExtension(defineExtensionId("compatible"), {
		commands: [compatible],
	});
	root.extend(demand).extend(compatibleContribution);
	root.extend(compatibleContribution).extend(demand);
	root.add(child); // No applicable hook demand: conditional replacement remains allowed.
	const sibling = defineCommand("sibling", (c) => (condition ? c.provide(other()) : c));
	root.extend(demand).add(sibling);
	root.add(sibling).extend(demand);
}

function _conditionalProviderAndChildHolders(
	child: CommandDefinition<
		"child",
		readonly [],
		CommandShape<[], {}, {}, void, { db: number } | {}>
	>,
	nested: CommandDefinition<
		"nested",
		readonly [],
		CommandShape<[], {}, { leaf: CommandShape<[], {}, {}, void, { db: number }> } | {}, void, {}>
	>,
	compatible: CommandDefinition<
		"compatible",
		readonly [],
		CommandShape<[], {}, {}, void, { db: string } | {}>
	>,
) {
	const text = defineContext("db", () => "db");
	const demand = defineExtension(id, { uses: [text] });
	const root = new Crust("app").provide(text());
	// @ts-expect-error A supported provider-record holder cannot erase an incompatible branch.
	root.extend(demand).add(runtime([child]));
	// @ts-expect-error Later hooks inspect each provider-record alternative too.
	root.add(runtime([child])).extend(runtime([demand]));
	// @ts-expect-error A conditional child-record holder cannot hide its nested provider.
	root.extend(demand).add(runtime([nested]));
	// @ts-expect-error Later hooks inspect each child-record alternative too.
	root.add(runtime([nested])).extend(runtime([demand]));
	root.extend(demand).add(runtime([compatible]));
	root.add(runtime([compatible])).extend(runtime([demand]));
	root.add(runtime([child]));
}
