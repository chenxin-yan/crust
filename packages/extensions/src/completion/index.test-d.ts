import { Crust, defineCommand } from "@crustjs/core";
import { runInteractive } from "@crustjs/testing/interactive";

import { completion } from "./index.ts";

function host() {
	const deploy = defineCommand("deploy", (command) =>
		command.flags({ name: "force", type: "boolean" }).action(() => {}),
	);
	return new Crust("cli", { version: "1.0.0" }).add(deploy);
}

// Compile-time regression checks; intentionally never invoked.
// the default `completion` command keeps the host's command tree closed
function _typecheckDefaultNameKeepsHostTreeClosed() {
	const app = host().extend(completion());

	void app.run(["deploy"], { flags: { force: true } });
	void app.run(["completion"], { args: { shell: "zsh" } });
	void app.run(["completion"], { args: { shell: "bash" }, flags: { "output-dir": "out" } });
	void runInteractive(app, ["deploy"]);
	// @ts-expect-error -- unknown command paths stay rejected after extend()
	void app.run(["deplyo"]);
	// @ts-expect-error -- unknown flags on host commands stay rejected
	void app.run(["deploy"], { flags: { forse: true } });
	// @ts-expect-error -- the contributed command keeps its shell choices
	void app.run(["completion"], { args: { shell: "powershell" } });
	// @ts-expect-error -- the harness reads the same closed tree
	void runInteractive(app, ["deplyo"]);
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
