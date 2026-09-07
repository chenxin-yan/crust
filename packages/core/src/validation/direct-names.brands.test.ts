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
