import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Crust } from "@crustjs/core";
import { helpPlugin, renderHelp } from "@crustjs/plugins";
import { z } from "zod";
import { arg, commandValidator, flag } from "../src/zod/index.ts";

let stdoutChunks: string[];
let originalLog: typeof console.log;

beforeEach(() => {
	stdoutChunks = [];
	originalLog = console.log;
	console.log = (...args: unknown[]) => {
		stdoutChunks.push(args.map((arg) => String(arg)).join(" "));
	};
});

afterEach(() => {
	console.log = originalLog;
	process.exitCode = 0;
});

function getStdout(): string {
	return stdoutChunks.join("\n");
}

describe("help plugin integration with Crust builder + commandValidator", () => {
	it("renders help for a flags-only schema-first command", async () => {
		const app = new Crust("serve")
			.meta({ description: "Start dev server" })
			.flags({
				verbose: flag(
					z.boolean().default(false).describe("Enable verbose logging"),
					{ alias: "v" },
				),
			})
			.run(commandValidator(() => {}))
			.use(helpPlugin());

		await app.execute({ argv: ["--help"] });

		const output = getStdout();
		expect(output).toContain("serve - Start dev server");
		expect(output).toContain("USAGE:");
		expect(output).toContain("serve [options]");
		expect(output).toContain("OPTIONS:");
		expect(output).toContain("-v, --verbose");
		expect(output).toContain("Enable verbose logging");
		expect(output).toContain("-h, --help");
	});

	it("renders args and options sections from generated definitions", () => {
		const app = new Crust("build")
			.args([
				arg("entry", z.string().describe("Entry file")),
				arg("target", z.string().optional().describe("Build target")),
			])
			.flags({
				outDir: flag(z.string().default("dist").describe("Output directory"), {
					alias: "o",
				}),
			});

		const output = renderHelp(app._node);
		expect(output).toContain("build <entry> [target] [options]");
		expect(output).toContain("ARGS:");
		expect(output).toContain("<entry>");
		expect(output).toContain("Entry file");
		expect(output).toContain("[target]");
		expect(output).toContain("Build target");
		expect(output).toContain("OPTIONS:");
		expect(output).toContain("-o, --outDir");
	});

	it("extracts description from .describe() on the schema", () => {
		const app = new Crust("app").flags({
			port: flag(z.number().describe("Schema description")),
		});

		const output = renderHelp(app._node);
		expect(output).toContain("Schema description");
	});

	it("resolves description through wrappers like .optional() and .default()", () => {
		const app = new Crust("app").flags({
			port: flag(z.number().describe("Port number").default(3000)),
			host: flag(z.string().describe("Host name").optional()),
		});

		const output = renderHelp(app._node);
		expect(output).toContain("Port number");
		expect(output).toContain("Host name");
	});

	it("renders variadic positional args", () => {
		const app = new Crust("lint").args([
			arg("mode", z.string()),
			arg("files", z.string().describe("Files to lint"), {
				variadic: true,
			}),
		]);

		const output = renderHelp(app._node);
		expect(output).toContain("<mode>");
		expect(output).toContain("<files...>");
		expect(output).toContain("Files to lint");
	});

	it("renders parent and subcommand help correctly", async () => {
		function createApp() {
			return new Crust("app")
				.meta({ description: "App CLI" })
				.command("deploy", (cmd) =>
					cmd
						.flags({
							env: flag(
								z.string().default("staging").describe("Target environment"),
								{ alias: "e" },
							),
						})
						.run(commandValidator(() => {})),
				)
				.use(helpPlugin());
		}

		await createApp().execute({ argv: ["--help"] });

		const parentOutput = getStdout();
		expect(parentOutput).toContain("COMMANDS:");
		expect(parentOutput).toContain("deploy");

		stdoutChunks = [];
		await createApp().execute({ argv: ["deploy", "--help"] });

		const childOutput = getStdout();
		expect(childOutput).toContain("deploy");
		expect(childOutput).toContain("-e, --env");
		expect(childOutput).toContain("Target environment");
	});
});
