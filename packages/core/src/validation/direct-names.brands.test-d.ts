import { defineArg, defineFlag } from "../api/flags.ts";
import { defineCommand } from "../command/crust.ts";

// Compile-time regression checks; intentionally never invoked.
// rejects statically known empty names at every direct definition API
function _typecheckRejectsStaticallyKnownEmptyNamesAtEveryDirectDefinitionAPI() {
	const command = defineCommand("valid", (builder) => builder);
	// @ts-expect-error -- flag names must be non-empty
	defineFlag("", { type: "string" });
	// @ts-expect-error -- argument names must be non-empty
	defineArg("", { type: "string" });
	// @ts-expect-error -- command names must be non-empty
	defineCommand("", (builder) => builder);
	// @ts-expect-error -- renamed command names must be non-empty
	command.as("");
}
