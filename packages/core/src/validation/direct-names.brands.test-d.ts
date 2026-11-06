import { defineArg } from "../api/flags.ts";
import { Crust, defineCommand } from "../command/crust.ts";

// Compile-time regression checks; intentionally never invoked.
// rejects statically known empty names where each definition is consumed
function _typecheckRejectsStaticallyKnownEmptyNamesWhereEachDefinitionIsConsumed() {
	const app = new Crust("root");
	const command = defineCommand("valid", (builder) => builder);
	// @ts-expect-error -- argument names must be non-empty
	defineArg("", { type: "string" });
	// @ts-expect-error -- command names must be non-empty
	app.add(defineCommand("", (builder) => builder));
	// @ts-expect-error -- renamed command names must be non-empty
	app.add(command.as(""));
}
