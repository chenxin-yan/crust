import type { StandardSchema } from "@crustjs/utils/schema";

import type { Equal, Expect } from "../../tests/helpers.ts";
import { defineExtension } from "../api/extension.ts";
import { defineExtensionId } from "../identity.ts";
import { Crust, defineCommand } from "./crust.ts";
import type { CommandPath, CommandShapeAt, RunInput, RunOutcome } from "./typed-run.ts";

interface NamedJsonPayload {
	name: string;
	nested: { enabled: boolean };
}
interface NonJsonPayload {
	createdAt: Date;
}

// "root" plus 14 "next" segments — a path exactly at the depth-15 cap.
type FifteenDeep = readonly [
	"root",
	"next",
	"next",
	"next",
	"next",
	"next",
	"next",
	"next",
	"next",
	"next",
	"next",
	"next",
	"next",
	"next",
	"next",
];

// Compile-time regression checks; intentionally never invoked.
// layers recursive Extension flags onto earlier command trees
function _typecheckLayersRecursiveExtensionFlagsOntoEarlierCommandTrees() {
	const local = defineCommand("local", (command) => command.action(() => {}));
	const trace = defineExtension(defineExtensionId("trace")).flags({
		trace: {
			type: "boolean",
		},
	});
	const addedThenExtended = new Crust("cli").add(local).extend(trace);
	type LocalInput = RunInput<
		CommandShapeAt<(typeof addedThenExtended)["_types"]["shape"], readonly ["local"]>
	>;
	type _addedCommandFlags = Expect<Equal<NonNullable<LocalInput["flags"]>, { trace?: boolean }>>;

	const tools = defineExtension(defineExtensionId("tools")).add(
		defineCommand("inspect", (command) => command.action(() => {})),
	);
	const extendedTwice = new Crust("cli").extend(tools).extend(trace);
	type InspectInput = RunInput<
		CommandShapeAt<(typeof extendedTwice)["_types"]["shape"], readonly ["inspect"]>
	>;
	type _extensionCommandFlags = Expect<
		Equal<NonNullable<InspectInput["flags"]>, { trace?: boolean }>
	>;
}

// rejects statically known Extension command collisions
function _typecheckRejectsStaticallyKnownExtensionCommandCollisions() {
	const extFoo = defineExtension(defineExtensionId("extfoo")).add(
		defineCommand("foo", (command) => command.action(() => "ext" as const)),
	);
	const appFoo = defineCommand("foo", (command) => command.action(() => 42 as const));

	// @ts-expect-error -- Extension command collides with an existing app command
	void new Crust("cli").add(appFoo).extend(extFoo);
	// @ts-expect-error -- added command collides with a registered Extension command
	void new Crust("cli").extend(extFoo).add(appFoo);
	const otherFoo = defineExtension(defineExtensionId("other")).add(
		defineCommand("foo", (command) => command.action(() => {})),
	);
	// @ts-expect-error -- Extensions in the same call must not collide
	void new Crust("cli").extend(extFoo, otherFoo);
}

// keeps conditionally assembled Extension contributions runtime-only
function _typecheckKeepsConditionallyAssembledExtensionContributionsRuntimeOnly() {
	const foo = defineCommand("foo", (command) => command.action(() => {}));
	const bar = defineCommand("bar", (command) => command.action(() => {}));
	const condition = (globalThis as { __never?: boolean }).__never === true;
	const conditional = defineExtension(defineExtensionId("conditional"))
		.flags(condition ? { fa: { type: "boolean" } } : { fb: { type: "boolean" } })
		.add(...(condition ? [foo] : [bar]));
	const app = new Crust("cli").action(() => {}).extend(conditional);
	const elementConditional = defineExtension(defineExtensionId("element")).add(
		condition ? foo : bar,
	);
	const elementApp = new Crust("cli").extend(elementConditional);

	// A conditional commands array leaves paths to runtime checks, like other runtime-only names.
	void app.run(["foo"]);
	void app.run([], { flags: { fa: true } });
	void elementApp.run(["foo"]);
}

// keeps dynamically assembled Extensions and contribution arrays runtime-only
function _typecheckKeepsDynamicallyAssembledExtensionsAndContributionArraysRuntimeOnly() {
	const foo = defineCommand("foo", (command) => command.action(() => "foo" as const));
	const bar = defineCommand("bar", (command) => command.action(() => "bar" as const));
	const condition = (globalThis as { __never?: boolean }).__never === true;

	// Homogeneous variable-length contribution arrays may be empty at runtime.
	const homoCommands: (typeof foo)[] = condition ? [foo] : [];
	const homoExt = defineExtension(defineExtensionId("homo")).add(...homoCommands);
	const homoApp = new Crust("cli").extend(homoExt);

	// A conditionally selected Extension installs only one branch.
	const extFoo = defineExtension(defineExtensionId("extfoo")).add(foo);
	const extBar = defineExtension(defineExtensionId("extbar")).add(bar);
	const unionApp = new Crust("cli").extend(condition ? extFoo : extBar);
	const bothApp = new Crust("cli").extend(extFoo, extBar);

	// A variable-length Extension list may install nothing.
	const extensionList: (typeof extFoo)[] = condition ? [extFoo] : [];
	const spreadApp = new Crust("cli").extend(...extensionList);

	void homoApp.run(["foo"]);
	// A conditionally selected Extension leaves paths to runtime checks, like other runtime-only names.
	void unionApp.run(["foo"]);
	void unionApp.run(["bar"]);
	// Separate static Extensions in one call still publish both paths.
	void bothApp.run(["foo"]);
	void bothApp.run(["bar"]);
	void spreadApp.run(["foo"]);
	void spreadApp.add(foo);
}

// rejects command collisions inside one Extension's tuple
function _typecheckRejectsCommandCollisionsInsideOneExtensionSTuple() {
	const foo = defineCommand("foo", (command) => command.action(() => "a" as const));
	const fooDup = defineCommand("foo", (command) => command.action(() => "b" as const));
	const aliasA = defineCommand("alpha", { aliases: ["shared"] }, (command) =>
		command.action(() => {}),
	);
	const aliasB = defineCommand("beta", { aliases: ["shared"] }, (command) =>
		command.action(() => {}),
	);

	// @ts-expect-error -- duplicate canonical names are rejected
	void defineExtension(defineExtensionId("dup")).add(foo, fooDup);
	// @ts-expect-error -- a shared alias would union both shapes under one path
	void defineExtension(defineExtensionId("alias")).add(aliasA, aliasB);
	// Distinct spellings pass.
	void defineExtension(defineExtensionId("ok")).add(foo, aliasA);
}

// rejects Extension flags colliding with contributed command flags
function _typecheckRejectsExtensionFlagsCollidingWithContributedCommandFlags() {
	const scan = defineCommand("scan", (command) =>
		command.flags({ trace: { type: "boolean" } }).action(() => {}),
	);
	const extension = defineExtension(defineExtensionId("tracing"))
		.flags({ trace: { type: "string" as const } })
		.add(scan);
	const clean = defineExtension(defineExtensionId("clean"))
		.flags({ other: { type: "string" as const } })
		.add(scan);

	// @ts-expect-error -- prepare injects the flag into the contributed command and throws
	void new Crust("cli").extend(extension);
	// Disjoint spellings pass.
	void new Crust("cli").extend(clean);

	const dynamicFlags: Record<string, { type: "boolean" }> = {};
	const open = defineCommand("open", (command) => command.flags(dynamicFlags));
	const tracing = defineExtension(defineExtensionId("trace-only")).flags({
		trace: { type: "string" as const },
	});
	// @ts-expect-error -- an added command with runtime-only flags does not hide a sibling's
	void new Crust("cli").add(scan).add(open).extend(tracing);
	void new Crust("cli").add(open).extend(tracing);
}

// keeps widened recursive flag scopes off descendant typed inputs
function _typecheckKeepsWidenedRecursiveFlagScopesOffDescendantTypedInputs() {
	const dynamicScope = (globalThis as { __never?: boolean }).__never === true;
	const scoped = defineExtension(defineExtensionId("scoped")).flags({
		trace: {
			type: "boolean",
			recursive: dynamicScope,
		},
	});
	const child = defineCommand("child", (command) => command.action(() => {}));
	const app = new Crust("cli")
		.action(() => {})
		.extend(scoped)
		.add(child);

	// The flag is always installed on the root, so the root input keeps it.
	void app.run([], { flags: { trace: true } });
	void app.run(["child"], { flags: { trace: true } });
}

// accepts structurally JSON-compatible named interfaces
function _typecheckAcceptsStructurallyJSONCompatibleNamedInterfaces() {
	const app = new Crust("cli").flags({ config: { type: "json" } }).action(() => {});
	const payload: NamedJsonPayload = { name: "demo", nested: { enabled: true } };
	void app.run([], { flags: { config: payload } });
	const invalid: NonJsonPayload = { createdAt: new Date() };
	// @ts-expect-error -- named interfaces still reject recursively non-JSON properties
	void app.run([], { flags: { config: invalid } });
}

// preserves command aliases and pre-parse input types
function _typecheckPreservesCommandAliasesAndPreParseInputTypes() {
	const rawNumber: StandardSchema<string | undefined, number> = {
		"~standard": {
			version: 1,
			vendor: "test",
			validate: (value) => ({ value: Number(value) }),
		},
	};
	const deploy = defineCommand("deploy", { aliases: ["ship"] }, (command) =>
		command
			.args(
				{ name: "target", type: "string", required: true },
				{ name: "port", schema: rawNumber },
				{ name: "region", type: "string", required: true, default: "us" },
			)
			.flags({
				mode: { type: "string", choices: ["dev", "prod"], required: true },
				retries: { type: "string", parse: Number },
				color: { type: "boolean", default: true },
				env: { type: "string", required: true, default: "prod" },
				version: { type: "boolean", noNegate: true },
			})
			.action(() => {}),
	);
	const release = defineCommand("release-now", (command) => command.add(deploy));
	const app = new Crust("cli").add(release);

	type Path = CommandPath<(typeof app)["_types"]["tree"]>;
	type _nestedPath = Expect<readonly ["release-now", "deploy"] extends Path ? true : false>;
	type _aliasPath = Expect<readonly ["release-now", "ship"] extends Path ? true : false>;
	type _kebabPath = Expect<readonly ["release-now"] extends Path ? true : false>;
	type DeployShape = CommandShapeAt<
		(typeof app)["_types"]["shape"],
		readonly ["release-now", "deploy"]
	>;
	type DeployInput = RunInput<DeployShape>;
	const valid: DeployInput = {
		args: { target: "prod", port: "8080" },
		flags: { mode: "prod", retries: "2", version: true },
	};
	// Defaulted flags/args remain optional in pre-parse input, even when
	// declared `required: true` — the default satisfies requiredness at parse time.
	const withoutDefault: DeployInput = { args: { target: "prod" }, flags: { mode: "dev" } };

	// @ts-expect-error -- required positional argument is missing
	const missingArg: DeployInput = { flags: { mode: "dev" } };
	const unknownArg: DeployInput = {
		// @ts-expect-error -- unknown argument name
		args: { target: "prod", host: "localhost" },
		flags: { mode: "dev" },
	};
	// @ts-expect-error -- choices remain a literal union
	const invalidChoice: DeployInput = { args: { target: "prod" }, flags: { mode: "staging" } };
	const invalidNegation: DeployInput = {
		args: { target: "prod" },
		// @ts-expect-error -- noNegate booleans accept only true
		flags: { mode: "dev", version: false },
	};
	function typecheckRunInput() {
		// @ts-expect-error -- the structural JSON overload does not bypass required arguments
		void app.run(["release-now", "deploy"] as const, { flags: { mode: "dev" } });
		void app.run(["release-now", "deploy"], {
			args: { target: "prod" },
			// @ts-expect-error -- the structural JSON overload preserves non-JSON literal contracts
			flags: { mode: "staging" },
		});
	}
	void [valid, withoutDefault, missingArg, unknownArg, invalidChoice, invalidNegation];
	void typecheckRunInput;
}

// widens paths past the 15-level depth cap instead of failing the checker
function _typecheckWidensPathsPastThe15LevelDepthCapInsteadOfFailingTheChecker() {
	type Nest<Depth extends number, Acc extends readonly unknown[] = []> = Acc["length"] extends Depth
		? { args: []; flags: {}; children: {}; result: void }
		: {
				args: [];
				flags: {};
				children: { next: Nest<Depth, readonly [...Acc, unknown]> };
				result: void;
			};
	type DeepTree = { root: Nest<16> };
	type Paths = CommandPath<DeepTree>;
	// Below the cap, paths stay exact; at the cap the tail widens to strings
	// so deep-but-valid applications keep compiling (TS2589 escape hatch).
	type _exactShallow = Expect<readonly ["root", "next"] extends Paths ? true : false>;
	type _rejectsShallowTypo = Expect<
		Equal<readonly ["root", "nope"] extends Paths ? true : false, false>
	>;
	// Segment 16 sits past the cap, so any string is accepted there.
	type _widenedDeep = Expect<
		readonly [...FifteenDeep, "not-a-command"] extends Paths ? true : false
	>;
}

// resolves action results for literal paths past the depth cap
function _typecheckResolvesActionResultsForLiteralPathsPastTheDepthCap() {
	type Nest<Depth extends number, Acc extends readonly unknown[] = []> = Acc["length"] extends Depth
		? { args: []; flags: {}; children: {}; result: "deep-result" }
		: {
				args: [];
				flags: {};
				children: { next: Nest<Depth, readonly [...Acc, unknown]> };
				result: "mid";
			};
	type DeepTree = { root: Nest<16> };
	type Root = { args: []; flags: {}; children: DeepTree; result: "root-result" };
	// The depth-15 cap only widens the CommandPath constraint; `const Path` still
	// infers the literal tuple, and CommandShapeAt (uncapped) resolves it fully.
	type SeventeenDeep = readonly [...FifteenDeep, "next", "next"];
	type _deepResult = Expect<Equal<CommandShapeAt<Root, SeventeenDeep>["result"], "deep-result">>;
	// A path variable widened past the cap cannot name its command statically,
	// so the shape (and its result) widens to unknown instead of an ancestor's.
	type _widenedResult = Expect<
		Equal<CommandShapeAt<Root, readonly ["root", ...string[]]>["result"], unknown>
	>;
	// A CommandPath<Tree>-typed variable (union of literal tuples and widened
	// arrays) never resolves to never, and a widened head widens instead.
	type _pathVariable = CommandShapeAt<Root, CommandPath<DeepTree>>["result"];
	type _pathVariableSound = Expect<Equal<[_pathVariable] extends [never] ? true : false, false>>;
	type _widenedHead = Expect<
		Equal<CommandShapeAt<Root, readonly [string, ...string[]]>["result"], unknown>
	>;
}

// explicit cached shapes cannot replace or narrow the selected command's contract
function _typecheckRejectsSubstitutedRunShapes() {
	const app = new Crust("cli").add(
		defineCommand("build", (command) =>
			command.flags({ count: { type: "number", required: true } }).action(() => 123),
		),
	);
	type Path = readonly ["build"];
	type Shape = CommandShapeAt<(typeof app)["_types"]["shape"], Path>;
	type Fake = Omit<Shape, "result"> & { result: "fake" };
	type Empty = { args: []; flags: {}; children: {}; result: number };
	type Narrow = Shape & { result: 123 };
	type Extra = Shape & { flags: { extra: { type: "string" } } };

	// @ts-expect-error -- the action does not return the substituted result type
	void app.run<Path, Fake>(["build"], { flags: { count: 1 } });
	// @ts-expect-error -- an explicit shape cannot remove required flags
	void app.run<Path, Empty>(["build"], {});
	// @ts-expect-error -- a subtype cannot narrow the action result
	void app.run<Path, Narrow>(["build"], { flags: { count: 1 } });
	// @ts-expect-error -- a subtype cannot add undeclared flags
	void app.run<Path, Extra>(["build"], { flags: { count: 1, extra: "value" } });

	const inferred = app.run(["build"], { flags: { count: 1 } });
	const pathOnly = app.run<Path>(["build"], { flags: { count: 1 } });
	const explicit = app.run<Path, Shape>(["build"], { flags: { count: 1 } });
	type _inferred = Expect<Equal<Awaited<typeof inferred>, RunOutcome<number>>>;
	type _pathOnly = Expect<Equal<Awaited<typeof pathOnly>, RunOutcome<number>>>;
	type _explicit = Expect<Equal<Awaited<typeof explicit>, RunOutcome<number>>>;
}

// binds valid paths on apps with ~1,000 commands without TS2590 (failed from ~600 path members)
function _typecheckBindsValidPathsOnLargeAppsWithoutTS2590() {
	type Digit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
	type Leaf = { args: []; flags: {}; children: {}; result: "leaf" };
	type LargeTree = { [K in `command-${Digit}${Digit}${Digit}`]: Leaf } & {
		group: {
			args: [];
			flags: { mode: { type: "string"; required: true } };
			children: { add: Leaf };
			result: void;
		};
	};
	const app = {} as Crust<{}, [], {}, never, never, LargeTree>;

	const handle = app.at(["command-071"]);
	type _handleResult = Expect<Equal<Awaited<ReturnType<typeof handle.run>>, RunOutcome<"leaf">>>;
	void app.at(["group", "add"]);
	void app.run(["command-999"]);
	void app.run(["group"], { flags: { mode: "fast" } });
	// @ts-expect-error -- unknown path
	void app.at(["command-1000"]);
	// @ts-expect-error -- unknown subcommand under a valid prefix
	void app.run(["group", "nope"], { flags: { mode: "fast" } });

	type PathAt<Path extends readonly string[]> = Parameters<typeof app.at<Path>>[0];
	type _nested = Expect<
		Equal<PathAt<readonly ["group", ""]>, readonly ["group"] | readonly ["group", "add"]>
	>;
}

// suggests continuations under an invalid segment of a tree deeper than the depth cap
function _typecheckSuggestsContinuationsInTreesDeeperThanTheDepthCap() {
	type Nest<Depth extends number, Acc extends readonly unknown[] = []> = Acc["length"] extends Depth
		? { args: []; flags: {}; children: {}; result: void }
		: {
				args: [];
				flags: {};
				children: { next: Nest<Depth, readonly [...Acc, unknown]> };
				result: void;
			};
	const app = {} as Crust<{}, [], {}, never, never, { root: Nest<30> }>;

	// @ts-expect-error -- a typo below the cap is still rejected
	void app.at(["root", "next", "nope"]);

	type PathAt<Path extends readonly string[]> = Parameters<typeof app.at<Path>>[0];
	type SeventeenDeep = readonly [...FifteenDeep, "next", "next"];
	type _deepValid = Expect<Equal<PathAt<SeventeenDeep>, SeventeenDeep>>;
	type Continuations = PathAt<readonly ["root", "next", "nope"]>;
	type _keepsValidPrefix = Expect<
		readonly ["root", "next", "next"] extends Continuations ? true : false
	>;
	type _rejectsTypo = Expect<
		Equal<readonly ["root", "next", "nope"] extends Continuations ? true : false, false>
	>;
	type _noSiblingsOfPrefix = Expect<Equal<readonly [] extends Continuations ? true : false, false>>;
}

// narrows each sibling added by one variadic .add() to its own shape
function _typecheckNarrowsSiblingsAddedByOneVariadicAddToTheirOwnShapes() {
	const add = defineCommand("add", (command) =>
		command
			.args({ name: "name", type: "string", required: true })
			.action(({ args }) => ({ name: args.name })),
	);
	const list = defineCommand("list", (command) => command.action(() => ["origin"]));
	const app = new Crust("cli").add(defineCommand("remote", (command) => command.add(add, list)));

	type Shape = (typeof app)["_types"]["shape"];
	type _addResult = Expect<
		Equal<CommandShapeAt<Shape, readonly ["remote", "add"]>["result"], { name: string }>
	>;
	type _listResult = Expect<
		Equal<CommandShapeAt<Shape, readonly ["remote", "list"]>["result"], string[]>
	>;
	const addInput: RunInput<CommandShapeAt<Shape, readonly ["remote", "add"]>> = {
		args: { name: "origin" },
	};
	const listInput: RunInput<CommandShapeAt<Shape, readonly ["remote", "list"]>> = {
		// @ts-expect-error -- `list` declares no arguments
		args: { name: "origin" },
	};
	void addInput;
	void listInput;
}

// rejects unknown input keys held in variables, where excess-property checks do not apply
function _typecheckRejectsUnknownInputKeysHeldInVariables(cond: boolean) {
	const app = new Crust("cli").command("build", (command) =>
		command
			.args({ name: "entry", type: "string" })
			.flags({ minify: { type: "boolean" } })
			.action(() => {}),
	);
	const handle = app.at(["build"]);

	const unknownFlag = { flags: { minify: true, nope: 1 } };
	// @ts-expect-error -- an unknown flag beside a known one
	void app.run(["build"], unknownFlag);
	// @ts-expect-error -- the same input through a handle
	void handle.run(unknownFlag);

	const unknownArg = { args: { entry: "a", extra: "b" } };
	// @ts-expect-error -- an unknown argument beside a known one
	void app.run(["build"], unknownArg);

	const unknownKey = { flags: { minify: true }, bogus: 1 };
	// @ts-expect-error -- an unknown top-level input key
	void app.run(["build"], unknownKey);
	// @ts-expect-error -- the same input through a handle
	void handle.run(unknownKey);

	const valid = { args: { entry: "a" }, flags: { minify: true }, raw: ["--"] };
	void app.run(["build"], valid);
	void handle.run(valid, { stdout: () => {} });

	// Union inputs must not be rejected by closing only one member.
	for (const input of [{ flags: { minify: true } }, { args: { entry: "a" } }]) {
		void app.run(["build"], input);
		void handle.run(input);
	}
	void app.run(["build"], cond ? { flags: { minify: true } } : { args: { entry: "a" } });
	// @ts-expect-error -- a fresh union member keeps excess-property checks
	void app.run(["build"], cond ? { flags: { minify: true } } : { flags: { nope: 1 } });
}

// omits input sections a command does not define, so editors do not offer them
function _typecheckOmitsUndefinedInputSections() {
	const app = new Crust("cli")
		.command("build", (command) => command.flags({ minify: { type: "boolean" } }))
		.command("bare", (command) => command);
	type Shape = (typeof app)["_types"]["shape"];
	type _build = Expect<
		Equal<keyof RunInput<CommandShapeAt<Shape, readonly ["build"]>>, "flags" | "raw">
	>;
	type _bare = Expect<Equal<keyof RunInput<CommandShapeAt<Shape, readonly ["bare"]>>, "raw">>;

	// @ts-expect-error -- no args section
	void app.run(["build"], { args: {} });
	const withArgs = { args: { x: 1 }, flags: { minify: true } };
	// @ts-expect-error -- no args section, held in a variable
	void app.run(["build"], withArgs);
	// @ts-expect-error -- no args section, through a handle
	void app.at(["build"]).run(withArgs);
	// @ts-expect-error -- no flags section
	void app.run(["bare"], { flags: { minify: true } });
	void app.run(["bare"], { raw: ["--"] });
}

// keeps required input required whatever the input's inference
function _typecheckKeepsRequiredInputIndependentOfInference(
	maybeInput: { flags: { mode: string } } | undefined,
	maybeOptional: { flags: { minify: boolean } } | undefined,
) {
	const app = new Crust("app")
		.flags({ mode: { type: "string", required: true } })
		.action(({ flags }) => flags.mode);
	const handle = app.at([]);
	const run = handle.run;

	// @ts-expect-error -- omitted required input
	void app.run([]);
	// @ts-expect-error -- explicit undefined for required input
	void app.run([], undefined);
	// @ts-expect-error -- possibly undefined required input
	void app.run([], maybeInput);
	// @ts-expect-error -- explicit undefined with options
	void app.run([], undefined, { stdout: () => {} });
	// @ts-expect-error -- omitted through a handle
	void handle.run();
	// @ts-expect-error -- explicit undefined through a handle
	void handle.run(undefined);
	// @ts-expect-error -- possibly undefined through a handle
	void handle.run(maybeInput);
	// @ts-expect-error -- omitted through an extracted handle function
	void run();
	// @ts-expect-error -- explicit undefined through an extracted handle function
	void run(undefined);
	// Explicit path type arguments still accept valid input.
	void app.run<readonly []>([], { flags: { mode: "safe" } });
	void run({ flags: { mode: "safe" } });

	const optional = new Crust("opt").flags({ minify: { type: "boolean" } }).action(() => {});
	void optional.run([]);
	void optional.run([], undefined);
	void optional.run([], undefined, { stdout: () => {} });
	void optional.run([], maybeOptional);
	void optional.run<readonly []>([]);
	void optional.at([]).run(undefined);
	void optional.at([]).run(maybeOptional);
}
