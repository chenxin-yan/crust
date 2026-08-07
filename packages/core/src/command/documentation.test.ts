import { describe, expect, it } from "bun:test";

import { defineCommand } from "../index.ts";
import { Crust, prepareCommandSnapshot } from "./crust.ts";
import { buildCommandDocumentation } from "./documentation.ts";

async function docs(app: Crust) {
	return buildCommandDocumentation(await prepareCommandSnapshot(app));
}

describe("buildCommandDocumentation", () => {
	it("builds usage and arg tokens", async () => {
		const model = await docs(
			new Crust("app")
				.args({ name: "file", required: true }, { name: "rest", variadic: true })
				.flags({ name: "verbose", type: "boolean" })
				.handle(() => {}),
		);
		expect(model.usage).toBe("app <file> [rest...] [options]");
		expect(model.args.map((arg) => arg.token)).toEqual(["<file>", "[rest...]"]);
		expect(model.usageSegments).toEqual([
			{ kind: "path", text: "app" },
			{ kind: "arg", text: "<file>", required: true },
			{ kind: "arg", text: "[rest...]", required: false },
			{ kind: "options", text: "[options]" },
		]);
	});

	it("uses explicit usage unchanged", async () => {
		const model = await docs(new Crust("app").meta({ usage: "app FILE" }).handle(() => {}));
		expect(model.usage).toBe("app FILE");
		expect(model.usageSegments).toEqual([{ kind: "custom", text: "app FILE" }]);
	});

	it("omits hidden commands while traversing the full visible tree", async () => {
		const model = await docs(
			new Crust("app")
				.mount(
					defineCommand("visible", (command) =>
						command.mount(defineCommand("nested", (child) => child.handle(() => {}))),
					),
				)
				.mount(
					defineCommand("hidden", (command) => command.meta({ hidden: true }).handle(() => {})),
				),
		);
		expect(model.children.map((child) => child.name)).toEqual(["visible"]);
		expect(model.children[0]?.children[0]?.path).toEqual(["app", "visible", "nested"]);
		expect(model.usage).toBe("app <command>");
	});

	it("resolves every flag spelling and negation from the parser spelling table", async () => {
		const model = await docs(
			new Crust("app")
				.flags(
					{
						name: "color",
						type: "boolean",
						short: "c",
						aliases: ["colour"],
						required: true,
					},
					{ name: "help", type: "boolean", noNegate: true },
				)
				.handle(() => {}),
		);
		expect(model.flags[0]).toMatchObject({
			name: "color",
			required: true,
			spellings: ["-c", "--color", "--colour", "--no-color", "--no-colour"],
		});
		expect(model.flags[1]?.spellings).toEqual(["--help"]);
	});

	it("retains defaults and choices as renderer-neutral data", async () => {
		const model = await docs(
			new Crust("app")
				.flags({ name: "target", type: "string", default: "bun", choices: ["bun", "node"] })
				.handle(() => {}),
		);
		expect(model.flags[0]).toMatchObject({ default: "bun", choices: ["bun", "node"] });
	});
});
