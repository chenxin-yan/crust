import { Crust, defineCommand } from "@crustjs/core";
import { runInteractive } from "@crustjs/testing/interactive";

import { skill } from "./extension.ts";

function host() {
	const deploy = defineCommand("deploy", (command) =>
		command.flags({ name: "force", type: "boolean" }).action(() => {}),
	);
	return new Crust("cli").add(deploy);
}

// Compile-time regression checks; intentionally never invoked.
// the default `skills` command keeps the host's command tree closed
function _typecheckDefaultNameKeepsHostTreeClosed() {
	const app = host().extend(skill({}));

	void app.run(["deploy"], { flags: { force: true } });
	void app.run(["skills"], { flags: { scope: "project", all: true } });
	void app.run(["skill", "uninstall"], { flags: { all: true } });
	void app.run(["skills", "repair"], { flags: { scope: "global" } });
	void runInteractive(app, ["deploy"]);
	// @ts-expect-error -- unknown command paths stay rejected after extend()
	void app.run(["deplyo"]);
	// @ts-expect-error -- unknown flags on host commands stay rejected
	void app.run(["deploy"], { flags: { forse: true } });
	// @ts-expect-error -- the contributed command keeps its scope choices
	void app.run(["skills"], { flags: { scope: "user" } });
	// @ts-expect-error -- `repair` declares no `--all`
	void app.run(["skills", "repair"], { flags: { all: true } });
	// @ts-expect-error -- the harness reads the same closed tree
	void runInteractive(app, ["deplyo"]);
}

// a literal `command` option renames the contributed command without opening the tree
function _typecheckLiteralNameKeepsHostTreeClosed() {
	const app = host().extend(skill({ command: "agents" }));

	void app.run(["agents", "install"], { flags: { all: true } });
	// @ts-expect-error -- the `skill` alias belongs to the default name only
	void app.run(["skill"]);
	// @ts-expect-error -- unknown command paths stay rejected after extend()
	void app.run(["deplyo"]);
	// @ts-expect-error -- unknown flags on host commands stay rejected
	void app.run(["deploy"], { flags: { forse: true } });
}

// a dynamic `command` name cannot be known statically, so the tree stays open
function _typecheckDynamicNameOpensTree(command: string) {
	const app = host().extend(skill({ command }));

	void app.run([command]);
	void app.run(["deploy"], { flags: { force: true } });
}
