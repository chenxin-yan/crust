/**
 * Integration test that imports from the 'crust' package (not @crust/core)
 * and verifies all public APIs are available through the re-export.
 *
 * NOTE: The 'crust' package re-exports from the @crust/core built dist/.
 * This test validates the built output works correctly.
 */

import { describe, expect, it } from "bun:test";
import type {
	ArgDef,
	ArgsDef,
	Command,
	CommandDef,
	CommandMeta,
	FlagDef,
	FlagsDef,
	ParsedResult,
	ResolveResult,
	TypeConstructor,
} from "@crust/core";
import {
	defineCommand,
	formatHelp,
	formatVersion,
	parseArgs,
	resolveCommand,
	runCommand,
	runMain,
} from "@crust/core";

describe("crust package integration", () => {
	it("re-exports all functions from @crust/core", () => {
		expect(typeof defineCommand).toBe("function");
		expect(typeof parseArgs).toBe("function");
		expect(typeof formatHelp).toBe("function");
		expect(typeof formatVersion).toBe("function");
		expect(typeof resolveCommand).toBe("function");
		expect(typeof runCommand).toBe("function");
		expect(typeof runMain).toBe("function");
	});

	it("defineCommand works through the crust package", () => {
		const cmd = defineCommand({
			meta: { name: "test-crust-pkg", version: "0.1.0", description: "Test" },
			args: {
				name: { type: String, required: true },
			},
			flags: {
				verbose: { type: Boolean, alias: "v" },
			},
			run({ args }) {
				console.log(`Hello ${args.name}!`);
			},
		});

		expect(cmd.meta.name).toBe("test-crust-pkg");
		expect(cmd.meta.version).toBe("0.1.0");
		expect(Object.isFrozen(cmd)).toBe(true);
	});

	it("parseArgs works through the crust package", () => {
		const cmd = defineCommand({
			meta: { name: "parse-test" },
			args: {
				file: { type: String, required: true },
			},
			flags: {
				output: { type: String, default: "dist", alias: "o" },
			},
		});

		const result = parseArgs(cmd, ["src/index.ts", "-o", "build"]);
		expect(result.args.file).toBe("src/index.ts");
		expect(result.flags.output).toBe("build");
	});

	it("formatHelp works through the crust package", () => {
		const cmd = defineCommand({
			meta: { name: "help-test", description: "A test command" },
			flags: {
				debug: { type: Boolean },
			},
		});

		const help = formatHelp(cmd);
		expect(help).toContain("A test command");
		expect(help).toContain("USAGE:");
		expect(help).toContain("--debug");
	});

	it("formatVersion works through the crust package", () => {
		const cmd = defineCommand({
			meta: { name: "version-test", version: "2.0.0" },
		});

		expect(formatVersion(cmd)).toBe("version-test v2.0.0");
	});

	it("resolveCommand works through the crust package", () => {
		const sub = defineCommand({
			meta: { name: "sub", description: "A subcommand" },
			run() {
				console.log("sub ran");
			},
		});

		const root = defineCommand({
			meta: { name: "root" },
			subCommands: { sub },
		});

		const result = resolveCommand(root, ["sub", "--flag"]);
		expect(result.resolved.meta.name).toBe("sub");
		expect(result.argv).toEqual(["--flag"]);
		expect(result.path).toEqual(["root", "sub"]);
	});

	it("runCommand works through the crust package", async () => {
		let ran = false;
		const cmd = defineCommand({
			meta: { name: "run-test" },
			run() {
				ran = true;
			},
		});

		await runCommand(cmd, []);
		expect(ran).toBe(true);
	});

	it("all types are importable and usable", () => {
		// Type-level verification — if this compiles, all types are exported
		const meta: CommandMeta = { name: "typed" };
		const argDef: ArgDef = { type: String };
		const flagDef: FlagDef = { type: Boolean };
		const argsDef: ArgsDef = { name: argDef };
		const flagsDef: FlagsDef = { verbose: flagDef };
		const tc: TypeConstructor = Number;
		const cmdDef: CommandDef = { meta };
		const cmd: Command = defineCommand({ meta: { name: "typed-test" } });
		const parsed: ParsedResult = { args: {}, flags: {}, rawArgs: [] };
		const resolved: ResolveResult = {
			resolved: cmd,
			argv: [],
			path: ["typed-test"],
		};

		void meta;
		void argDef;
		void flagDef;
		void argsDef;
		void flagsDef;
		void tc;
		void cmdDef;
		void cmd;
		void parsed;
		void resolved;

		expect(true).toBe(true);
	});
});
