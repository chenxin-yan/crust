import type { StandardSchema } from "@crustjs/utils/schema";

import type { Equal, Expect } from "../../tests/helpers.ts";
import { type ContextBag, defineContext } from "../api/context.ts";
import { defineExtension } from "../api/extension.ts";
import { defineFlag } from "../api/flags.ts";
import { Crust, defineCommand } from "./crust.ts";

// Compile-time regression checks; intentionally never invoked.
// rejects conditional calls that would silently erase rest-parameter inference
function _typecheckRejectsVariadicMethodsOnConditionalBuilderUnion(condition: boolean) {
	const text = defineContext("db").setup(() => "text");
	const other = defineContext("other").setup(() => 1);
	const c = new Crust("cli");

	// @ts-expect-error -- .provide() rejects failed input inference on a builder union
	void (condition ? c.provide(text()) : c).provide(text());
	// @ts-expect-error -- union of distinct builders is not callable via .flags()
	void (condition ? c.provide(text()) : c).flags({ verbose: { type: "boolean" } });

	// flags-only unions share Ctx; the union check must inspect the whole receiver to reject them
	const flagsUnion = condition ? c.flags({ first: { type: "boolean" } }) : c;
	// @ts-expect-error -- union of builders differing only in Flags is not callable via .flags()
	void flagsUnion.flags({ second: { type: "boolean" } });
	// @ts-expect-error -- union of distinct builders is not callable via .args()
	void flagsUnion.args({ name: "target", type: "string" });
	// @ts-expect-error -- .provide() rejects failed inference even when both branches share Ctx
	void flagsUnion.provide(other());

	const child = defineCommand("child", (command) => command);
	const treeUnion = condition ? c.add(child) : c;
	// @ts-expect-error -- .add() rejects a union of builders that differ in state
	void treeUnion.add(child.as("other"));
	// @ts-expect-error -- .command() rejects a union of builders that differ in state
	void treeUnion.command("inline", (command) => command);

	const extension = defineExtension("conditional");
	// @ts-expect-error -- app-capability builders still reject union calls via .extend()
	void flagsUnion.extend(extension);

	defineCommand("conditional", (command) => {
		const recipeUnion = condition ? command.use(text) : command;
		// @ts-expect-error -- .use() rejects failed input inference on a recipe union
		void recipeUnion.use(other);
		return command;
	});

	// identical branches collapse and chain normally
	void (condition ? c.provide(text()) : c.provide(text())).provide(other()).action(({ ctx }) => {
		type _ctx = Expect<Equal<typeof ctx, ContextBag<{ db: string } & { other: number }>>>;
	});

	// non-variadic methods on a union keep working; ctx is the honest union of both branches
	void (condition ? c.provide(text()) : c).action(({ ctx }) => {
		type _ctx = Expect<Equal<typeof ctx, ContextBag<{ db: string }> | ContextBag>>;
	});
}

// Builder methods read their state off an inferred `this`; explicit type arguments would skip
// that inference and type the call against no builder state, so they are rejected.
// `.action()` keeps class parameters and accepts them.
function _typecheckRejectsExplicitTypeArgumentsOnStateMethods() {
	const app = new Crust("cli").flags({ verbose: { type: "boolean" } });
	const child = defineCommand("child", (command) => command);
	// @ts-expect-error -- FIX_EXPLICIT_TYPE_ARGUMENTS
	void app.flags<readonly [{ name: "force"; type: "boolean" }]>({ force: { type: "boolean" } });
	// @ts-expect-error -- FIX_EXPLICIT_TYPE_ARGUMENTS
	void app.args<[{ name: "target"; type: "string" }]>({ name: "target", type: "string" });
	void app.action<void>(() => {});
	// @ts-expect-error -- FIX_EXPLICIT_TYPE_ARGUMENTS
	void app.add<readonly [typeof child]>(child);
	// @ts-expect-error -- FIX_EXPLICIT_TYPE_ARGUMENTS
	void app.command<"inline", any>("inline", (command) => command);
}

// generic and polymorphic-`this` receivers resolve builder state through their constraint
function _typecheckAcceptsGenericAndPolymorphicThisReceivers() {
	const child = defineCommand("child", (command) => command);
	function withEverything<C extends Crust>(c: C) {
		void c.args({ name: "target", type: "string" });
		void c.add(child);
		void c.command("inline", (command) => command);
		void c.action(() => {});
		return c.flags({ verbose: { type: "boolean" } });
	}
	type _flags = Expect<
		Equal<keyof ReturnType<typeof withEverything<Crust>>["_types"]["flags"], "verbose">
	>;
	class CustomApp extends Crust {
		verbose() {
			return this.flags({ verbose: { type: "boolean" } });
		}
		target() {
			return this.args({ name: "target", type: "string" });
		}
		child() {
			return this.add(child).command("inline", (command) => command);
		}
	}
	void CustomApp;
}

// a union receiver cannot drop one branch's Extension Context demands
function _typecheckUnionReceiverKeepsExtensionContextDemands(condition: boolean) {
	const db = defineContext("db").setup(() => "ok");
	const wrongDb = defineContext("db").setup(() => 42);
	const extension = defineExtension("demands")
		.use(db)
		.preRun(async ({ ctx }) => {
			(await ctx.db).toUpperCase();
		});
	const base = new Crust("app").provide(db());
	const child = defineCommand("child", (command) => command.provide(wrongDb()));
	// @ts-expect-error -- FIX_DEPENDENCY_TYPE through the Extension's demands
	void base.extend(extension).add(child);
	// @ts-expect-error -- the union receiver is rejected rather than checked against `{}` demands
	void (condition ? base.extend(extension) : base).add(child);
	// @ts-expect-error -- the union receiver is rejected rather than checked against `{}` demands
	void (condition ? base.extend(extension) : base).command("child", (command) =>
		command.provide(wrongDb()),
	);
}

// explicit registration inputs preserve inference without bypassing collision checks
function _typecheckExplicitInputsOnConditionalBuilderUnion(condition: boolean) {
	const text = defineContext("db").setup(() => "text");
	const other = defineContext("other").setup(() => 1);
	const c = new Crust("cli");
	const contextUnion = condition ? c.provide(text()) : c;

	// @ts-expect-error -- an explicit input tuple still checks FIX_DUPLICATE_CONTEXT
	void contextUnion.provide<readonly [ReturnType<typeof text>]>(text());
	void contextUnion.provide<readonly [ReturnType<typeof other>]>(other()).action(({ ctx }) => {
		type _ctx = Expect<
			Equal<
				typeof ctx,
				ContextBag<{ db: string } & { other: number }> | ContextBag<{ other: number }>
			>
		>;
	});

	defineCommand("explicit", (command) => {
		const recipeUnion = condition ? command.use(text) : command;
		return recipeUnion.use<readonly [typeof other]>(other).action(async ({ ctx }) => {
			const value = await ctx.other;
			type _value = Expect<Equal<typeof value, number>>;
		});
	});
}

// accepts a definition union whose variants alias each other's canonical name
function _typecheckAcceptsCrossAliasedDefinitionUnion(condition: boolean) {
	const x = defineCommand("x", { aliases: ["y"] }, (command) => command);
	const y = defineCommand("y", { aliases: ["x"] }, (command) => command);
	void new Crust("app").add(condition ? x : y);
}

// same-name conditional definitions stay runtime-only, like any conditional definition
function _typecheckSameNameConditionalDefinitionsStayRuntimeOnly(condition: boolean) {
	const a = defineCommand("task", (c) => c.command("a", (x) => x));
	const b = defineCommand("task", (c) => c.command("b", (x) => x));
	const tree = new Crust("cli").add(condition ? a : b);
	void tree.run(["task", "a"]);
	void tree.run(["task", "b"]);

	const left = defineCommand("same", { aliases: ["left"] }, (c) => c);
	const right = defineCommand("same", { aliases: ["right"] }, (c) => c);
	const element = new Crust("cli").add(condition ? left : right);
	void element.add(defineCommand("left", (c) => c));
	void element.run(["runtime-only"]);
	const spread = new Crust("cli").add(...(condition ? ([left] as const) : ([right] as const)));
	void spread.add(defineCommand("left", (c) => c));
	void spread.run(["runtime-only"]);
}

// types pulled capabilities and local values in actions
function _typecheckTypesPulledCapabilitiesAndLocalValuesInActions() {
	const verbose = defineFlag({ type: "boolean" });
	const logging = defineContext("logging")
		.flags({ verbose })
		.setup(({ flags }) => ({
			verbose: flags.verbose === true,
		}));
	new Crust("cli")
		.flags({ rootOnly: { type: "string" } })
		.provide(logging())
		.add(
			defineCommand("level1", (command) =>
				command.use(logging).add(
					defineCommand("level2", (child) =>
						child
							.use(logging)
							.args({ name: "target", type: "string", required: true })
							.action(async ({ args, flags, ctx }) => {
								const log = await ctx.logging;
								type _target = Expect<Equal<typeof args.target, string>>;
								type _verbose = Expect<Equal<typeof log.verbose, boolean>>;
								// A used Context's flags are action-visible
								type _flag = Expect<Equal<typeof flags.verbose, boolean | undefined>>;
								// @ts-expect-error -- root-local flags do not propagate
								void flags.rootOnly;
							}),
					),
				),
			),
		);
}

// infers Extension-owned flags in hook contexts
function _typecheckExtensionOwnedHookFlags() {
	defineExtension("typed-flags")
		.flags({
			verbose: { type: "boolean", default: false },
			rootPort: { type: "number", default: 3000, recursive: false },
			token: { type: "string", required: true },
			endpoint: {
				type: "string",
				schema: {} as StandardSchema<string | undefined, URL>,
			},
			tags: {
				type: "string",
				multiple: true,
				schema: {} as StandardSchema<string[], string[]>,
			},
		})
		.preRun((ctx) => {
			type _verbose = Expect<Equal<typeof ctx.flags.verbose, boolean>>;
			type _rootPort = Expect<Equal<typeof ctx.flags.rootPort, number | undefined>>;
			// Hooks run before validation, so a required flag may still be absent.
			type _token = Expect<Equal<typeof ctx.flags.token, string | undefined>>;
			// Schema flags reflect the raw syntax token, not the schema output.
			type _endpoint = Expect<Equal<typeof ctx.flags.endpoint, string | undefined>>;
			type _tags = Expect<Equal<typeof ctx.flags.tags, string[] | undefined>>;
			// @ts-expect-error A flag the Extension neither owns nor reaches through a Context is untyped.
			void ctx.flags.commandFlag;
		});
}

// infers defineFlag() values attached to an Extension
function _typecheckDefinedExtensionFlags() {
	const trace = defineFlag({ type: "boolean", default: false });
	defineExtension("defined-flags")
		.flags({ trace })
		.preRun((ctx) => {
			type _trace = Expect<Equal<typeof ctx.flags.trace, boolean>>;
		});
}

// recursive Extension flags reach a nested recipe child without counting as its own flags
function _typecheckNestedRecipeChildrenDoNotOwnRecursiveExtensionFlags() {
	const trace = defineExtension("nested-trace").flags({
		trace: { type: "boolean" },
	});
	const deep = defineCommand("deep", (command) => command);
	const app = new Crust("app").extend(trace).command("x", (c) => c.add(deep).action(() => {}));
	void app.run(["x", "deep"], { flags: { trace: true } });
}

// inline .command() children, at any depth, see the recursive Extension flags registered before them
function _typecheckInlineChildrenSeeRecursiveExtensionFlags() {
	const logging = defineExtension("logging").flags({
		trace: { type: "boolean", default: false },
		root: { type: "string", recursive: false },
	});
	new Crust("x").extend(logging).command("group", (group) =>
		group.command("leaf", (leaf) =>
			leaf.action(({ flags }) => {
				type _trace = Expect<Equal<typeof flags.trace, boolean>>;
				// @ts-expect-error -- a root-only flag does not reach children
				void flags.root;
			}),
		),
	);
}

// `.use()` on an app says what to write instead
function _typecheckUseOnAnAppNamesProvide() {
	const db = defineContext("db").setup(() => 1);
	// @ts-expect-error -- FIX_USE_ON_APP: an app supplies a Context with .provide(db())
	new Crust("x").use(db);
	new Crust("x").provide(db());
}
