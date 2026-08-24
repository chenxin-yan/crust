import { describe, expect, it } from "bun:test";

import * as runtimeExports from "./runtimeExports.ts";
import { styleMethodNames } from "./styleMethodRegistry.ts";

describe("runtime exports", () => {
	it("exports every registered style method", () => {
		expect(styleMethodNames.filter((name) => !(name in runtimeExports))).toEqual([]);
	});
});
