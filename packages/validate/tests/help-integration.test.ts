import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { runCommand } from "@crustjs/core";
import { helpPlugin, renderHelp } from "@crustjs/plugins";
import { z } from "zod";
import { arg, defineZodCommand, flag } from "../src/zod/index.ts";

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

describe("help plugin integration with defineZodCommand", () => {
	it("renders help for a flags-only schema-first command", async () => {
		const cmd = defineZodCommand({
			meta: { name: "serve", description: "Start dev server" },
			flags: {
				verbose: flag(
					z.boolean().default(false).describe("Enable verbose logging"),
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
		const cmd = defineZodCommand({
			meta: { name: "build" },
			args: [
				arg("entry", z.string().describe("Entry file")),
				arg("target", z.string().optional().describe("Build target")),
			],
			flags: {
				outDir: flag(z.string().default("dist").describe("Output directory"), {
					alias: "o",
				}),
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

	it("extracts description from .describe() on the schema", () => {
		const cmd = defineZodCommand({
			meta: { name: "app" },
			flags: {
				port: flag(z.number().describe("Schema description")),
			},
		});

		const output = renderHelp(cmd, ["app"]);
		expect(output).toContain("Schema description");
	});

	it("resolves description through wrappers like .optional() and .default()", () => {
		const cmd = defineZodCommand({
			meta: { name: "app" },
			flags: {
				port: flag(z.number().describe("Port number").default(3000)),
				host: flag(z.string().describe("Host name").optional()),
			},
		});

		const output = renderHelp(cmd, ["app"]);
		expect(output).toContain("Port number");
		expect(output).toContain("Host name");
	});

	it("renders variadic positional args", () => {
		const cmd = defineZodCommand({
			meta: { name: "lint" },
			args: [
				arg("mode", z.string()),
				arg("files", z.string().describe("Files to lint"), {
					variadic: true,
				}),
			],
		});

		const output = renderHelp(cmd, ["lint"]);
		expect(output).toContain("<mode>");
		expect(output).toContain("<files...>");
		expect(output).toContain("Files to lint");
	});

	it("renders parent and subcommand help correctly", async () => {
		const deploy = defineZodCommand({
			meta: { name: "deploy", description: "Deploy app" },
			flags: {
				env: flag(
					z.string().default("staging").describe("Target environment"),
					{ alias: "e" },
				),
			},
			run() {},
		});

		const root = defineZodCommand({
			meta: { name: "app", description: "App CLI" },
			subCommands: { deploy },
		});

		await runCommand(root, {
			argv: ["--help"],
			plugins: [helpPlugin()],
		});

		const parentOutput = getStdout();
		expect(parentOutput).toContain("COMMANDS:");
		expect(parentOutput).toContain("deploy");

		stdoutChunks = [];
		await runCommand(root, {
			argv: ["deploy", "--help"],
			plugins: [helpPlugin()],
		});

		const childOutput = getStdout();
		expect(childOutput).toContain("deploy - Deploy app");
		expect(childOutput).toContain("-e, --env");
		expect(childOutput).toContain("Target environment");
	});
});
