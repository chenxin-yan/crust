import { describe, expect, it } from "vite-plus/test";

import { styleMethodNames } from "./ansi-codes.ts";
import * as runtimeExports from "./runtime-exports.ts";

describe("runtime exports", () => {
	it("exports every registered style method", () => {
		expect(styleMethodNames.filter((name) => !(name in runtimeExports))).toEqual([]);
	});
});
