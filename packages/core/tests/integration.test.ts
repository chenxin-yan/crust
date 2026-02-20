import { describe, expect, it } from "bun:test";
import type {
	ArgDef,
	ArgsDef,
	Command,
	CommandMeta,
	CommandRoute,
	FlagDef,
	FlagsDef,
	InferArgs,
	ParseResult,
} from "../src/index";
import {
	defineCommand,
	parseArgs,
	resolveCommand,
	runMain,
} from "../src/index";
import { runCommand as runTestCommand } from "./helpers";

const serveCmd = defineCommand({
	meta: { name: "serve", description: "Start the dev server" },
	args: [{ name: "dir", type: "string", default: "." }],
	flags: {
		port: { type: "number", default: 3000, alias: "p" },
	},
	run({ args, flags }) {
		console.log(`serve ${args.dir} on ${flags.port}`);
	},
});

const rootCmd = defineCommand({
	meta: { name: "myapp", description: "Integration test app" },
	flags: {
		help: { type: "boolean", alias: "h" },
	},
	subCommands: { serve: serveCmd },
	run({ flags }) {
		if (flags.help) {
			console.log("help");
		}
	},
});

describe("integration: core APIs", () => {
	it("parseArgs parses args and flags", () => {
		const result = parseArgs(serveCmd, ["public", "--port", "8080"]);
		expect(result.args.dir).toBe("public");
		expect(result.flags.port).toBe(8080);
	});

	it("resolveCommand resolves subcommands", () => {
		const result = resolveCommand(rootCmd, ["serve", "--port", "9000"]);
		expect(result.command.meta.name).toBe("serve");
		expect(result.argv).toEqual(["--port", "9000"]);
		expect(result.commandPath).toEqual(["myapp", "serve"]);
	});

	it("runCommand executes using options.argv", async () => {
		const result = await runTestCommand(rootCmd, {
			argv: ["serve", "src", "--port", "4000"],
		});
		expect(result.stdout).toContain("serve src on 4000");
		expect(result.exitCode).toBe(0);
	});

	it("runMain catches errors and sets exit code", async () => {
		const originalExitCode = process.exitCode;
		const originalArgv = process.argv;

		try {
			process.argv = ["bun", "script.ts"];
			const cmd = defineCommand({
				meta: { name: "fail" },
				run() {
					throw new Error("boom");
				},
			});

			await runMain(cmd);
			expect(process.exitCode).toBe(1);
		} finally {
			process.argv = originalArgv;
			process.exitCode = originalExitCode;
		}
	});
});

describe("integration: exported types", () => {
	it("types are importable and usable", () => {
		const meta: CommandMeta = { name: "typed" };
		const argDef: ArgDef = { name: "name", type: "string" };
		const flagDef: FlagDef = { type: "boolean" };
		const argsDef: ArgsDef = [argDef];
		const flagsDef: FlagsDef = { verbose: flagDef };

		const cmdDef: Command = { meta, args: argsDef, flags: flagsDef };
		const cmd: Command = defineCommand({ meta: { name: "typed-cmd" } });

		const parsed: ParseResult = {
			args: {},
			flags: {},
			rawArgs: [],
		};
		const resolved: CommandRoute = {
			command: cmd,
			argv: [],
			commandPath: ["typed-cmd"],
		};

		type TestArgs = [{ name: "file"; type: "string"; required: true }];
		type ResolvedArgs = InferArgs<TestArgs>;
		const inferred: ResolvedArgs = { file: "index.ts" };

		void meta;
		void argDef;
		void flagDef;
		void argsDef;
		void flagsDef;
		void cmdDef;
		void parsed;
		void resolved;
		expect(inferred.file).toBe("index.ts");
	});
});
