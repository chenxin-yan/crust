import { describe, expect, it } from "bun:test";

import { defineArg, defineFlag } from "../api/flags.ts";
import { defineCommand } from "../command/crust.ts";
import { runtime } from "../runtime.ts";

describe("direct definition name brands", () => {
	it("checks generic command names while preserving inferred names", () => {
		function myFlag<Name extends string>(name: Name) {
			return defineFlag(runtime(name), { type: "string" });
		}
		function myArg<Name extends string>(name: Name) {
			return defineArg(runtime(name), { type: "string" });
		}
		function myCommand<Name extends string>(name: Name) {
			return defineCommand(runtime(name), (builder) => builder);
		}
		function renameCommand<Name extends string>(name: Name) {
			return myCommand("source").as(runtime(name));
		}

		const dynamicName = "dynamic" as string;
		// Both widened and generic names cross the same checked boundary.
		expect(defineFlag(runtime(dynamicName), { type: "string" }).name).toBe("dynamic");
		expect(myFlag(dynamicName).name).toBe("dynamic");
		expect(myArg(dynamicName).name).toBe("dynamic");
		expect(myCommand(dynamicName).name).toBe("dynamic");
		expect(renameCommand(dynamicName).name).toBe("dynamic");
	});
});
