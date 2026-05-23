import { describe, expect, it } from "bun:test";
import { Crust } from "@crustjs/core";
import { renderHelp } from "@crustjs/plugins";
import * as Schema from "effect/Schema";
import { z } from "zod";
import { arg, commandValidator, flag } from "../src/index.ts";
import type { StandardSchema } from "../src/types.ts";

function wrapEffect<A, I>(s: Schema.Schema<A, I, never>): StandardSchema<I, A> {
	return Schema.standardSchemaV1(s) as unknown as StandardSchema<I, A>;
}

function stripAnsi(text: string): string {
	return Bun.stripANSI(text);
}

type VendorFixtures = {
	name: "zod" | "effect";
	stringSchema: () => StandardSchema<string, string>;
	optionalBoolSchema: () => StandardSchema<unknown, boolean | undefined>;
	numberArgSchema: () => StandardSchema<unknown, number>;
	numberFlagSchema: () => StandardSchema<unknown, number>;
};

const zodFixtures: VendorFixtures = {
	name: "zod",
	stringSchema: () => z.string() as unknown as StandardSchema<string, string>,
	optionalBoolSchema: () =>
		z.boolean().optional() as unknown as StandardSchema<
			unknown,
			boolean | undefined
		>,
	numberArgSchema: () =>
		z.number() as unknown as StandardSchema<unknown, number>,
	numberFlagSchema: () =>
		z.number() as unknown as StandardSchema<unknown, number>,
};

const effectFixtures: VendorFixtures = {
	name: "effect",
	stringSchema: () => wrapEffect(Schema.String),
	optionalBoolSchema: () => wrapEffect(Schema.UndefinedOr(Schema.Boolean)),
	numberArgSchema: () => wrapEffect(Schema.Number),
	numberFlagSchema: () => wrapEffect(Schema.Number),
};

describe("help plugin integration with schema-backed definitions", () => {
	it.each([
		zodFixtures,
		effectFixtures,
	])("[$name] renders Crust metadata instead of schema annotations", (fx) => {
		const app = new Crust("build")
			.args([
				arg("entry", fx.stringSchema(), {
					description: "Entry file",
					required: true,
				}),
				arg("target", fx.stringSchema(), { description: "Build target" }),
			])
			.flags({
				outDir: flag(fx.stringSchema(), {
					type: "string",
					short: "o",
					description: "Output directory",
				}),
				verbose: flag(fx.optionalBoolSchema(), {
					type: "boolean",
					short: "v",
					description: "Verbose logging",
				}),
			});

		const output = stripAnsi(renderHelp(app._node));
		expect(output).toContain("build <entry> [target] [options]");
		expect(output).toContain("Entry file");
		expect(output).toContain("Build target");
		expect(output).toContain("-o, --outDir");
		expect(output).toContain("Output directory");
		expect(output).toContain("Verbose logging");
	});

	it.each([
		zodFixtures,
		effectFixtures,
	])("[$name] runs a command with schema-backed args and typed schema-backed flags", async (fx) => {
		let received: { port: number; verbose: boolean | undefined } | undefined;
		const app = new Crust("serve")
			.args([arg("port", fx.numberArgSchema(), { type: "number" })])
			.flags({
				verbose: flag(fx.optionalBoolSchema(), {
					type: "boolean",
					short: "v",
				}),
			})
			.run(
				commandValidator(({ args, flags }) => {
					received = {
						port: args.port as number,
						verbose: flags.verbose as boolean | undefined,
					};
				}),
			);

		await app.execute({ argv: ["3000", "--verbose"] });
		expect(received).toEqual({ port: 3000, verbose: true });
	});
});
