/* oxlint-disable anti-slop/no-unknown-returns, anti-slop/no-known-value-widening -- compile-only probes deliberately model opaque Context value contracts. */
import type { Equal, Expect } from "../../tests/helpers.ts";
import {
	Crust,
	defineCommand,
	type AnyCommandDefinitionBuilder,
	type AnyCrust,
	type CommandDefinition,
	type CommandDefinitionBuilder,
	type CommandShape,
} from "../command/crust.ts";
import { defineExtensionId } from "../identity.ts";
import type { RunOutcome } from "../index.ts";
import { defineContext, type ContextInstance } from "./context.ts";
import { defineExtension, type Extension } from "./extension.ts";

const id = defineExtensionId("boundary");

function _extensionBoundary(broad: Extension) {
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
	type _Result = Expect<Equal<typeof result, Promise<RunOutcome<number>>>>;
	const needsVersion = defineExtension<"version">()(id);
	// @ts-expect-error Checked collections retain erased metadata requirements.
	new Crust("app").extend(needsVersion);
	new Crust("app", { version: "1" }).extend(needsVersion);
	const list = [empty];
	new Crust("app").extend(...list);
	new Crust("app").extend(broad);
	const choice = Math.random()
		? empty
		: defineExtension(id, { flags: [{ name: "trace", type: "boolean" }] });
	new Crust("app").extend(choice);
	function generic<E extends Extension>(extension: E) {
		// @ts-expect-error Unresolved generic contributions cannot use the trusted path.
		new Crust("app").extend(extension);
	}
	void generic;
	new Crust("app").extend();
}

function _privateCommandProof() {
	const child = defineCommand("child", (c) =>
		c.flags({ name: "token", type: "string" }).action(() => 42),
	);
	const copy = { ...child };
	const app = new Crust("app").add(copy);
	const outcome = app.run(["child"], { flags: { token: "value" } });
	type _result = Expect<Equal<typeof outcome, Promise<RunOutcome<number>>>>;
	new Crust("app")
		.provide(defineContext("owner", { flags: [{ name: "token", type: "string" }] }, () => 1)())
		// @ts-expect-error Structural copies retain carried flag relations.
		.add(copy);
	const db = defineContext("db", () => 1);
	const demanding = defineCommand("demand", (c) => c.use(db));
	// @ts-expect-error Structural copies retain declared demands.
	new Crust("app").add({ ...demanding });
}

function _holderErasure() {
	const db = defineContext("db", () => 1);
	const command = defineCommand("demand", (c) => c.use(db));
	// @ts-expect-error A typed holder cannot erase privately retained demands.
	const erasedCommand: CommandDefinition<"demand", readonly [], CommandShape<[], {}>> = command;
	const extension = defineExtension(id, { uses: [db] });
	// @ts-expect-error An empty Extension holder cannot erase demands.
	const erasedExtension: Extension<{}, [], [], []> = extension;
	const instance = defineContext(
		"owned",
		{ flags: [{ name: "token", type: "string" }] },
		() => 1,
	)();
	// @ts-expect-error An empty Context holder cannot erase owned flag state.
	const erasedContext: ContextInstance<"owned", number, {}, {}> = instance;
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
	const broad: AnyCrust = root;
	// @ts-expect-error Completed-application holders cannot regenerate empty-root proof.
	const regained: Crust = broad;
	// @ts-expect-error Completed holders are not an authoring escape hatch.
	broad.provide(db());
	void broad.execute();
	void broad.snapshot();
	void broad.run([], {});
	void broad.run([]);
	function identity<B extends AnyCrust>(builder: B): B {
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
	const commands = [defineCommand(name, (c) => c.action(() => "replacement"))];
	const app = new Crust("app")
		.flags({ name: "root", type: "number" })
		.command("child", (c) => c.action(() => 42))
		.extend(defineExtension(id, { commands }));
	void app.run(["child"]);
	void app.run([], { flags: { root: 1 } });
	const replacements = [
		defineExtension(id, {
			commands: [defineCommand("child", (c) => c.action(() => "replacement"))],
		}),
	];
	const dynamic = new Crust("app")
		.command("child", (c) => c.action(() => 42))
		.command("sibling", (c) => c.action(() => true))
		.extend(...replacements);
	const result = dynamic.run(["child"]);
	type _result = Expect<Equal<typeof result, Promise<RunOutcome<unknown>>>>;
	const sibling = dynamic.run(["sibling"]);
	type _sibling = Expect<Equal<typeof sibling, Promise<RunOutcome<unknown>>>>;
}

function _recipeHolderProof() {
	const erase = (b: CommandDefinitionBuilder): CommandDefinitionBuilder => b;
	defineCommand("child", (c) => {
		// @ts-expect-error A public default holder cannot erase a recipe's local flags.
		return erase(c.flags({ name: "token", type: "number" }));
	});
	function identity<B extends AnyCommandDefinitionBuilder>(b: B): B {
		return b;
	}
	const child = defineCommand("child", (c) => identity(c.flags({ name: "token", type: "number" })));
	const owner = defineContext("owner", { flags: [{ name: "token", type: "string" }] }, () => 1);
	// @ts-expect-error Generic identity retains the destination collision proof.
	new Crust("app").provide(owner()).add(child);
}

function _openInlineOwnedFlags() {
	const name: string = "token";
	const owner = defineContext("owner", { flags: [{ name, type: "string" }] }, () => 1);
	const app = new Crust("app").provide(owner());
	app.command("child", (c) => {
		return c.flags({ name: "token", type: "number" });
	});
	app.command("child", (c) => c.flags({ name: "safe", type: "number" }));
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
	// @ts-expect-error Extension demands retain their value contracts.
	app.extend(extension);
	// @ts-expect-error Inline demands also compare provider values.
	app.command("child", (c) => c.use(text));
	new Crust("app").provide(text()).add(command);
	// @ts-expect-error -- missing provider "db"
	new Crust("app").add(command);
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

	const compatible = defineCommand("child", (c) => c.provide(text()));
	new Crust("app").provide(text()).extend(extension).add(compatible);
	new Crust("app").provide(text()).add(compatible).extend(extension);
	new Crust("app").provide(text()).add(child); // Replacement without an applicable hook demand is allowed.
}

function _dynamicDemandValues() {
	const text = defineContext("db", () => "db");
	const extension = defineExtension(id, { uses: [text] });
	const unknownProvider = defineContext("db", (): unknown => 42);
	const unknownChild = defineCommand("child", (c) => c.provide(unknownProvider()));
	new Crust("app")
		.provide(text())
		.extend(extension)
		// @ts-expect-error Unknown shadowing cannot establish a string demand.
		.add(unknownChild);
	const dynamicName: string = "db";
	const homogeneous = defineContext(dynamicName, () => "compatible");
	const providers = [homogeneous()];
	new Crust("app").provide(...providers).extend(extension);
	const unknowns = [defineContext(dynamicName, (): unknown => 42)()];
	// A fully open unknown-valued provider collection has no provable mismatch.
	new Crust("app").provide(...unknowns).extend(extension);
	new Crust("app")
		.provide(text())
		.extend(extension)
		// @ts-expect-error A later checked replacement must preserve previously declared hook demands.
		.provide(unknownProvider());
	new Crust("app")
		.provide(text())
		.extend(extension)
		// @ts-expect-error Inline checked descendants must preserve retained hook demands.
		.command("child", (c) => c.provide(unknownProvider()));
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
		.extend(defineExtension(defineExtensionId("provider"), { provides: [number()] }));
	// @ts-expect-error An open holder cannot erase a concrete provider shape.
	const broad: CommandDefinition = child;
	// A broad child holder has no statically known descendant value mismatch.
	new Crust("app").provide(text()).extend(demand).add(broad);
	const dependent = defineContext("dependent", { uses: [text] }, () => true);
	// @ts-expect-error Checked Context dependency names do not establish promised values.
	new Crust("app").provide(number()).provide(dependent());
}

function _onlyHookDemandsAreApplicationWide() {
	const text = defineContext("db", () => "db");
	const unrelated = defineCommand("other", (c) => c.provide(defineContext("db", () => 42)()));
	const command = defineCommand("consumer", (c) => c.use(text));
	const extension = defineExtension(id, { commands: [command] });
	new Crust("app").provide(text()).extend(extension).add(unrelated);
	new Crust("app").provide(text()).add(unrelated).extend(extension);
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
		return c.use(text).provide(number());
	});
	defineCommand("child", (c) => {
		// @ts-expect-error Demands also compare previously provided local values.
		return c.provide(number()).use(text);
	});
}

function _replacementOrderAndFixedDynamicNames() {
	const name: string = "child";
	const open = defineExtension(id, {
		commands: [defineCommand(name, (c) => c.action(() => "dynamic"))],
	});
	const root = new Crust("app").command("child", (c) => c.action(() => 42));
	const replaced = root.extend(open);
	void replaced.run(["child"]);
	const last = defineExtension(defineExtensionId("last"), {
		commands: [defineCommand("child", (c) => c.action(() => true))],
	});
	const commands = [defineCommand(name, (c) => c.action(() => "dynamic"))];
	const broad = defineExtension(id, { commands });
	const restored = root.extend(broad, last);
	const result = restored.run(["child"]);
	type _result = Expect<Equal<typeof result, Promise<RunOutcome<boolean>>>>;
}

function _checkedAliasReplacementProof() {
	const old = defineCommand("old", { aliases: ["shared"] }, (c) => c.action(() => 42));
	const incoming = defineCommand("incoming", { aliases: ["shared", "old"] }, (c) =>
		c.action(() => "new"),
	);
	const aliases = [defineExtension(id, { commands: [incoming] })];
	const app = new Crust("app").add(old).extend(...aliases);
	void app.run(["shared"]);
	void app.run(["old"]);
	const unknown = app.run(["shared"], {});
	type _unknown = Expect<Equal<typeof unknown, Promise<RunOutcome<unknown>>>>;
	const replacements = [
		defineExtension(id, { commands: [defineCommand("shared", (c) => c.action(() => true))] }),
	];
	const canonical = new Crust("app").add(old).extend(...replacements);
	const result = canonical.run(["shared"]);
	type _canonical = Expect<Equal<typeof result, Promise<RunOutcome<unknown>>>>;
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

	// @ts-expect-error Inline recipes retain every provider branch.
	root.extend(demand).command("child", (c) => (condition ? c.provide(number()) : c));

	// @ts-expect-error Later hooks check existing conditional inline recipes.
	root.command("child", (c) => (condition ? c.provide(number()) : c)).extend(demand);

	const contribution = defineExtension(defineExtensionId("conditional"), { commands: [child] });
	// @ts-expect-error Contributed conditional recipes must satisfy existing hooks.
	root.extend(demand).extend(contribution);
	// @ts-expect-error Later hooks must check contributed conditional recipes.
	root.extend(contribution).extend(demand);

	const leaf = defineCommand("leaf", (c) => c.provide(number()));
	const nested = defineCommand("nested", (c) => (condition ? c.add(leaf) : c));
	// @ts-expect-error An absent child branch cannot hide a nested incompatible provider.
	root.add(nested).extend(demand);
	// @ts-expect-error Nested conditional children preserve retained demands.
	root.extend(demand).add(nested);

	const mixed = defineCommand("mixed", (c) =>
		condition ? c.provide(number()) : c.provide(other()),
	);
	// @ts-expect-error Disjoint provider names do not imply an empty provider record.
	root.extend(demand).add(mixed);
	const unknown = defineContext("db", (): unknown => 42);
	const uncertain = defineCommand("uncertain", (c) => (condition ? c.provide(unknown()) : c));
	// @ts-expect-error Unknown outputs remain unproven even beside an empty branch.
	root.add(uncertain).extend(demand);

	const compatible = defineCommand("compatible", (c) => (condition ? c.provide(text()) : c));
	root.extend(demand).add(compatible);
	root.add(compatible).extend(demand);
	root.extend(demand).command("inline", (c) => (condition ? c.provide(text()) : c));
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
	root.extend(demand).add(child);
	// @ts-expect-error Later hooks inspect each provider-record alternative too.
	root.add(child).extend(demand);
	// @ts-expect-error A conditional child-record holder cannot hide its nested provider.
	root.extend(demand).add(nested);
	// @ts-expect-error Later hooks inspect each child-record alternative too.
	root.add(nested).extend(demand);
	root.extend(demand).add(compatible);
	root.add(compatible).extend(demand);
	root.add(child);
}
