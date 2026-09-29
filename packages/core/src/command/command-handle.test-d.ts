import type { Equal, Expect } from "../../tests/helpers.ts";
import {
	type CommandHandle,
	type CommandShapeAt,
	type RunOutcome,
	Crust,
	defineCommand,
} from "./crust.ts";

// Compile-time regression checks; intentionally never invoked.
// binds the selected command shape into a path-free typed invoker
function _typecheckBindsTheSelectedCommandShapeIntoAPathFreeTypedInvoker() {
	const add = defineCommand("add", (command) =>
		command
			.args({ name: "name", type: "string", required: true })
			.flags(
				{ name: "fetch", type: "boolean" },
				{ name: "mode", type: "string", choices: ["a", "b"] },
			)
			.action(({ args }) => ({ remote: args.name })),
	);
	const remote = defineCommand("remote", (command) => command.add(add));
	const app = new Crust("git").action(() => "root" as const).add(remote);

	const remoteAdd = app.at(["remote", "add"]);
	type _shape = Expect<
		Equal<
			typeof remoteAdd,
			CommandHandle<CommandShapeAt<(typeof app)["_types"]["shape"], readonly ["remote", "add"]>>
		>
	>;
	type _path = Expect<Equal<typeof remoteAdd.path, readonly string[]>>;

	const result = remoteAdd.run({ args: { name: "origin" }, flags: { fetch: true } });
	type _result = Expect<Equal<typeof result, Promise<RunOutcome<{ remote: string }>>>>;

	const root = app.at([]);
	type _root = Expect<Equal<ReturnType<typeof root.run>, Promise<RunOutcome<"root">>>>;
	void root.run();
	void root.run({}, { stdout: () => {} });

	// @ts-expect-error -- required positional argument is missing
	void remoteAdd.run({ flags: { fetch: true } });
	// @ts-expect-error -- flag type mismatch
	void remoteAdd.run({ args: { name: "origin" }, flags: { fetch: "yes" } });
	// @ts-expect-error -- choices remain a literal union
	void remoteAdd.run({ args: { name: "origin" }, flags: { mode: "c" } });
	// @ts-expect-error -- unknown flag
	void remoteAdd.run({ args: { name: "origin" }, flags: { bogus: true } });
	// @ts-expect-error -- unknown command path
	void app.at(["remote", "missing"]);
	// @ts-expect-error -- handles do not narrow further
	void remoteAdd.at;
	// @ts-expect-error -- at() requires an app builder, not a command definition
	void add.at;

	void result;
}

// Editors complete path elements from the parameter instantiated with the partial literal
function _typecheckPartialPathsResolveToTheirValidContinuations() {
	const remote = defineCommand("remote", (command) =>
		command.add(defineCommand("add", (child) => child.action(() => {}))),
	);
	const app = new Crust("git").add(defineCommand("status", (c) => c)).add(remote);

	type PathAt<Path extends readonly string[]> = Parameters<typeof app.at<Path>>[0];
	type All = readonly [] | readonly ["status"] | readonly ["remote"] | readonly ["remote", "add"];
	type _root = Expect<Equal<PathAt<readonly [""]>, All>>;
	type _nested = Expect<
		Equal<PathAt<readonly ["remote", ""]>, readonly ["remote"] | readonly ["remote", "add"]>
	>;
	// A leaf has no continuations, so nothing is suggested past it.
	type _leaf = Expect<Equal<PathAt<readonly ["status", ""]>, readonly ["status"]>>;
	type _valid = Expect<Equal<PathAt<readonly ["remote", "add"]>, readonly ["remote", "add"]>>;
	// Signature help before any argument is typed falls back to the constraint.
	type _uninferred = Expect<Equal<PathAt<readonly string[]>, All>>;
	type _run = Expect<
		Equal<Parameters<typeof app.run<readonly ["status", ""]>>[0], readonly ["status"]>
	>;
}
