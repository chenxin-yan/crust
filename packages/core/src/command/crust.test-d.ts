import type { StandardSchema } from "@crustjs/utils/schema";

import type { Equal, Expect } from "../../tests/helpers.ts";
import { type ContextBag, defineContext } from "../api/context.ts";
import { defineExtension, type Extension } from "../api/extension.ts";
import { defineFlag } from "../api/flags.ts";
import { defineExtensionId } from "../identity.ts";
import type { FlagDef } from "../types.ts";
import { Crust, defineCommand } from "./crust.ts";

// Compile-time regression checks; intentionally never invoked.
// .flags() updates Flags generic
function _typecheckFlagsUpdatesFlagsGeneric() {
	const app = new Crust("test").flags({
		verbose: { type: "boolean", short: "v" },
		port: { type: "number", default: 3000 },
	});

	// Extract the Flags type from the phantom _types property
	type AppFlags = (typeof app)["_types"]["flags"];

	type _checkVerbose = Expect<
		Equal<AppFlags["verbose"], { readonly type: "boolean"; readonly short: "v" }>
	>;
	type _checkPort = Expect<
		Equal<AppFlags["port"], { readonly type: "number"; readonly default: 3000 }>
	>;
}

// .args() updates A generic
function _typecheckArgsUpdatesAGeneric() {
	const app = new Crust("test").args(
		{ name: "file", type: "string", required: true },
		{ name: "count", type: "number", default: 1 },
	);

	type AppArgs = (typeof app)["_types"]["args"];

	type _checkIsReadonly = Expect<
		Equal<
			AppArgs,
			readonly [
				{
					readonly name: "file";
					readonly type: "string";
					readonly required: true;
				},
				{
					readonly name: "count";
					readonly type: "number";
					readonly default: 1;
				},
			]
		>
	>;
}

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

	const extension = defineExtension(defineExtensionId("conditional"));
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

	// @ts-expect-error -- unconditional duplicate providers remain rejected (FIX_DUPLICATE_CONTEXT)
	void c.provide(text()).provide(text());

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
	const extension = defineExtension(defineExtensionId("demands"))
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

	const child = defineCommand("child", (command) => command);
	const sibling = child.as("other");
	const treeUnion = condition ? c.add(child) : c;
	// @ts-expect-error -- explicit type arguments are rejected (FIX_EXPLICIT_TYPE_ARGUMENTS)
	void treeUnion.add<readonly [typeof sibling]>(sibling);

	defineCommand("explicit", (command) => {
		const recipeUnion = condition ? command.use(text) : command;
		return recipeUnion.use<readonly [typeof other]>(other).action(async ({ ctx }) => {
			const value = await ctx.other;
			type _value = Expect<Equal<typeof value, number>>;
		});
	});
}

// rejects sibling command spelling collisions at the call site
function _typecheckRejectsSiblingCommandSpellingCollisionsAtTheCallSite() {
	const issue = defineCommand("issue", { aliases: ["issues", "i"] }, (command) => command);
	const app = new Crust("cli").add(issue);

	// @ts-expect-error -- duplicate sibling canonical name across .add() calls
	app.add(defineCommand("issue", (command) => command));
	// @ts-expect-error -- alias collides with a sibling canonical name
	app.add(defineCommand("info", { aliases: ["issue"] }, (command) => command));
	// @ts-expect-error -- canonical name collides with a sibling alias
	app.add(defineCommand("i", (command) => command));
	// @ts-expect-error -- .as() preserves aliases, including their collisions
	app.add(issue.as("ticket"));
	new Crust("cli").add(
		// @ts-expect-error -- collisions are checked against earlier definitions in the batch
		defineCommand("build", { aliases: ["b"] }, (command) => command),
		defineCommand("b", (command) => command),
	);

	// a valid variant of an input tuple union must not erase a colliding variant's error
	const build = defineCommand("build", (command) => command);
	const defs = Math.random() > 0.5 ? ([build, build] as const) : ([build] as const);
	// @ts-expect-error -- the [build, build] variant collides within the batch
	new Crust("cli").add(...defs);
	// @ts-expect-error -- explicit type arguments are rejected (FIX_EXPLICIT_TYPE_ARGUMENTS)
	new Crust("cli").add<typeof defs>(...defs);
	// @ts-expect-error -- Extension commands share the same batch validation
	defineExtension(defineExtensionId("ext")).add(...defs);

	const dynamicName = "dynamic" as string;
	const dynamic = defineCommand(dynamicName, (command) => command);
	new Crust("cli").add(dynamic).add(defineCommand("static", (command) => command));

	// A runtime-only name does not hide collisions among statically known siblings.
	const afterDynamic = new Crust("cli").add(issue).add(dynamic);
	// @ts-expect-error -- collides with a sibling added before the runtime-only name
	afterDynamic.add(defineCommand("issue", (command) => command));
	// @ts-expect-error -- inline commands check the same siblings
	afterDynamic.command("i", (command) => command);
	new Crust("cli").add(
		// @ts-expect-error -- known definitions in one batch are checked after a runtime-only one
		dynamic,
		issue,
		defineCommand("i", (command) => command),
	);
	// @ts-expect-error -- a batch's known spellings stay checked beside its runtime-only name
	new Crust("cli").add(dynamic, issue).add(defineCommand("issue", (command) => command));
}

// rejects invalid command alias shapes at defineCommand()
function _typecheckRejectsInvalidCommandAliasShapesAtDefineCommand() {
	// @ts-expect-error -- aliases must be non-empty
	defineCommand("issue", { aliases: [""] }, (command) => command);
	// @ts-expect-error -- aliases must not start with a dash
	defineCommand("issue", { aliases: ["-i"] }, (command) => command);
	// @ts-expect-error -- aliases must not contain spaces
	defineCommand("issue", { aliases: ["my issue"] }, (command) => command);
	// @ts-expect-error -- aliases must not contain tabs
	defineCommand("issue", { aliases: ["my\tissue"] }, (command) => command);
	// @ts-expect-error -- aliases must differ from their own canonical name
	defineCommand("issue", { aliases: ["issue"] }, (command) => command);
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
								// @ts-expect-error -- ancestor-owned flags are parsed but not action-visible
								void flags.verbose;
								// @ts-expect-error -- root-local flags do not propagate
								void flags.rootOnly;
							}),
					),
				),
			),
		);
}

// action receives InferArgs<A> for args
function _typecheckActionReceivesInferArgsAForArgs() {
	new Crust("test")
		.args(
			{ name: "file", type: "string", required: true },
			{ name: "count", type: "number", default: 5 },
		)
		.action((_ctx) => {
			type CtxArgs = typeof _ctx.args;
			type _checkFile = Expect<Equal<CtxArgs["file"], string>>;
			type _checkCount = Expect<Equal<CtxArgs["count"], number>>;
		});
}

// brands statically known Extension command collisions at .extend()
function _typecheckBrandsStaticallyKnownExtensionCommandCollisionsAtExtend() {
	const build = defineCommand("build", (command) => command);
	const collidingName = defineExtension(defineExtensionId("name-collision")).add(
		defineCommand("build", (command) => command),
	);
	const collidingAlias = defineExtension(defineExtensionId("alias-collision")).add(
		defineCommand("inspect", { aliases: ["build"] }, (command) => command),
	);
	const first = defineExtension(defineExtensionId("first-command")).add(
		defineCommand("deploy", { aliases: ["d"] }, (command) => command),
	);
	const second = defineExtension(defineExtensionId("second-command")).add(
		defineCommand("d", (command) => command),
	);
	const dynamic: Extension = collidingName;
	const clean = defineExtension(defineExtensionId("clean-command")).add(
		defineCommand("inspect", (command) => command),
	);

	const app = new Crust("cli").add(build);
	// @ts-expect-error -- command name collides with an app sibling (FIX_COMMAND_COLLISION)
	void app.extend(collidingName);
	// @ts-expect-error -- command alias collides with an app sibling (FIX_COMMAND_COLLISION)
	void app.extend(collidingAlias);
	// @ts-expect-error -- command name collides with an earlier Extension alias (FIX_COMMAND_COLLISION)
	void new Crust("cli").extend(first).extend(second);
	void app.extend(dynamic);
	void app.extend(clean);

	// A runtime-only Extension command name does not hide collisions among known spellings.
	const open = defineExtension(defineExtensionId("open-command")).add(
		defineCommand("open" as string, (command) => command),
	);
	const mixed = defineExtension(defineExtensionId("mixed-command")).add(
		defineCommand("open" as string, (command) => command),
		defineCommand("build", (command) => command),
	);
	// @ts-expect-error -- collides with an app sibling after a runtime-only Extension command
	void app.extend(open, collidingName);
	// @ts-expect-error -- collides with an earlier Extension alias in the same call
	void new Crust("cli").extend(first, open, second);
	// @ts-expect-error -- collides with an earlier Extension alias across calls
	void new Crust("cli").extend(first).extend(open).extend(second);
	// @ts-expect-error -- an Extension's known command collides beside its runtime-only one
	void app.extend(mixed);
	// @ts-expect-error -- app siblings added before a runtime-only one are still checked
	void app.add(defineCommand("open" as string, (command) => command)).extend(collidingName);
	// @ts-expect-error -- Extension commands stay checked for later .add() calls
	void new Crust("cli").extend(collidingName).extend(open).add(build);
}

// brands duplicate command spellings within one Extension at defineExtension()
function _typecheckBrandsDuplicateCommandSpellingsWithinOneExtensionAtDefineExtension() {
	void defineExtension(defineExtensionId("self-name-collision")).add(
		// @ts-expect-error -- duplicate canonical name within one Extension (FIX_COMMAND_COLLISION)
		defineCommand("dup", (command) => command),
		defineCommand("dup", (command) => command),
	);
	void defineExtension(defineExtensionId("self-alias-collision")).add(
		// @ts-expect-error -- command name collides with an Extension alias (FIX_COMMAND_COLLISION)
		defineCommand("deploy", { aliases: ["d"] }, (command) => command),
		defineCommand("d", (command) => command),
	);
	void defineExtension(defineExtensionId("cross-call-collision"))
		.add(defineCommand("deploy", { aliases: ["d"] }, (command) => command))
		// @ts-expect-error -- repeated add() calls check earlier Extension commands (FIX_COMMAND_COLLISION)
		.add(defineCommand("d", (command) => command));
	void defineExtension(defineExtensionId("after-open"))
		.add(defineCommand("deploy", { aliases: ["d"] }, (command) => command))
		.add(defineCommand("open" as string, (command) => command))
		// @ts-expect-error -- a runtime-only command does not hide earlier known spellings
		.add(defineCommand("d", (command) => command));
	void defineExtension(defineExtensionId("self-clean")).add(
		defineCommand("build", (command) => command),
		defineCommand("deploy", (command) => command),
	);
}

// infers Extension-owned flags in hook contexts
function _typecheckExtensionOwnedHookFlags() {
	defineExtension(defineExtensionId("typed-flags"))
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
			type _commandFlag = Expect<Equal<typeof ctx.flags.commandFlag, unknown>>;
			const commandFlag: unknown = ctx.flags.commandFlag;
			void commandFlag;
		});
}

// infers defineFlag() values attached to an Extension
function _typecheckDefinedExtensionFlags() {
	const trace = defineFlag({ type: "boolean", default: false });
	defineExtension(defineExtensionId("defined-flags"))
		.flags({ trace })
		.preRun((ctx) => {
			type _trace = Expect<Equal<typeof ctx.flags.trace, boolean>>;
		});
}

// an Extension command with dynamic flags does not hide another Extension's flag collisions
function _typecheckExtensionFlagsBesideDynamicCommandFlags(dynamic: Record<string, FlagDef>) {
	const open = defineExtension(defineExtensionId("open-command-flags")).add(
		defineCommand("open-command", (command) => command.flags(dynamic)),
	);
	const trace = defineExtension(defineExtensionId("trace-flag")).flags({
		trace: { type: "boolean" },
	});
	const child = defineCommand("child", (command) => command.flags({ trace: { type: "string" } }));
	// @ts-expect-error -- the Extension's "trace" collides with the child's own flag
	new Crust("app").add(child).extend(open, trace);
}

// an open Extension in one .extend() call does not erase the others' flags for later checks
function _typecheckExtensionFlagsSurviveAnOpenExtensionInTheSameCall(
	dynamic: Record<string, FlagDef>,
) {
	const open = defineExtension(defineExtensionId("open-flags")).flags(dynamic);
	const trace = defineExtension(defineExtensionId("trace-only")).flags({
		trace: { type: "boolean" },
	});
	const app = new Crust("app").extend(open, trace);
	// @ts-expect-error -- the child's own "trace" collides with the Extension flag
	void app.add(defineCommand("child", (command) => command.flags({ trace: { type: "string" } })));
}

// a variable-length Extension list may be empty, so its flags are not known to be installed
function _typecheckVariableLengthExtensionListsDoNotClaimFlags(condition: boolean) {
	const trace = defineExtension(defineExtensionId("maybe-trace")).flags({
		trace: { type: "boolean" },
	});
	const extensions: (typeof trace)[] = condition ? [trace] : [];
	const app = new Crust("app").extend(...extensions);
	void app.add(defineCommand("child", (command) => command.flags({ trace: { type: "string" } })));
}

// recursive Extension flags reach a nested recipe child without counting as its own flags
function _typecheckNestedRecipeChildrenDoNotOwnRecursiveExtensionFlags() {
	const trace = defineExtension(defineExtensionId("nested-trace")).flags({
		trace: { type: "boolean" },
	});
	const deep = defineCommand("deep", (command) => command);
	const app = new Crust("app").extend(trace).command("x", (c) => c.add(deep).action(() => {}));
	void app.run(["x", "deep"], { flags: { trace: true } });
}

// `recursive: false` Extension flags stay on the root, so commands below it may reuse them
function _typecheckRootOnlyExtensionFlagsLeaveChildrenFree() {
	const rootOnly = defineExtension(defineExtensionId("root-only-depth")).flags({
		depth: { type: "string", recursive: false },
	});
	const child = defineCommand("child", (c) => c.flags({ depth: { type: "number" } }));
	const withCommand = defineExtension(defineExtensionId("depth-command")).add(child);
	new Crust("app").extend(rootOnly).add(child);
	new Crust("app").extend(rootOnly).command("child", (c) => c.flags({ depth: { type: "number" } }));
	new Crust("app").add(child).extend(rootOnly);
	new Crust("app").extend(rootOnly, withCommand);
	new Crust("app").extend(rootOnly).extend(withCommand);
	// @ts-expect-error -- the root's own "depth" collides with the root-only Extension flag
	new Crust("app").flags({ depth: { type: "number" } }).extend(rootOnly);
}

// an open recursive Extension flag record does not hide known inherited-flag collisions
function _typecheckOpenRecursiveFlagsKeepKnownChildChecks(dynamic: Record<string, FlagDef>) {
	const open = defineExtension(defineExtensionId("open-recursive")).flags(dynamic);
	const trace = defineExtension(defineExtensionId("known-trace")).flags({
		trace: { type: "boolean" },
	});
	const owner = defineContext("owner")
		.flags({ pflag: { type: "string" } })
		.setup(() => 1);
	const pflagCommand = defineExtension(defineExtensionId("pflag-command")).add(
		defineCommand("e", (c) => c.flags({ pflag: { type: "string" } })),
	);
	const traceCommand = defineExtension(defineExtensionId("trace-command")).add(
		defineCommand("e", (c) => c.flags({ trace: { type: "string" } })),
	);
	const invalid = () => {
		new Crust("app")
			.provide(owner())
			.extend(open)
			// @ts-expect-error -- the child's "pflag" collides with the inherited Context flag
			.command("child", (c) => c.flags({ pflag: { type: "string" } }));
		// @ts-expect-error -- the Extension command's "pflag" collides with the inherited Context flag
		new Crust("app").provide(owner()).extend(open).extend(pflagCommand);
		// @ts-expect-error -- the Extension command's "trace" collides with the recursive Extension flag
		new Crust("app").extend(trace).extend(open).extend(traceCommand);
	};
	void invalid;
}
