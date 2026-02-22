import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { runCommand } from "@crustjs/core";
import { helpPlugin, renderHelp } from "@crustjs/plugins";
import * as Schema from "effect/Schema";
import { arg, defineEffectCommand, flag } from "../src/effect/index.ts";

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

describe("help plugin integration with defineEffectCommand", () => {
	it("renders help for a flags-only schema-first command", async () => {
		const cmd = defineEffectCommand({
			meta: { name: "serve", description: "Start dev server" },
			flags: {
				verbose: flag(
					Schema.UndefinedOr(
						Schema.Boolean.annotations({
							description: "Enable verbose logging",
						}),
					),
					{ alias: "v" },
				),
			},
			run() {},
		});

		await runCommand(cmd, {
			argv: ["--help"],
			plugins: [helpPlugin()],
		});

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
		const cmd = defineEffectCommand({
			meta: { name: "build" },
			args: [
				arg("entry", Schema.String.annotations({ description: "Entry file" })),
				arg(
					"target",
					Schema.UndefinedOr(
						Schema.String.annotations({ description: "Build target" }),
					),
				),
			],
			flags: {
				outDir: flag(
					Schema.String.annotations({ description: "Output directory" }),
					{ alias: "o" },
				),
			},
		});

		const output = renderHelp(cmd, ["build"]);
		expect(output).toContain("build <entry> [target] [options]");
		expect(output).toContain("ARGS:");
		expect(output).toContain("<entry>");
		expect(output).toContain("Entry file");
		expect(output).toContain("[target]");
		expect(output).toContain("Build target");
		expect(output).toContain("OPTIONS:");
		expect(output).toContain("-o, --outDir");
	});

	it("runs command with both args and flags through runCommand", async () => {
		const received: { args: unknown; flags: unknown }[] = [];

		const cmd = defineEffectCommand({
			meta: { name: "build" },
			args: [
				arg("entry", Schema.String.annotations({ description: "Entry file" })),
				arg(
					"target",
					Schema.UndefinedOr(
						Schema.String.annotations({ description: "Build target" }),
					),
				),
			],
			flags: {
				outDir: flag(
					Schema.String.annotations({ description: "Output directory" }),
					{ alias: "o" },
				),
			},
			run({ args, flags }) {
				received.push({ args, flags });
			},
		});

		await runCommand(cmd, {
			argv: ["index.ts", "es2022", "-o", "dist"],
			plugins: [helpPlugin()],
		});

		expect(received).toHaveLength(1);
		expect(received[0]?.args).toEqual({
			entry: "index.ts",
			target: "es2022",
		});
		expect(received[0]?.flags).toEqual({ outDir: "dist" });
	});

	it("extracts description from schema annotations", () => {
		const cmd = defineEffectCommand({
			meta: { name: "app" },
			flags: {
				port: flag(
					Schema.Number.annotations({ description: "Schema description" }),
				),
			},
		});

		const output = renderHelp(cmd, ["app"]);
		expect(output).toContain("Schema description");
	});

	it("resolves description through wrappers like UndefinedOr", () => {
		const cmd = defineEffectCommand({
			meta: { name: "app" },
			flags: {
				port: flag(
					Schema.UndefinedOr(
						Schema.Number.annotations({ description: "Port number" }),
					),
				),
			},
		});

		const output = renderHelp(cmd, ["app"]);
		expect(output).toContain("Port number");
	});
});
