import { describe, expect, it } from "bun:test";

import { Crust } from "@crustjs/core";
import { prepareCommandSnapshot } from "@crustjs/core/tooling";

describe("crust integration", () => {
	it("parses args and flags through the public run() pipeline", async () => {
		let captured: { file?: unknown; output?: unknown } = {};
		const app = new Crust("parse-test")
			.args([{ name: "file", type: "string", required: true }] as const)
			.flags({
				output: { type: "string", default: "dist", short: "o" },
			} as const)
			.handle(({ args, flags }) => {
				captured = { file: args.file, output: flags.output };
			});

		await app.run(["src/index.ts", "-o", "build"]);
		expect(captured.file).toBe("src/index.ts");
		expect(captured.output).toBe("build");
	});

	it("prepareCommandSnapshot exposes the routed tree through the tooling bridge", async () => {
		const app = new Crust("root").command("sub", (cmd) => cmd.handle(() => {}));

		const root = await prepareCommandSnapshot(app);
		expect(root.meta.name).toBe("root");
		expect(root.subCommands.sub?.hasHandler).toBe(true);
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
