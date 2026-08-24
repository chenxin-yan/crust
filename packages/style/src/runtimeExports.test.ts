import { describe, expect, it } from "bun:test";

import { styleMethodNames } from "./ansiCodes.ts";
import * as runtimeExports from "./runtimeExports.ts";

describe("runtime exports", () => {
	it("exports every registered style method", () => {
		expect(styleMethodNames.filter((name) => !(name in runtimeExports))).toEqual([]);
	});
});
