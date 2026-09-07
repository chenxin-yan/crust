import { Crust, defineCommand } from "@crustjs/core";

import { captureRun, runInteractive } from "./index.ts";

// Compile-time regression checks; intentionally never invoked.
// preserves command, argument, and flag types from the application
function _typecheckPreservesCommandArgumentAndFlagTypesFromTheApplication() {
	const deploy = defineCommand("deploy", (command) =>
		command
			.args({ name: "target", type: "string", required: true })
			.flags({ name: "force", type: "boolean" })
			.action(() => {}),
	);
	const app = new Crust("cli").add(deploy);

	void captureRun(app, ["deploy"], { args: { target: "prod" }, flags: { force: true } });
	void runInteractive(app, ["deploy"], { args: { target: "prod" } });
	// @ts-expect-error -- command paths come from the application tree
	void captureRun(app, ["deply"], { args: { target: "prod" } });
	// @ts-expect-error -- required arguments remain required through the harness
	void captureRun(app, ["deploy"]);
	// @ts-expect-error -- flags come from the selected command
	void runInteractive(app, ["deploy"], { args: { target: "prod" }, flags: { froce: true } });
}
