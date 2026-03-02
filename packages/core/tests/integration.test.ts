import { beforeEach, describe, expect, it } from "bun:test";
import type {
	ArgDef,
	ArgsDef,
	CommandMeta,
	CommandRoute,
	FlagDef,
	FlagsDef,
	InferArgs,
	ParseResult,
} from "../src/index";
import { Crust, parseArgs, resolveCommand } from "../src/index";
import { executeCrust } from "./helpers";

const serveCmd = new Crust("serve")
	.args([{ name: "dir", type: "string", default: "." }] as const)
	.flags({
		port: { type: "number", default: 3000, alias: "p" },
	} as const)
	.run(({ args, flags }) => {
		console.log(`serve ${args.dir} on ${flags.port}`);
	});

const rootCmd = new Crust({
	name: "myapp",
	description: "Integration test app",
})
	.flags({
		help: { type: "boolean", alias: "h" },
	} as const)
	.command("serve", () => serveCmd)
	.run(({ flags }) => {
		if (flags.help) {
			console.log("help");
		}
	});

describe("integration: core APIs", () => {
	beforeEach(() => {
		process.exitCode = 0;
	});

	it("parseArgs parses args and flags using CommandNode", () => {
		const result = parseArgs(serveCmd._node, ["public", "--port", "8080"]);
		expect((result.args as Record<string, unknown>).dir).toBe("public");
		expect((result.flags as Record<string, unknown>).port).toBe(8080);
	});

	it("resolveCommand resolves subcommands using CommandNode", () => {
		const result = resolveCommand(rootCmd._node, ["serve", "--port", "9000"]);
		expect(result.command.meta.name).toBe("serve");
		expect(result.argv).toEqual(["--port", "9000"]);
		expect(result.commandPath).toEqual(["myapp", "serve"]);
	});

	it("execute() runs using argv override", async () => {
		const result = await executeCrust(rootCmd, [
			"serve",
			"src",
			"--port",
			"4000",
		]);
		expect(result.stdout).toContain("serve src on 4000");
		expect(result.exitCode).toBe(0);
	});

	it("execute() catches errors and sets exit code", async () => {
		const failCmd = new Crust("fail").run(() => {
			throw new Error("boom");
		});

		const result = await executeCrust(failCmd, []);
		expect(result.exitCode).toBe(1);
	});
});

describe("integration: exported types", () => {
	it("types are importable and usable", () => {
		const meta: CommandMeta = { name: "typed" };
		const argDef: ArgDef = { name: "name", type: "string" };
		const flagDef: FlagDef = { type: "boolean" };
		const argsDef: ArgsDef = [argDef];
		const flagsDef: FlagsDef = { verbose: flagDef };

		const parsed: ParseResult = {
			args: {},
			flags: {},
			rawArgs: [],
		};
		const resolved: CommandRoute = {
			command: new Crust("typed-cmd")._node,
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
		void parsed;
		void resolved;
		expect(inferred.file).toBe("index.ts");
	});
});
