import { type AnyCrust, Crust, defineCommand } from "@crustjs/core";
import { buildCommandDocumentation } from "@crustjs/core/tooling";
import { describe, expect, it } from "vite-plus/test";

import { walkCommand } from "./walker.ts";

async function walk(app: AnyCrust) {
	return walkCommand(buildCommandDocumentation(await app.snapshot()));
}

describe("walkCommand", () => {
	it("captures flat flags with type, spellings, description, multiple, and takesValue", async () => {
		const app = new Crust("mycli").flags(
			{ name: "verbose", type: "boolean", short: "v", description: "Verbose output" },
			{ name: "name", type: "string", description: "Name to greet", aliases: ["nm"] },
			{ name: "tag", type: "string", multiple: true },
		);
		const spec = await walk(app);
		const byName = Object.fromEntries(spec.flags.map((f) => [f.name, f]));

		expect(byName.verbose).toEqual({
			name: "verbose",
			spellings: ["-v", "--verbose", "--no-verbose"],
			type: "boolean",
			description: "Verbose output",
			takesValue: false,
		});
		expect(byName.name).toEqual({
			name: "name",
			spellings: ["--name", "--nm"],
			type: "string",
			description: "Name to greet",
			takesValue: true,
		});
		expect(byName.tag).toEqual({
			name: "tag",
			spellings: ["--tag"],
			type: "string",
			takesValue: true,
			multiple: true,
		});
	});

	it("captures positional args with required, variadic, type, and description", async () => {
		const app = new Crust("mycli").args(
			{ name: "input", type: "string", required: true, description: "Input file" },
			{ name: "extra", type: "string", variadic: true },
		);
		const spec = await walk(app);

		expect(spec.args).toEqual([
			{
				name: "input",
				type: "string",
				required: true,
				variadic: false,
				description: "Input file",
			},
			{ name: "extra", type: "string", required: false, variadic: true },
		]);
	});

	it("captures choices on string flags and string args", async () => {
		const app = new Crust("mycli")
			.flags({ name: "target", type: "string", choices: ["browser", "bun", "node"] })
			.args({ name: "shell", type: "string", required: true, choices: ["bash", "zsh", "fish"] });
		const spec = await walk(app);
		expect(spec.flags.find((f) => f.name === "target")?.choices).toEqual([
			"browser",
			"bun",
			"node",
		]);
		expect(spec.args[0]?.choices).toEqual(["bash", "zsh", "fish"]);
	});

	it("filters hidden subcommands recursively and preserves aliases", async () => {
		const app = new Crust("mycli").add(
			defineCommand("secret", { hidden: true }, (command) => command),
			defineCommand(
				"issue",
				{ description: "Build artifact", aliases: ["issues", "i"] },
				(command) => command,
			),
		);
		const spec = await walk(app);
		expect(spec.subCommands.map((s) => s.name)).toEqual(["issue"]);
		expect(spec.subCommands[0]?.aliases).toEqual(["issues", "i"]);
	});

	it("strips ANSI escapes and drops empty descriptions", async () => {
		const ESC = "\x1b";
		const app = new Crust("mycli", { description: `${ESC}[1mcolored desc${ESC}[0m` })
			.flags(
				{ name: "verbose", type: "boolean", description: `${ESC}[2mverbose${ESC}[0m` },
				{ name: "empty", type: "string", description: "" },
			)
			.args({ name: "input", type: "string", description: `${ESC}[33minput desc${ESC}[0m` })
			.add(
				defineCommand("kid", { description: `${ESC}[31mred kid${ESC}[0m` }, (command) => command),
			);
		const spec = await walk(app);
		expect(spec.description).toBe("colored desc");
		expect(spec.flags[0]?.description).toBe("verbose");
		expect(spec.flags[1]?.description).toBeUndefined();
		expect(spec.args[0]?.description).toBe("input desc");
		expect(spec.subCommands[0]?.description).toBe("red kid");
	});
});

describe("walkCommand — url/path/json valueCompletion", () => {
	it("normalises special flag types", async () => {
		const app = new Crust("mycli").flags(
			{ name: "endpoint", type: "url" },
			{ name: "out", type: "path" },
			{ name: "config", type: "json" },
		);
		const by = Object.fromEntries((await walk(app)).flags.map((f) => [f.name, f]));
		expect(by.endpoint?.valueCompletion).toBe("none");
		expect(by.out?.valueCompletion).toBe("files");
		expect(by.config?.valueCompletion).toBe("none");
	});
});
