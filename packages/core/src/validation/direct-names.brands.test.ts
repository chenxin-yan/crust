import { describe, expect, it } from "bun:test";

import { defineArg, defineFlag } from "../api/flags.ts";
import { defineCommand } from "../command/crust.ts";

describe("direct definition name brands", () => {
	it("keeps generic wrappers and widened string names accepted", () => {
		function myFlag<Name extends string>(name: Name) {
			return defineFlag(name, { type: "string" });
		}
		function myArg<Name extends string>(name: Name) {
			return defineArg(name, { type: "string" });
		}
		function myCommand<Name extends string>(name: Name) {
			return defineCommand(name, (builder) => builder);
		}
		function renameCommand<Name extends string>(name: Name) {
			return myCommand("source").as(name);
		}

		const dynamicName = "dynamic" as string;
		// Direct widened calls take the eager indexed-access path, not the deferred generic one.
		expect(defineFlag(dynamicName, { type: "string" }).name).toBe("dynamic");
		expect(myFlag(dynamicName).name).toBe("dynamic");
		expect(myArg(dynamicName).name).toBe("dynamic");
		expect(myCommand(dynamicName).name).toBe("dynamic");
		expect(renameCommand(dynamicName).name).toBe("dynamic");
	});
});

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
