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

	it("rejects invalid choice defaults and reserved spellings at the builder call", () => {
		const typecheck = () => {
			// @ts-expect-error -- default falls outside the literal choices
			new Crust("cli").flags({ name: "mode", type: "string", choices: ["a", "b"], default: "z" });
			// @ts-expect-error -- __proto__ would mutate the plain-object flag registry
			new Crust("cli").flags({ name: "__proto__", type: "boolean" });
			// @ts-expect-error -- aliases share the same reserved spelling rule
			new Crust("cli").flags({ name: "safe", type: "boolean", aliases: ["__proto__"] });
		};

		expect(typecheck).toBeInstanceOf(Function);
	});

	it("feeds .flags() with the same record typing as an inline literal", async () => {
		const verbose = defineFlag("verbose", { type: "boolean" });
		const app = new Crust("cli").flags(verbose, { name: "output", type: "string", short: "o" });

		type Flags = (typeof app)["_types"]["flags"];
		type _Verbose = Assert<IsEqual<Flags["verbose"], { readonly type: "boolean" }>>;
		type _Output = Assert<
			IsEqual<Flags["output"], { readonly type: "string"; readonly short: "o" }>
		>;
		expect((await app.snapshot()).flags).toEqual({
			verbose: { type: "boolean", negatable: true },
			output: { type: "string", short: "o", negatable: false },
		});
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

	it("rejects defaults outside literal choices at the builder call", () => {
		const typecheck = () => {
			// @ts-expect-error -- default falls outside the literal choices
			new Crust("cli").args({ name: "mode", type: "string", choices: ["a", "b"], default: "z" });
		};

		expect(typecheck).toBeInstanceOf(Function);
	});

	it("feeds .args() with the same tuple typing as an inline literal", async () => {
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
		expect((await app.snapshot()).args.map((def) => def.name)).toEqual(["target", "count"]);
	});
});
