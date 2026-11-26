import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { defineCommand, defineContext, defineExtension } from "../index.ts";
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
		expect(formatDescription("Tags", [], undefined)).toBe("Tags");
		expect(formatDescription("Output", "json", undefined, (text) => `<${text}>`)).toBe(
			'Output <[default: "json"]>',
		);
	});

	it("renders the env variable name directly after the description", () => {
		expect(formatDescription("Token", undefined, undefined, undefined, "APP_TOKEN")).toBe(
			"Token [env: APP_TOKEN]",
		);
		expect(formatDescription("Mode", "dev", ["dev", "prod"], (t) => `<${t}>`, "APP_MODE")).toBe(
			'Mode <[env: APP_MODE]> <[default: "dev"]> <[choices: dev, prod]>',
		);
		expect(formatDescription(undefined, undefined, undefined, undefined, "APP_TOKEN")).toBe(
			"[env: APP_TOKEN]",
		);
	});

	it("puts the deprecation first among the annotations", () => {
		expect(formatDescription("Old", "x", undefined, undefined, "OLD", "Use --new.")).toBe(
			'Old [deprecated: Use --new.] [env: OLD] [default: "x"]',
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
				.flags({ verbose: { type: "boolean" } })
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

	it("documents a required arg or flag with a default as optional, like the parser", async () => {
		const model = await docs(
			new Crust("app")
				.args({ name: "target", type: "string", required: true, default: "prod" })
				.flags({ region: { type: "string", required: true, default: "us" } })
				.action(() => {}),
		);
		expect(model.usage).toBe("app [target] [options]");
		expect(model.args).toMatchObject([{ token: "[target]", required: false }]);
		expect(model.flags).toMatchObject([{ name: "region", required: false }]);
	});

	it('renders an "afterDoubleDash" arg after -- and [options], like clap\'s last', async () => {
		const run = await docs(
			new Crust("run")
				.flags({ watch: { type: "boolean" } })
				.args(
					{ name: "task", type: "string", required: true },
					{ name: "pkgs", type: "string", variadic: true },
					{ name: "extra", type: "string", variadic: "afterDoubleDash" },
				)
				.action(() => {}),
		);
		expect(run.usage).toBe("run <task> [pkgs...] [options] [-- <extra>...]");
		expect(run.args.map((arg) => [arg.token, arg.variadic])).toEqual([
			["<task>", false],
			["[pkgs...]", true],
			["[-- <extra>...]", "afterDoubleDash"],
		]);
		const exec = await docs(
			new Crust("exec")
				.args({ name: "command", type: "string", required: true, variadic: "afterDoubleDash" })
				.action(() => {}),
		);
		expect(exec.usage).toBe("exec -- <command>...");
	});

	it('puts [options] before every arg of a command with a "passthrough" arg', async () => {
		const run = await docs(
			new Crust("run")
				.flags({ rm: { type: "boolean" } })
				.args(
					{ name: "image", type: "string", required: true },
					{ name: "command", type: "string", variadic: "passthrough" },
				)
				.action(() => {}),
		);
		expect(run.usage).toBe("run [options] <image> [command...]");
		expect(run.args.map((arg) => arg.variadic)).toEqual([false, "passthrough"]);
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

	it("lists negations only for a flag with default: true", async () => {
		const model = await docs(
			new Crust("app")
				.flags({
					color: { type: "boolean", short: "c", aliases: ["colour"], default: true },
					help: { type: "boolean" },
					trace: { type: "boolean", negatable: true },
				})
				.action(() => {}),
		);
		expect(model.flags[0]).toMatchObject({
			name: "color",
			negatable: true,
			spellings: ["-c", "--color", "--colour", "--no-color", "--no-colour"],
		});
		expect(model.flags[1]).toMatchObject({ negatable: false, spellings: ["--help"] });
		// Accepted, but help does not offer it.
		expect(model.flags[2]).toMatchObject({ negatable: true, spellings: ["--trace"] });
	});

	it("leaves hidden flags out, and marks deprecated flags and commands", async () => {
		const model = await docs(
			new Crust("app")
				.flags({
					secret: { type: "string", hidden: true },
					old: { type: "string", deprecated: "Use --new.", hidden: true },
					legacy: { type: "boolean", deprecated: "Use --modern." },
				})
				.add(defineCommand("scan", { deprecated: "Use `scout`." }, (c) => c.action(() => {})))
				.action(() => {}),
		);
		expect(model.flags.map((flag) => [flag.name, flag.deprecated])).toEqual([
			["legacy", "Use --modern."],
		]);
		expect(model.children[0]).toMatchObject({ name: "scan", deprecated: "Use `scout`." });
	});

	it("lists an exclusive group's members as flags and shows the group in usage", async () => {
		const model = await docs(
			new Crust("app")
				.args({ name: "service", type: "string", required: true })
				.flags({
					scope: {
						type: "exclusive",
						required: true,
						flags: {
							"org-id": { type: "string", short: "o" },
							all: { type: "boolean" },
							legacy: { type: "string", hidden: true },
						},
					},
					format: {
						type: "exclusive",
						flags: { json: { type: "boolean" }, limit: { type: "integer" } },
					},
				})
				.action(() => {}),
		);
		expect(model.usage).toBe(
			"app <service> (--org-id <string> | --all) [--json | --limit <integer>]",
		);
		expect(model.usageSegments.slice(2)).toEqual([
			{ kind: "exclusive", text: "(--org-id <string> | --all)", required: true },
			{ kind: "exclusive", text: "[--json | --limit <integer>]", required: false },
		]);
		expect(model.flags.map(({ name, group, spellings }) => [name, group, spellings])).toEqual([
			["org-id", "scope", ["-o", "--org-id"]],
			["all", "scope", ["--all"]],
			["json", "format", ["--json"]],
			["limit", "format", ["--limit"]],
		]);
		// Other flags still show `[options]`.
		const withOptions = await docs(
			new Crust("app")
				.flags({
					scope: { type: "exclusive", flags: { all: { type: "boolean" } } },
					verbose: { type: "boolean" },
				})
				.action(() => {}),
		);
		expect(withOptions.usage).toBe("app [--all] [options]");
	});

	it("lists the single-dash form of one-character long spellings after the short", async () => {
		const model = await docs(
			new Crust("app")
				.flags({
					port: { type: "number", short: "p", aliases: ["P", "listen"] },
					q: { type: "boolean", aliases: ["Q"], default: true },
				})
				.action(() => {}),
		);
		expect(model.flags.map((flag) => flag.spellings)).toEqual([
			["-p", "-P", "--port", "--P", "--listen"],
			["-q", "-Q", "--q", "--Q", "--no-q", "--no-Q"],
		]);
	});

	it("lists .group() commands in code order, then the ungrouped ones", async () => {
		const leaf = (name: string) => defineCommand(name, (c) => c.action(() => {}));
		const model = await docs(
			new Crust("app")
				.add(leaf("misc"))
				.group("Core", (g) => g.add(leaf("deploy")).command("logs", (c) => c.action(() => {})))
				.group("Admin", (g) => g.add(leaf("users")))
				.group("Core", (g) => g.add(leaf("status"))),
		);
		expect(model.children.map(({ name, heading }) => [name, heading])).toEqual([
			["deploy", "Core"],
			["logs", "Core"],
			["status", "Core"],
			["users", "Admin"],
			["misc", undefined],
		]);
	});

	it("lists own and root-only Extension flags, then .group() flags in code order, then inherited flags", async () => {
		const region = defineContext("region")
			.flags({ region: { type: "string" } })
			.setup(({ flags }) => flags.region);
		const ext = defineExtension("test:ext").flags({
			trace: { type: "boolean" },
			about: { type: "boolean", recursive: false },
		});
		const model = await docs(
			new Crust("app")
				.extend(ext)
				.provide(region())
				.group("Resources", (g) =>
					g.flags({
						memory: { type: "string", valueName: "bytes" },
						mode: { type: "exclusive", flags: { fast: { type: "boolean" } } },
					}),
				)
				.flags({ verbose: { type: "boolean" } })
				.action(() => {}),
		);
		expect(
			model.flags.map(({ name, heading, inherited, valueName }) => [
				name,
				heading,
				inherited,
				valueName,
			]),
		).toEqual([
			["verbose", undefined, false, undefined],
			["about", undefined, false, undefined],
			["memory", "Resources", false, "bytes"],
			["fast", "Resources", false, undefined],
			["region", undefined, true, "string"],
			["trace", undefined, true, undefined],
		]);
	});

	it("documents examples and a schema's choices, default, and requiredness", async () => {
		const model = await docs(
			new Crust("app", { examples: ["app open", "app --state closed"] })
				.args({ name: "id", schema: z.string().regex(/^\d+$/) })
				.flags({
					state: { type: "string", schema: z.enum(["open", "closed"]).default("open") },
					labels: { type: "string", multiple: true, schema: z.array(z.enum(["bug", "docs"])) },
				})
				.action(() => {}),
		);
		expect(model.examples).toEqual(["app open", "app --state closed"]);
		expect(model.args[0]).toMatchObject({ token: "<id>", required: true });
		expect(model.flags[0]).toMatchObject({
			name: "state",
			required: false,
			choices: ["open", "closed"],
			default: "open",
		});
		expect(model.flags[1]).toMatchObject({
			name: "labels",
			required: true,
			choices: ["bug", "docs"],
		});
	});

	it("reads a list argument's schema choices from its items when it owns a key named negatable", async () => {
		const model = await docs(
			new Crust("app")
				.extend(defineExtension("owner").owns("negatable" as never))
				.args({
					name: "labels",
					variadic: true,
					schema: z.array(z.enum(["bug", "docs"])),
					...({ negatable: false } as object),
				})
				.action(() => {}),
		);
		expect(model.args[0]?.choices).toEqual(["bug", "docs"]);
	});

	it("keeps a declared default: null", async () => {
		const model = await docs(
			new Crust("app")
				.args({ name: "cfg", type: "json", default: null })
				.flags({ data: { type: "json", default: null } })
				.action(() => {}),
		);
		expect(model.args[0]?.default).toBeNull();
		expect(model.flags[0]?.default).toBeNull();
		expect(formatDescription(undefined, model.flags[0]?.default, undefined)).toBe(
			"[default: null]",
		);
	});
});
