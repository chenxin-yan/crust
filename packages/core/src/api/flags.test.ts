import { describe, it } from "bun:test";

import { defineFlag, defineFlags } from "./flags.ts";

type Assert<T extends true> = T;
type IsEqual<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

describe("defineFlag / defineFlags", () => {
	it("preserves literal flag definitions", () => {
		const verbose = defineFlag({ type: "boolean", inherit: true, short: "v" });
		type _Flag = Assert<
			IsEqual<
				typeof verbose,
				{ readonly type: "boolean"; readonly inherit: true; readonly short: "v" }
			>
		>;

		const flags = defineFlags({ verbose, output: { type: "string", short: "o" } });
		type _Flags = Assert<
			IsEqual<
				typeof flags,
				{
					readonly verbose: typeof verbose;
					readonly output: { readonly type: "string"; readonly short: "o" };
				}
			>
		>;

		// @ts-expect-error -- boolean flags cannot have string defaults
		defineFlag({ type: "boolean", default: "true" });
		// @ts-expect-error -- every definition must be a FlagDef
		defineFlags({ bad: { type: "not-a-flag" } });
	});
});
