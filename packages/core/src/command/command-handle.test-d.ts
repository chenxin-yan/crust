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
