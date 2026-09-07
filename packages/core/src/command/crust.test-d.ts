import type { StandardSchema } from "@crustjs/utils/schema";

import type { Equal, Expect } from "../../tests/helpers.ts";
import { defineContext } from "../api/context.ts";
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
	const collidingName = defineExtension(defineExtensionId("name-collision"), {
		commands: [defineCommand("build", (command) => command)],
	});
	const collidingAlias = defineExtension(defineExtensionId("alias-collision"), {
		commands: [defineCommand("inspect", { aliases: ["build"] }, (command) => command)],
	});
	const first = defineExtension(defineExtensionId("first-command"), {
		commands: [defineCommand("deploy", { aliases: ["d"] }, (command) => command)],
	});
	const second = defineExtension(defineExtensionId("second-command"), {
		commands: [defineCommand("d", (command) => command)],
	});
	const dynamic: Extension = collidingName;
	const clean = defineExtension(defineExtensionId("clean-command"), {
		commands: [defineCommand("inspect", (command) => command)],
	});

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
	void defineExtension(defineExtensionId("self-name-collision"), {
		commands: [
			defineCommand("dup", (command) => command),
			// @ts-expect-error -- duplicate canonical name within one Extension (FIX_COMMAND_COLLISION)
			defineCommand("dup", (command) => command),
		],
	});
	void defineExtension(defineExtensionId("self-alias-collision"), {
		commands: [
			defineCommand("deploy", { aliases: ["d"] }, (command) => command),
			// @ts-expect-error -- canonical name matches an earlier alias within one Extension (FIX_COMMAND_COLLISION)
			defineCommand("d", (command) => command),
		],
	});
	void defineExtension(defineExtensionId("self-clean"), {
		commands: [
			defineCommand("build", (command) => command),
			defineCommand("deploy", (command) => command),
		],
	});
}

// infers Extension-owned flags in hook contexts
function _typecheckExtensionOwnedHookFlags() {
	defineExtension(defineExtensionId("typed-flags"), {
		flags: [
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
		],
		hooks: {
			preRun(ctx) {
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
			},
		},
	});
}

// infers defineFlag() values attached to an Extension
function _typecheckDefinedExtensionFlags() {
	const trace = defineFlag("trace", { type: "boolean", default: false });
	defineExtension(defineExtensionId("defined-flags"), {
		flags: [trace],
		hooks: {
			preRun(ctx) {
				type _trace = Expect<Equal<typeof ctx.flags.trace, boolean>>;
			},
		},
	});
}
