import { Crust, defineCommand } from "@crustjs/core";

import { fuzzRoundTrip, type FuzzRoundTripReport } from "./fuzz.ts";

// Compile-time regression checks; intentionally never invoked.
function _typecheckPathsComeFromTheApplication() {
	const deploy = defineCommand("deploy", { aliases: ["ship"] }, (command) =>
		command.args({ name: "target", type: "string", required: true }).action(() => {}),
	);
	const app = new Crust("cli").add(deploy);
	const recipe = defineCommand("inert", (command) => command.action(() => {}));

	const report: Promise<FuzzRoundTripReport> = fuzzRoundTrip(app, ["deploy"]);
	void report;
	void fuzzRoundTrip(app, [], { runs: 10, seed: 1, env: {} });
	// @ts-expect-error -- command paths come from the application tree
	void fuzzRoundTrip(app, ["deply"]);
	// @ts-expect-error -- an inert command definition is not an application
	void fuzzRoundTrip(recipe, []);
	// @ts-expect-error -- options are the documented set only
	void fuzzRoundTrip(app, [], { iterations: 10 });
}
