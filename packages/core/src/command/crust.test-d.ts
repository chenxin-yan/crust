import type { StandardSchema } from "@crustjs/utils/schema";

import type { Equal, Expect } from "../../tests/helpers.ts";
import { type ContextBag, defineContext } from "../api/context.ts";
import { defineExtension, type Extension } from "../api/extension.ts";
import { defineFlag } from "../api/flags.ts";
import { defineExtensionId } from "../identity.ts";
import { Crust, defineCommand } from "./crust.ts";

// Compile-time regression checks; intentionally never invoked.
// .flags() updates Flags generic
function _typecheckFlagsUpdatesFlagsGeneric() {
	const app = new Crust("test").flags(
		{ name: "verbose", type: "boolean", short: "v" },
		{ name: "port", type: "number", default: 3000 },
	);

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

// chaining .flags().args() preserves both generics
function _typecheckChainingFlagsArgsPreservesBothGenerics() {
	const app = new Crust("test")
		.flags(
			{ name: "verbose", type: "boolean", short: "v" },
			{ name: "port", type: "number", default: 3000 },
		)
		.args({ name: "file", type: "string", required: true });

	// Verify the Flags generic is preserved
	type AppFlags = (typeof app)["_types"]["flags"];
	type _checkVerbose = Expect<
		Equal<AppFlags["verbose"], { readonly type: "boolean"; readonly short: "v" }>
	>;

	// Verify args A generic is preserved
	type AppArgs = (typeof app)["_types"]["args"];
	type _checkArgs = Expect<
		Equal<
			AppArgs,
			readonly [
				{
					readonly name: "file";
					readonly type: "string";
					readonly required: true;
				},
			]
		>
	>;
}

// rejects conditional calls that would silently erase rest-parameter inference
function _typecheckRejectsVariadicMethodsOnConditionalBuilderUnion(condition: boolean) {
	const text = defineContext("db", () => "text");
	const other = defineContext("other", () => 1);
	const c = new Crust("cli");

	// @ts-expect-error -- .provide() rejects failed input inference on a builder union
	void (condition ? c.provide(text()) : c).provide(text());
	// @ts-expect-error -- union of distinct builders is not callable via .flags()
	void (condition ? c.provide(text()) : c).flags({ name: "verbose", type: "boolean" });

	// flags-only unions share Ctx; the phantom parameter must bind to `this` to reject them
	const flagsUnion = condition ? c.flags({ name: "first", type: "boolean" }) : c;
	// @ts-expect-error -- union of builders differing only in Flags is not callable via .flags()
	void flagsUnion.flags({ name: "second", type: "boolean" });
	// @ts-expect-error -- union of distinct builders is not callable via .args()
	void flagsUnion.args({ name: "target", type: "string" });
	// @ts-expect-error -- .provide() rejects failed inference even when both branches share Ctx
	void flagsUnion.provide(other());

	const child = defineCommand("child", (command) => command);
	const treeUnion = condition ? c.add(child) : c;
	// @ts-expect-error -- .add() rejects failed input inference on a tree-only union
	void treeUnion.add(child.as("other"));

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

// explicit registration inputs preserve inference without bypassing collision checks
function _typecheckExplicitInputsOnConditionalBuilderUnion(condition: boolean) {
	const text = defineContext("db", () => "text");
	const other = defineContext("other", () => 1);
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
	// @ts-expect-error -- an explicit input tuple still checks FIX_COMMAND_COLLISION
	void treeUnion.add<readonly [typeof child]>(child);
	const registered = treeUnion.add<readonly [typeof sibling]>(sibling);
	type _commonPaths = Expect<Equal<keyof (typeof registered)["_types"]["tree"], "other">>;

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

	const dynamicName = "dynamic" as string;
	const dynamic = defineCommand(dynamicName, (command) => command);
	new Crust("cli").add(dynamic).add(defineCommand("static", (command) => command));
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

// types pulled capabilities and local values in actions
function _typecheckTypesPulledCapabilitiesAndLocalValuesInActions() {
	const verbose = defineFlag("verbose", { type: "boolean" });
	const logging = defineContext("logging", { flags: [verbose] }, ({ flags }) => ({
		verbose: flags.verbose === true,
	}));
	new Crust("cli")
		.flags({ name: "rootOnly", type: "string" })
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

// variadic args resolve to array type in action
function _typecheckVariadicArgsResolveToArrayTypeInAction() {
	new Crust("test").args({ name: "files", type: "string", variadic: true }).action((_ctx) => {
		type CtxArgs = typeof _ctx.args;
		type _checkFiles = Expect<Equal<CtxArgs["files"], string[]>>;
	});
}

// multiple flag resolves to array type in action
function _typecheckMultipleFlagResolvesToArrayTypeInAction() {
	new Crust("test")
		.flags({ name: "tags", type: "string", multiple: true, required: true })
		.action((_ctx) => {
			type CtxFlags = typeof _ctx.flags;
			type _checkTags = Expect<Equal<CtxFlags["tags"], string[]>>;
		});
}

// optional flag resolves to union with undefined in action
function _typecheckOptionalFlagResolvesToUnionWithUndefinedInAction() {
	new Crust("test").flags({ name: "port", type: "number" }).action((_ctx) => {
		type CtxFlags = typeof _ctx.flags;
		type _checkPort = Expect<Equal<CtxFlags["port"], number | undefined>>;
	});
}

// required flag resolves to non-optional type in action
function _typecheckRequiredFlagResolvesToNonOptionalTypeInAction() {
	new Crust("test").flags({ name: "name", type: "string", required: true }).action((_ctx) => {
		type CtxFlags = typeof _ctx.flags;
		type _checkName = Expect<Equal<CtxFlags["name"], string>>;
	});
}

// flag with default resolves to non-optional type in action
function _typecheckFlagWithDefaultResolvesToNonOptionalTypeInAction() {
	new Crust("test").flags({ name: "port", type: "number", default: 3000 }).action((_ctx) => {
		type CtxFlags = typeof _ctx.flags;
		type _checkPort = Expect<Equal<CtxFlags["port"], number>>;
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
	void defineExtension(defineExtensionId("self-clean")).add(
		defineCommand("build", (command) => command),
		defineCommand("deploy", (command) => command),
	);
}

// infers Extension-owned flags in hook contexts
function _typecheckExtensionOwnedHookFlags() {
	defineExtension(defineExtensionId("typed-flags"))
		.flags(
			{ name: "verbose", type: "boolean", default: false },
			{ name: "rootPort", type: "number", default: 3000, recursive: false },
			{ name: "token", type: "string", required: true },
			{
				name: "endpoint",
				type: "string",
				schema: {} as StandardSchema<string | undefined, URL>,
			},
			{
				name: "tags",
				type: "string",
				multiple: true,
				schema: {} as StandardSchema<string[], string[]>,
			},
		)
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
	const trace = defineFlag("trace", { type: "boolean", default: false });
	defineExtension(defineExtensionId("defined-flags"))
		.flags(trace)
		.preRun((ctx) => {
			type _trace = Expect<Equal<typeof ctx.flags.trace, boolean>>;
		});
}
