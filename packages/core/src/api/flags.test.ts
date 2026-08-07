import { describe, expect, it } from "bun:test";

import { Crust } from "../command/crust.ts";
import { defineArg, defineFlag } from "./flags.ts";

type Assert<T extends true> = T;
type IsEqual<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

describe("defineFlag", () => {
	it("returns the named definition with literal types preserved", () => {
		const verbose = defineFlag("verbose", { type: "boolean", short: "v" });

		expect(verbose).toEqual({ name: "verbose", type: "boolean", short: "v" });
		type _Flag = Assert<
			IsEqual<
				typeof verbose,
				{
					readonly name: "verbose";
					readonly type: "boolean";
					readonly short: "v";
				}
			>
		>;

		// @ts-expect-error -- boolean flags cannot have string defaults
		defineFlag("bad", { type: "boolean", default: "true" });
		// @ts-expect-error -- every definition must be a FlagDef
		defineFlag("bad", { type: "not-a-flag" });
	});

	it("feeds .flags() with the same record typing as an inline literal", () => {
		const verbose = defineFlag("verbose", { type: "boolean" });
		const app = new Crust("cli").flags(verbose, { name: "output", type: "string", short: "o" });

		type Local = (typeof app)["_types"]["local"];
		type _Verbose = Assert<IsEqual<Local["verbose"], { readonly type: "boolean" }>>;
		type _Output = Assert<
			IsEqual<Local["output"], { readonly type: "string"; readonly short: "o" }>
		>;
		expect(app._node.localFlags).toEqual({
			verbose: { type: "boolean" },
			output: { type: "string", short: "o" },
		});
	});

	it("brands invalid definitions on the offending variadic argument", () => {
		new Crust("cli").flags(
			// @ts-expect-error -- alias collision: short "f" is claimed twice (brands both defs)
			{ name: "force", type: "boolean", short: "f" },
			{ name: "format", type: "string", short: "f" },
		);
		// @ts-expect-error -- "no-" prefixed names are reserved for boolean negation
		new Crust("cli").flags({ name: "no-color", type: "boolean" });
	});
});

describe("defineArg", () => {
	it("returns the named definition with literal types preserved", () => {
		const target = defineArg("target", { type: "string", required: true });

		expect(target).toEqual({ name: "target", type: "string", required: true });
		type _Arg = Assert<
			IsEqual<
				typeof target,
				{ readonly name: "target"; readonly type: "string"; readonly required: true }
			>
		>;

		// @ts-expect-error -- number args cannot have string defaults
		defineArg("bad", { type: "number", default: "1" });
		// @ts-expect-error -- every definition must be an ArgDef
		defineArg("bad", { type: "not-an-arg" });
	});

	it("feeds .args() with the same tuple typing as an inline literal", () => {
		const target = defineArg("target", { type: "string", required: true });
		const app = new Crust("cli").args(target, { name: "count", type: "number", default: 1 });

		type Args = (typeof app)["_types"]["args"];
		type _Args = Assert<
			IsEqual<
				Args,
				readonly [
					{ readonly name: "target"; readonly type: "string"; readonly required: true },
					{ readonly name: "count"; readonly type: "number"; readonly default: 1 },
				]
			>
		>;
		expect(app._node.args?.map((def) => def.name)).toEqual(["target", "count"]);
	});
});
