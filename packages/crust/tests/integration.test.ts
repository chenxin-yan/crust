import { describe, expect, it } from "bun:test";
import type {
	ArgDef,
	ArgsDef,
	CommandMeta,
	FlagDef,
	FlagsDef,
	ParseResult,
} from "@crustjs/core";
import { Crust, parseArgs, resolveCommand } from "@crustjs/core";

describe("crust integration", () => {
	it("re-exports all core runtime APIs used by crust", () => {
		expect(typeof Crust).toBe("function");
		expect(typeof parseArgs).toBe("function");
		expect(typeof resolveCommand).toBe("function");
	});

	it("Crust builder + parseArgs work through re-export", () => {
		const app = new Crust("parse-test")
			.args([{ name: "file", type: "string", required: true }] as const)
			.flags({
				output: { type: "string", default: "dist", short: "o" },
			} as const);

		// Access the internal node to test parseArgs directly
		const node = (
			app as unknown as { _node: import("@crustjs/core").CommandNode }
		)._node;
		const result = parseArgs(node, ["src/index.ts", "-o", "build"]);
		expect((result.args as Record<string, unknown>).file).toBe("src/index.ts");
		expect((result.flags as Record<string, unknown>).output).toBe("build");
	});

	it("resolveCommand works with Crust builder", () => {
		const app = new Crust("root").command("sub", (cmd) => cmd.run(() => {}));

		const node = (
			app as unknown as { _node: import("@crustjs/core").CommandNode }
		)._node;
		const result = resolveCommand(node, ["sub", "--flag"]);
		expect(result.command.meta.name).toBe("sub");
		expect(result.argv).toEqual(["--flag"]);
		expect(result.commandPath).toEqual(["root", "sub"]);
	});

	it("Crust.execute() runs command through builder", async () => {
		let ran = false;
		const app = new Crust("run-test").run(() => {
			ran = true;
		});

		await app.execute({ argv: [] });
		expect(ran).toBe(true);
	});

	it("exported types are importable", () => {
		const meta: CommandMeta = { name: "typed" };
		const argDef: ArgDef = { name: "name", type: "string" };
		const flagDef: FlagDef = { type: "boolean" };
		const argsDef: ArgsDef = [argDef];
		const flagsDef: FlagsDef = { verbose: flagDef };
		const parsed: ParseResult = { args: {}, flags: {}, rawArgs: [] };

		void meta;
		void argDef;
		void flagDef;
		void argsDef;
		void flagsDef;
		void parsed;
		expect(true).toBe(true);
	});
});
