import { describe, expect, it } from "bun:test";
import { Crust } from "@crustjs/core";
import { renderHelp } from "@crustjs/plugins";
import { z } from "zod";
import { arg, commandValidator, flag } from "../src/index.ts";

function stripAnsi(text: string): string {
	return Bun.stripANSI(text);
}

describe("help plugin integration with schema-backed definitions", () => {
	it("renders descriptions supplied as Crust metadata", () => {
		const app = new Crust("build")
			.args([
				arg("entry", z.string(), { description: "Entry file", required: true }),
				arg("target", z.string().optional(), { description: "Build target" }),
			])
			.flags({
				outDir: flag(z.string().default("dist"), {
					type: "string",
					short: "o",
					description: "Output directory",
				}),
			});

		const output = stripAnsi(renderHelp(app._node));
		expect(output).toContain("build <entry> [target] [options]");
		expect(output).toContain("Entry file");
		expect(output).toContain("Build target");
		expect(output).toContain("-o, --outDir");
		expect(output).toContain("Output directory");
	});

	it("runs a command with raw schema-backed args and typed schema-backed flags", async () => {
		let received: { port: number; verbose: boolean } | undefined;
		const app = new Crust("serve")
			.args([arg("port", z.coerce.number())])
			.flags({
				verbose: flag(z.boolean().default(false), {
					type: "boolean",
					short: "v",
				}),
			})
			.run(
				commandValidator(({ args, flags }) => {
					received = { port: args.port, verbose: flags.verbose };
				}),
			);

		await app.execute({ argv: ["3000", "--verbose"] });
		expect(received).toEqual({ port: 3000, verbose: true });
	});
});
