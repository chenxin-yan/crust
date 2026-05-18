import { describe, expect, it } from "bun:test";
import { Crust } from "@crustjs/core";
import { renderHelp } from "@crustjs/plugins";
import * as Schema from "effect/Schema";
import { arg, commandValidator, flag } from "../src/index.ts";
import type { StandardSchema } from "../src/types.ts";

function wrapEffect<A, I>(s: Schema.Schema<A, I, never>): StandardSchema<I, A> {
	return Schema.standardSchemaV1(s) as unknown as StandardSchema<I, A>;
}

function stripAnsi(text: string): string {
	return Bun.stripANSI(text);
}

describe("help plugin integration with Effect Standard Schema", () => {
	it("renders Crust metadata instead of schema annotations", () => {
		const app = new Crust("deploy")
			.args([
				arg("target", wrapEffect(Schema.String), {
					description: "Deploy target",
					required: true,
				}),
			])
			.flags({
				verbose: flag(wrapEffect(Schema.UndefinedOr(Schema.Boolean)), {
					type: "boolean",
					short: "v",
					description: "Verbose logging",
				}),
			});

		const output = stripAnsi(renderHelp(app._node));
		expect(output).toContain("deploy <target> [options]");
		expect(output).toContain("Deploy target");
		expect(output).toContain("Verbose logging");
	});

	it("runs a command with Effect schemas and explicit typed parser hints", async () => {
		let received: { port: number; verbose: boolean | undefined } | undefined;
		const app = new Crust("serve")
			.flags({
				port: flag(wrapEffect(Schema.Number), { type: "number" }),
				verbose: flag(wrapEffect(Schema.UndefinedOr(Schema.Boolean)), {
					type: "boolean",
				}),
			})
			.run(
				commandValidator(({ flags }) => {
					received = { port: flags.port, verbose: flags.verbose };
				}),
			);

		await app.execute({ argv: ["--port", "3000", "--verbose"] });
		expect(received).toEqual({ port: 3000, verbose: true });
	});
});
