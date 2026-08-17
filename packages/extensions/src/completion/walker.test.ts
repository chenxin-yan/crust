import { describe, expect, it } from "bun:test";

import { Crust, defineCommand, defineContext, defineFlag, type FlagsDef } from "@crustjs/core";
import { snapshotCommand } from "@crustjs/core/tooling";
type CommandNode = Parameters<typeof snapshotCommand>[0];

import { walkCommandNode } from "./walker.ts";

/**
 * Build a `CommandNode` tree directly via object literals.
 *
 * `createCommandNode`/`computeEffectiveFlags` are not exported from
 * `@crustjs/core`. Constructing literal nodes is the cleanest way to keep
 * walker tests focused on the walker — we don't want to be coupled to the
 * `Crust` builder's internal Context-owned flag propagation here. For each node
 * we set `effectiveFlags` explicitly so the walker observes exactly the set
 * of flags we intend.
 */
function makeNode(partial: Partial<CommandNode> & { name: string }): CommandNode {
	const flags: FlagsDef = partial.localFlags ?? {};
	return {
		meta: { name: partial.name, ...(partial.meta ?? {}) },
		localFlags: flags,
		ownedFlags: partial.ownedFlags ?? {},
		effectiveFlags: partial.effectiveFlags ?? flags,
		flagSpellings: new Map(),
		args: partial.args,
		subCommands: partial.subCommands ?? {},
		contexts: [],
		extensions: [],
		run: undefined,
	};
}

describe("walkCommandNode", () => {
	it("walks a leaf command with no flags, args, or children", () => {
		const root = makeNode({
			name: "mycli",
			meta: { name: "mycli", description: "Top-level CLI" },
		});

		const spec = walkCommandNode(snapshotCommand(root));

		expect(spec.name).toBe("mycli");
		expect(spec.description).toBe("Top-level CLI");
		expect(spec.flags).toEqual([]);
		expect(spec.args).toEqual([]);
		expect(spec.subCommands).toEqual([]);
	});

	it("captures flat flags with type, short, aliases, description, multiple, and takesValue", () => {
		const root = makeNode({
			name: "mycli",
			localFlags: {
				verbose: {
					type: "boolean",
					short: "v",
					description: "Verbose output",
				},
				name: {
					type: "string",
					description: "Name to greet",
					aliases: ["nm"],
				},
				tag: { type: "string", multiple: true },
			},
		});

		const spec = walkCommandNode(snapshotCommand(root));
		const byName = Object.fromEntries(spec.flags.map((f) => [f.name, f]));

		expect(byName.verbose).toEqual({
			name: "verbose",
			type: "boolean",
			short: "v",
			description: "Verbose output",
			takesValue: false,
		});
		expect(byName.name).toEqual({
			name: "name",
			type: "string",
			aliases: ["nm"],
			description: "Name to greet",
			takesValue: true,
		});
		expect(byName.tag).toEqual({
			name: "tag",
			type: "string",
			takesValue: true,
			multiple: true,
		});
	});

	it("captures Context-owned flags from a Core-built provider tree", () => {
		const apiKey = defineFlag("api-key", { type: "string", short: "k" });
		const auth = defineContext("auth", { flags: [apiKey] }, () => ({}));
		const app = new Crust("mycli")
			.provide(auth())
			.add(defineCommand("deploy", (command) => command.action(() => {})));

		const spec = walkCommandNode(snapshotCommand(app._node));
		expect(spec.flags.map((flag) => flag.name)).toContain("api-key");
		expect(spec.subCommands[0]?.flags.map((flag) => flag.name)).toContain("api-key");
	});

	it("captures positional args with required, variadic, type, and description", () => {
		const root = makeNode({
			name: "mycli",
			args: [
				{
					name: "input",
					type: "string",
					required: true,
					description: "Input file",
				},
				{ name: "extra", type: "string", variadic: true },
			],
		});

		const spec = walkCommandNode(snapshotCommand(root));

		expect(spec.args).toEqual([
			{
				name: "input",
				type: "string",
				required: true,
				variadic: false,
				description: "Input file",
			},
			{
				name: "extra",
				type: "string",
				required: false,
				variadic: true,
			},
		]);
	});

	it("captures choices on string flags and string args", () => {
		const root = makeNode({
			name: "mycli",
			localFlags: {
				target: { type: "string", choices: ["browser", "bun", "node"] },
			},
			args: [
				{
					name: "shell",
					type: "string",
					required: true,
					choices: ["bash", "zsh", "fish"],
				},
			],
		});

		const spec = walkCommandNode(snapshotCommand(root));
		const targetFlag = spec.flags.find((f) => f.name === "target");
		expect(targetFlag?.choices).toEqual(["browser", "bun", "node"]);
		expect(spec.args[0]?.choices).toEqual(["bash", "zsh", "fish"]);
	});

	it("walks nested subcommands recursively, surfacing Context-owned flags via effectiveFlags", () => {
		const child = makeNode({
			name: "child",
			meta: { name: "child", description: "Child command" },
			// Local flag plus a Context-owned ancestor flag pre-merged into effectiveFlags
			// (mimics what Core does at build time).
			localFlags: { local: { type: "boolean" } },
			effectiveFlags: {
				verbose: { type: "boolean", short: "v" },
				local: { type: "boolean" },
			},
		});

		const root = makeNode({
			name: "mycli",
			localFlags: { verbose: { type: "boolean", short: "v" } },
			effectiveFlags: {
				verbose: { type: "boolean", short: "v" },
			},
			subCommands: { child },
		});

		const spec = walkCommandNode(snapshotCommand(root));

		expect(spec.subCommands).toHaveLength(1);
		const childSpec = spec.subCommands[0];
		if (!childSpec) throw new Error("missing child");
		expect(childSpec.name).toBe("child");
		expect(childSpec.description).toBe("Child command");
		// Context-owned "verbose" must surface on the child too.
		const flagNames = childSpec.flags.map((f) => f.name).sort();
		expect(flagNames).toEqual(["local", "verbose"]);
	});

	it("filters subcommands marked meta.hidden recursively", () => {
		const hiddenSub = makeNode({
			name: "secret",
			meta: { name: "secret", hidden: true },
		});
		const visibleSub = makeNode({
			name: "build",
			meta: { name: "build", description: "Build artifact" },
		});
		const root = makeNode({
			name: "mycli",
			subCommands: { secret: hiddenSub, build: visibleSub },
		});

		const spec = walkCommandNode(snapshotCommand(root));

		const subNames = spec.subCommands.map((s) => s.name);
		expect(subNames).toEqual(["build"]);
	});

	it("preserves command aliases", () => {
		const child = makeNode({
			name: "issue",
			meta: { name: "issue", aliases: ["issues", "i"] },
		});
		const root = makeNode({
			name: "mycli",
			subCommands: { issue: child },
		});

		const spec = walkCommandNode(snapshotCommand(root));
		expect(spec.subCommands[0]?.aliases).toEqual(["issues", "i"]);
	});

	it("strips ANSI escape sequences from descriptions", () => {
		// Build descriptions with raw SGR codes so the test does not depend
		// on `@crustjs/style` being importable here.
		const ESC = "\x1b";
		const colored = `${ESC}[1m${ESC}[36mcolored desc${ESC}[0m`;
		const root = makeNode({
			name: "mycli",
			meta: { name: "mycli", description: colored },
			localFlags: {
				verbose: { type: "boolean", description: `${ESC}[2mverbose${ESC}[0m` },
			},
			args: [
				{
					name: "input",
					type: "string",
					description: `${ESC}[33minput desc${ESC}[0m`,
				},
			],
			subCommands: {
				kid: makeNode({
					name: "kid",
					meta: { name: "kid", description: `${ESC}[31mred kid${ESC}[0m` },
				}),
			},
		});

		const spec = walkCommandNode(snapshotCommand(root));

		expect(spec.description).toBe("colored desc");
		expect(spec.flags[0]?.description).toBe("verbose");
		expect(spec.args[0]?.description).toBe("input desc");
		expect(spec.subCommands[0]?.description).toBe("red kid");
	});

	it("drops empty descriptions instead of emitting empty strings", () => {
		const root = makeNode({
			name: "mycli",
			meta: { name: "mycli", description: "  " },
			localFlags: { foo: { type: "string", description: "" } },
		});

		const spec = walkCommandNode(snapshotCommand(root));
		expect(spec.description).toBeUndefined();
		expect(spec.flags[0]?.description).toBeUndefined();
	});
});

describe("walkCommandNode — url/path/json valueCompletion", () => {
	it("normalises url/path/json flag types to 'string' with valueCompletion intent", () => {
		const root = makeNode({
			name: "mycli",
			localFlags: {
				endpoint: { type: "url" },
				out: { type: "path" },
				config: { type: "json" },
			},
		});
		const spec = walkCommandNode(snapshotCommand(root));
		const by = Object.fromEntries(spec.flags.map((f) => [f.name, f]));

		expect(by.endpoint?.type).toBe("string");
		expect(by.endpoint?.takesValue).toBe(true);
		expect(by.endpoint?.valueCompletion).toBe("none");

		expect(by.out?.type).toBe("string");
		expect(by.out?.takesValue).toBe(true);
		expect(by.out?.valueCompletion).toBe("files");

		expect(by.config?.type).toBe("string");
		expect(by.config?.takesValue).toBe(true);
		expect(by.config?.valueCompletion).toBe("none");
	});

	it("sets valueCompletion on url/path/json positional args", () => {
		const root = makeNode({
			name: "mycli",
			args: [
				{ name: "src", type: "path" },
				{ name: "dst", type: "url" },
				{ name: "cfg", type: "json" },
			],
		});
		const spec = walkCommandNode(snapshotCommand(root));
		const [src, dst, cfg] = spec.args;
		expect(src?.type).toBe("string");
		expect(src?.valueCompletion).toBe("files");
		expect(dst?.valueCompletion).toBe("none");
		expect(cfg?.valueCompletion).toBe("none");
	});

	it("does not set valueCompletion on plain string/number/boolean flags", () => {
		const root = makeNode({
			name: "mycli",
			localFlags: {
				s: { type: "string" },
				n: { type: "number" },
				b: { type: "boolean" },
			},
		});
		const spec = walkCommandNode(snapshotCommand(root));
		for (const flag of spec.flags) {
			expect(flag.valueCompletion).toBeUndefined();
		}
	});
});
