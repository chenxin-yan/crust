import { Crust, defineCommand } from "@crustjs/core";

import { completion } from "./index.ts";

function host() {
	const deploy = defineCommand("deploy", (command) =>
		command.flags({ force: { type: "boolean" } }).action(() => {}),
	);
	return new Crust("cli", { version: "1.0.0" }).add(deploy);
}

// Compile-time regression checks; intentionally never invoked.
// `complete` is typed on arguments and flags and never reaches the action's values
function _typecheckCompleteKey() {
	defineCommand("deploy", (command) =>
		command
			.args({ name: "service", type: "string", complete: async (typed) => [`${typed}-api`] })
			.flags({ region: { type: "string", complete: (typed) => [typed] } })
			.action(({ args, flags }) => {
				const service: string | undefined = args.service;
				const region: string | undefined = flags.region;
				// @ts-expect-error -- the key never reaches the action's flags
				void flags.complete;
				return [service, region];
			}),
	);
	// @ts-expect-error -- a completer returns strings
	defineCommand("bad", (command) => command.flags({ x: { type: "string", complete: () => [1] } }));
}

// the default `completion` command keeps the host's command tree closed
function _typecheckDefaultNameKeepsHostTreeClosed() {
	const app = host().extend(completion());

	void app.run(["deploy"], { flags: { force: true } });
	void app.run(["completion"], { args: { shell: "zsh" } });
	void app.run(["completion"], { args: { shell: "bash" }, flags: { "output-dir": "out" } });
	// @ts-expect-error -- unknown command paths stay rejected after extend()
	void app.run(["deplyo"]);
	// @ts-expect-error -- unknown flags on host commands stay rejected
	void app.run(["deploy"], { flags: { forse: true } });
	// @ts-expect-error -- the contributed command keeps its shell choices
	void app.run(["completion"], { args: { shell: "nushell" } });
}

// a literal `command` option renames the contributed command without opening the tree
function _typecheckLiteralNameKeepsHostTreeClosed() {
	const app = host().extend(completion({ command: "completions" }));

	void app.run(["completions"], { args: { shell: "fish" } });
	// @ts-expect-error -- the default name is not contributed when renamed
	void app.run(["completion"], { args: { shell: "fish" } });
	// @ts-expect-error -- unknown command paths stay rejected after extend()
	void app.run(["deplyo"]);
	// @ts-expect-error -- unknown flags on host commands stay rejected
	void app.run(["deploy"], { flags: { forse: true } });
}

// a dynamic `command` name cannot be known statically, so the tree stays open
function _typecheckDynamicNameOpensTree(command: string) {
	const app = host().extend(completion({ command }));

	void app.run([command]);
	void app.run(["deploy"], { flags: { force: true } });
}

// the name stays `completion` unless a `command` is guaranteed present
function _typecheckOmittedNameKeepsDefault(options: { command?: "completions" }) {
	const app = host().extend(completion({ command: undefined }));
	void app.run(["completion"], { args: { shell: "zsh" } });
	// @ts-expect-error -- an explicit name argument cannot rename the runtime default
	completion<"completions">();
	// An optional literal may be absent at runtime, so the tree stays open.
	void host().extend(completion(options)).run(["completion"]);
}

// scripts embed a version, so like version() the root needs one unless completion() gets it
function _typecheckVersionRequirement(maybe: string | undefined, options: { version?: string }) {
	// @ts-expect-error -- no root version and no explicit version
	new Crust("cli").extend(completion());
	// @ts-expect-error -- a renamed command still needs a version
	new Crust("cli").extend(completion({ command: "completions" }));
	// @ts-expect-error -- a possibly absent version is not enough
	new Crust("cli").extend(completion({ version: maybe }));
	// @ts-expect-error -- neither is an optional one
	new Crust("cli").extend(completion(options));

	new Crust("cli", { version: "1.0.0" }).extend(completion());
	new Crust("cli", { version: "1.0.0" }).extend(completion({ version: maybe }));
	new Crust("cli").extend(completion({ version: "1.0.0" }));
	const renamed = new Crust("cli").extend(completion({ command: "completions", version: "1.0.0" }));
	void renamed.run(["completions"], { args: { shell: "bash" } });
	// @ts-expect-error -- the explicit-version overload keeps the renamed tree closed
	void renamed.run(["completion"], { args: { shell: "bash" } });
}
