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
	parseArgs,
	resolveCommand,
	runCommand,
	runMain,
} from "@crust/core";

describe("crust package integration", () => {
	it("re-exports all core runtime APIs used by crust", () => {
		expect(typeof defineCommand).toBe("function");
		expect(typeof parseArgs).toBe("function");
		expect(typeof resolveCommand).toBe("function");
		expect(typeof runCommand).toBe("function");
		expect(typeof runMain).toBe("function");
	});

	it("defineCommand + parseArgs work through re-export", () => {
		const cmd = defineCommand({
			meta: { name: "parse-test" },
			args: [{ name: "file", type: String, required: true }],
			flags: {
				output: { type: String, default: "dist", alias: "o" },
			},
		});

		const result = parseArgs(cmd, ["src/index.ts", "-o", "build"]);
		expect(result.args.file).toBe("src/index.ts");
		expect(result.flags.output).toBe("build");
	});

	it("resolveCommand works through re-export", () => {
		const sub = defineCommand({
			meta: { name: "sub" },
			run() {},
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

	it("runCommand executes through re-export", async () => {
		let ran = false;
		const cmd = defineCommand({
			meta: { name: "run-test" },
			run() {
				ran = true;
			},
		});

		await runCommand(cmd, { argv: [] });
		expect(ran).toBe(true);
	});

	it("exported types are importable", () => {
		const meta: CommandMeta = { name: "typed" };
		const argDef: ArgDef = { name: "name", type: String };
		const flagDef: FlagDef = { type: Boolean };
		const argsDef: ArgsDef = [argDef];
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
		void parsed;
		void resolved;
		expect(true).toBe(true);
	});
});
