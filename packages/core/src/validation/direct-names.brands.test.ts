import { describe, expect, it } from "bun:test";

import { defineArg, defineFlag } from "../api/flags.ts";
import { defineCommand } from "../command/crust.ts";

describe("direct definition name brands", () => {
	it("checks dynamic command names", () => {
		function myFlag(name: string) {
			return defineFlag(name, { type: "string" });
		}
		function myArg(name: string) {
			return defineArg(name, { type: "string" });
		}
		function myCommand(name: string) {
			return defineCommand(name, (builder) => builder);
		}
		function renameCommand(name: string) {
			return myCommand("source").as(name);
		}

		const dynamicName = "dynamic" as string;
		// Broad string names are checked at each consuming operation.
		expect(defineFlag(dynamicName, { type: "string" }).name).toBe("dynamic");
		expect(myFlag(dynamicName).name).toBe("dynamic");
		expect(myArg(dynamicName).name).toBe("dynamic");
		expect(myCommand(dynamicName).name).toBe("dynamic");
		expect(renameCommand(dynamicName).name).toBe("dynamic");
	});
});
