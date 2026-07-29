import { describe, expect, it } from "bun:test";

import { Crust } from "@crustjs/core";
import { parseArgs, resolveCommand, type CommandNode } from "@crustjs/core/tooling";

describe("crust integration", () => {
	it("Crust builder + parseArgs work through re-export", () => {
		const app = new Crust("parse-test")
			.args([{ name: "file", type: "string", required: true }] as const)
			.flags({
				output: { type: "string", default: "dist", short: "o" },
			} as const);

		// Access the internal node to test parseArgs directly
		const node = (app as unknown as { _node: CommandNode })._node;
		const result = parseArgs(node, ["src/index.ts", "-o", "build"]);
		expect((result.args as Record<string, unknown>).file).toBe("src/index.ts");
		expect((result.flags as Record<string, unknown>).output).toBe("build");
	});

	it("resolveCommand works with Crust builder", () => {
		const app = new Crust("root").command("sub", (cmd) => cmd.handle(() => {}));

		const node = (app as unknown as { _node: CommandNode })._node;
		const result = resolveCommand(node, ["sub", "--flag"]);
		expect(result.command.meta.name).toBe("sub");
		expect(result.argv).toEqual(["--flag"]);
		expect(result.commandPath).toEqual(["root", "sub"]);
	});

	it("Crust.execute() runs command through builder", async () => {
		let ran = false;
		const app = new Crust("run-test").handle(() => {
			ran = true;
		});

		await app.execute({ argv: [] });
		expect(ran).toBe(true);
	});
});
