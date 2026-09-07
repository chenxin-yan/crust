import type { StandardSchema } from "@crustjs/utils/schema";

import type { Equal, Expect } from "../../tests/helpers.ts";
import { defineExtension } from "../api/extension.ts";
import { defineExtensionId } from "../identity.ts";
import {
	type CommandPath,
	type CommandShapeAt,
	type RunInput,
	Crust,
	defineCommand,
} from "./crust.ts";

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
	const trace = defineExtension(defineExtensionId("trace"), {
		flags: [{ name: "trace", type: "boolean" }],
	});
	const addedThenExtended = new Crust("cli").add(local).extend(trace);
	type LocalInput = RunInput<
		CommandShapeAt<(typeof addedThenExtended)["_types"]["shape"], readonly ["local"]>
	>;
	type _addedCommandFlags = Expect<Equal<NonNullable<LocalInput["flags"]>, { trace?: boolean }>>;

	const tools = defineExtension(defineExtensionId("tools"), {
		commands: [defineCommand("inspect", (command) => command.action(() => {}))],
	});
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
	const extFoo = defineExtension(defineExtensionId("extfoo"), {
		commands: [defineCommand("foo", (command) => command.action(() => "ext" as const))],
	});
	const appFoo = defineCommand("foo", (command) => command.action(() => 42 as const));

	// @ts-expect-error -- Extension command collides with an existing app command
	void new Crust("cli").add(appFoo).extend(extFoo);
	// @ts-expect-error -- added command collides with a registered Extension command
	void new Crust("cli").extend(extFoo).add(appFoo);
	const otherFoo = defineExtension(defineExtensionId("other"), {
		commands: [defineCommand("foo", (command) => command.action(() => {}))],
	});
	// @ts-expect-error -- Extensions in the same call must not collide
	void new Crust("cli").extend(extFoo, otherFoo);
}

// keeps conditionally assembled Extension contributions runtime-only
function _typecheckKeepsConditionallyAssembledExtensionContributionsRuntimeOnly() {
	const foo = defineCommand("foo", (command) => command.action(() => {}));
	const bar = defineCommand("bar", (command) => command.action(() => {}));
	const condition = (globalThis as { __never?: boolean }).__never === true;
	const conditional = defineExtension(defineExtensionId("conditional"), {
		commands: condition ? [foo] : [bar],
		flags: condition
			? [{ name: "fa", type: "boolean" as const }]
			: [{ name: "fb", type: "boolean" as const }],
	});
	const app = new Crust("cli").action(() => {}).extend(conditional);
	const elementConditional = defineExtension(defineExtensionId("element"), {
		commands: [condition ? foo : bar],
	});
	const elementApp = new Crust("cli").extend(elementConditional);

	// @ts-expect-error -- only one branch of a conditional commands array is installed
	void app.run(["foo"]);
	// @ts-expect-error -- only one branch of a conditional flags array is installed
	void app.run([], { flags: { fa: true } });
	// @ts-expect-error -- a union-typed tuple member is not a guaranteed path
	void elementApp.run(["foo"]);
}

// keeps dynamically assembled Extensions and contribution arrays runtime-only
function _typecheckKeepsDynamicallyAssembledExtensionsAndContributionArraysRuntimeOnly() {
	const foo = defineCommand("foo", (command) => command.action(() => "foo" as const));
	const bar = defineCommand("bar", (command) => command.action(() => "bar" as const));
	const condition = (globalThis as { __never?: boolean }).__never === true;

	// Homogeneous variable-length contribution arrays may be empty at runtime.
	const homoCommands: (typeof foo)[] = condition ? [foo] : [];
	const homoExt = defineExtension(defineExtensionId("homo"), { commands: homoCommands });
	const homoApp = new Crust("cli").extend(homoExt);

	// A conditionally selected Extension installs only one branch.
	const extFoo = defineExtension(defineExtensionId("extfoo"), { commands: [foo] });
	const extBar = defineExtension(defineExtensionId("extbar"), { commands: [bar] });
	const unionApp = new Crust("cli").extend(condition ? extFoo : extBar);
	const bothApp = new Crust("cli").extend(extFoo, extBar);

	// A variable-length Extension list may install nothing.
	const extensionList: (typeof extFoo)[] = condition ? [extFoo] : [];
	const spreadApp = new Crust("cli").extend(...extensionList);

	// @ts-expect-error -- a variable-length commands array is runtime-only
	void homoApp.run(["foo"]);
	// @ts-expect-error -- a conditionally selected Extension is runtime-only
	void unionApp.run(["foo"]);
	// @ts-expect-error -- a conditionally selected Extension is runtime-only
	void unionApp.run(["bar"]);
	// Separate static Extensions in one call still publish both paths.
	void bothApp.run(["foo"]);
	void bothApp.run(["bar"]);
	// @ts-expect-error -- a variable-length Extension list is runtime-only
	void spreadApp.run(["foo"]);
	// A runtime-only list must not pollute sibling spellings for later adds.
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

	// @ts-expect-error -- duplicate canonical names resolve last-write-wins at prepare
	void defineExtension(defineExtensionId("dup"), { commands: [foo, fooDup] });
	// @ts-expect-error -- a shared alias would union both shapes under one path
	void defineExtension(defineExtensionId("alias"), { commands: [aliasA, aliasB] });
	// Distinct spellings pass.
	void defineExtension(defineExtensionId("ok"), { commands: [foo, aliasA] });
}

// rejects Extension flags colliding with contributed command flags
function _typecheckRejectsExtensionFlagsCollidingWithContributedCommandFlags() {
	const scan = defineCommand("scan", (command) =>
		command.flags({ name: "trace", type: "boolean" }).action(() => {}),
	);
	const extension = defineExtension(defineExtensionId("tracing"), {
		flags: [{ name: "trace", type: "string" as const }],
		commands: [scan],
	});
	const clean = defineExtension(defineExtensionId("clean"), {
		flags: [{ name: "other", type: "string" as const }],
		commands: [scan],
	});

	// @ts-expect-error -- prepare injects the flag into the contributed command and throws
	void new Crust("cli").extend(extension);
	// Disjoint spellings pass.
	void new Crust("cli").extend(clean);
}

// keeps widened recursive flag scopes off descendant typed inputs
function _typecheckKeepsWidenedRecursiveFlagScopesOffDescendantTypedInputs() {
	const dynamicScope = (globalThis as { __never?: boolean }).__never === true;
	const scoped = defineExtension(defineExtensionId("scoped"), {
		flags: [{ name: "trace", type: "boolean", recursive: dynamicScope }],
	});
	const child = defineCommand("child", (command) => command.action(() => {}));
	const app = new Crust("cli")
		.action(() => {})
		.extend(scoped)
		.add(child);

	// The flag is always installed on the root, so the root input keeps it.
	void app.run([], { flags: { trace: true } });
	// @ts-expect-error -- a runtime-false scope installs the flag on the root only
	void app.run(["child"], { flags: { trace: true } });
}

// accepts structurally JSON-compatible named interfaces
function _typecheckAcceptsStructurallyJSONCompatibleNamedInterfaces() {
	const app = new Crust("cli").flags({ name: "config", type: "json" }).action(() => {});
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
			.flags(
				{ name: "mode", type: "string", choices: ["dev", "prod"], required: true },
				{ name: "retries", type: "string", parse: Number },
				{ name: "color", type: "boolean", default: true },
				{ name: "env", type: "string", required: true, default: "prod" },
				{ name: "version", type: "boolean", noNegate: true },
			)
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

// keeps wide command trees tractable for the checker
function _typecheckKeepsWideCommandTreesTractableForTheChecker() {
	type Index =
		| 1
		| 2
		| 3
		| 4
		| 5
		| 6
		| 7
		| 8
		| 9
		| 10
		| 11
		| 12
		| 13
		| 14
		| 15
		| 16
		| 17
		| 18
		| 19
		| 20
		| 21
		| 22
		| 23
		| 24
		| 25
		| 26
		| 27
		| 28
		| 29
		| 30;
	type WideTree = {
		[K in `command-${Index}`]: { args: []; flags: {}; children: {}; result: void };
	};
	type Paths = CommandPath<WideTree>;
	type _includesLast = Expect<readonly ["command-30"] extends Paths ? true : false>;
	type _rejectsUnknown = Expect<Equal<readonly ["command-31"] extends Paths ? true : false, false>>;
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
