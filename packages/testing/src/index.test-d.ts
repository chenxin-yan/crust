import { Crust, defineCommand } from "@crustjs/core";

import { runInteractive } from "./index.ts";

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

	void app.run(["deploy"], { args: { target: "prod" }, flags: { force: true } });
	void runInteractive(app, ["deploy"], { args: { target: "prod" } });
	// @ts-expect-error -- command paths come from the application tree
	void runInteractive(app, ["deply"], { args: { target: "prod" } });
	// @ts-expect-error -- required arguments remain required through the harness
	void runInteractive(app, ["deploy"]);
	// @ts-expect-error -- flags come from the selected command
	void runInteractive(app, ["deploy"], { args: { target: "prod" }, flags: { froce: true } });
}

function _typecheckStrictInteractiveChoices(mode: string) {
	const app = new Crust("cli").flags({
		name: "mode",
		type: "string",
		choices: ["safe", "fast"],
		required: true,
	});
	void runInteractive(app, [], { flags: { mode: "safe" } });
	if (mode === "safe" || mode === "fast") void runInteractive(app, [], { flags: { mode } });
	// @ts-expect-error -- a broad string is not validated by an assertion or generic inference
	void runInteractive(app, [], { flags: { mode } });
	// @ts-expect-error -- choice literals stay strict through the generic helper
	void runInteractive(app, [], { flags: { mode: "slow" } });
	// @ts-expect-error -- wrong primitives cannot infer a permissive AnyCrust fallback
	void runInteractive(app, [], { flags: { mode: 1 } });
	// @ts-expect-error -- extra typo beside the otherwise valid required field
	void runInteractive(app, [], { flags: { mode: "safe", mdoe: "safe" } });
	// @ts-expect-error -- required input stays required
	void runInteractive(app, []);
	// @ts-expect-error -- unknown paths cannot infer a permissive AnyCrust fallback
	void runInteractive(app, ["missing"], { flags: { mode: "safe" } });
}
