import { describe, expect, it } from "bun:test";

import { defineCommand } from "../index.ts";
import { type AnyCrust, Crust } from "./crust.ts";
import { buildCommandDocumentation, formatDefault, formatDescription } from "./documentation.ts";

async function docs(app: AnyCrust) {
	return buildCommandDocumentation(await app.snapshot());
}

describe("formatDescription", () => {
	it("formats descriptions, defaults, and choices", () => {
		expect(formatDefault(["json", "text"])).toBe("json, text");
		expect(formatDefault("json")).toBe('"json"');
		expect(formatDescription("Output", ["json", "text"], ["pretty", "compact"])).toBe(
			"Output [default: json, text] [choices: pretty, compact]",
		);
		expect(formatDescription(undefined, Number.POSITIVE_INFINITY, undefined)).toBe(
			"[default: Infinity]",
		);
		expect(formatDescription("Output", "json", undefined, (text) => `<${text}>`)).toBe(
			'Output <[default: "json"]>',
		);
	});
});

describe("buildCommandDocumentation", () => {
	it("builds usage and arg tokens", async () => {
		const model = await docs(
			new Crust("app")
				.args(
					{ name: "file", type: "string", required: true },
					{ name: "rest", type: "string", variadic: true },
				)
				.flags({ name: "verbose", type: "boolean" })
				.action(() => {}),
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
		const model = await docs(new Crust("app", { usage: "app FILE" }).action(() => {}));
		expect(model.usage).toBe("app FILE");
		expect(model.usageSegments).toEqual([{ kind: "custom", text: "app FILE" }]);
	});

	it("omits hidden commands while traversing the full visible tree", async () => {
		const model = await docs(
			new Crust("app")
				.add(
					defineCommand("visible", (command) =>
						command.add(defineCommand("nested", (child) => child.action(() => {}))),
					),
				)
				.add(defineCommand("hidden", { hidden: true }, (command) => command.action(() => {}))),
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
				.action(() => {}),
		);
		expect(model.flags[0]).toMatchObject({
			name: "color",
			required: true,
			spellings: ["-c", "--color", "--colour", "--no-color", "--no-colour"],
		});
		expect(model.flags[1]?.spellings).toEqual(["--help"]);
	});

	it("retains defaults, choices, and unfiltered sections as renderer-neutral data", async () => {
		const model = await docs(
			new Crust("app", {
				sections: [{ title: "Notes", body: "Root notes" }],
			})
				.flags({ name: "target", type: "string", default: "bun", choices: ["bun", "node"] })
				.add(
					defineCommand(
						"child",
						{ sections: [{ title: "Child notes", body: "Details" }] },
						(command) => command,
					),
				)
				.action(() => {}),
		);
		expect(model.flags[0]).toMatchObject({ default: "bun", choices: ["bun", "node"] });
		expect(model.sections).toEqual([{ title: "Notes", body: "Root notes" }]);
		expect(model.children[0]?.sections).toEqual([{ title: "Child notes", body: "Details" }]);
	});
});
