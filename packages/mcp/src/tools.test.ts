import { completion } from "@crustjs/completion";
import { Crust, defineCommand } from "@crustjs/core";
import { confirmation, help, json, jsonInput, schema } from "@crustjs/extensions";
import { describe, expect, it } from "vite-plus/test";

import { mcp } from "./extension.ts";
import { toolsFromSnapshot } from "./tools.ts";

const noop = () => {};
/** Minimal hand-rolled Standard Schema; the snapshot never sees it. */
const passthrough = {
	"~standard": { version: 1 as const, vendor: "test", validate: (value: unknown) => ({ value }) },
};

/** Standard Schema whose output converts to `jsonSchema`. */
function jsonSchemaOutput(jsonSchema: Record<string, unknown>) {
	return {
		"~standard": {
			...passthrough["~standard"],
			jsonSchema: { input: () => jsonSchema, output: () => jsonSchema },
		},
	};
}

describe("toolsFromSnapshot", () => {
	it("names tools by canonical path, skipping hidden, actionless, and mcp: false commands", async () => {
		const app = new Crust("fixture", { description: "Fixture app" })
			.extend(mcp())
			.add(
				defineCommand("deploy", { description: "Deploy", aliases: ["d"] }, (c) => c.action(noop)),
			)
			.add(
				defineCommand("group", (c) =>
					c
						.add(defineCommand("leaf", (sub) => sub.action(noop)))
						.add(
							defineCommand("dangerous", { mcp: false }, (sub) =>
								sub.action(noop).add(defineCommand("nested", (n) => n.action(noop))),
							),
						),
				),
			)
			.add(
				defineCommand("secret", { hidden: true }, (c) =>
					c.action(noop).add(defineCommand("child", (sub) => sub.action(noop))),
				),
			);
		const tools = toolsFromSnapshot(await app.snapshot());
		expect(tools.map((tool) => [tool.name, tool.path])).toEqual([
			["deploy", ["deploy"]],
			["group_leaf", ["group", "leaf"]],
		]);
		expect(tools[0]?.description).toBe("Deploy");
	});

	it("ends a deprecated command's description with its marker", async () => {
		const app = new Crust("cli").add(
			defineCommand("deploy", { description: "Deploy", deprecated: "Use ship." }, (c) =>
				c.action(noop),
			),
		);
		const [tool] = toolsFromSnapshot(await app.snapshot());
		expect(tool?.description).toBe("Deploy [deprecated: Use ship.]");
	});

	it("passes a command's mcp hints through as the tool's annotations", async () => {
		const app = new Crust("cli")
			.extend(mcp())
			.add(defineCommand("status", { mcp: { readOnlyHint: true } }, (c) => c.action(noop)))
			.add(
				defineCommand(
					"reset",
					{ mcp: { title: "Reset", destructiveHint: true, idempotentHint: true } },
					(c) => c.action(noop),
				),
			)
			.add(defineCommand("plain", (c) => c.action(noop)));
		const tools = toolsFromSnapshot(await app.snapshot());
		expect(tools.map((tool) => [tool.name, tool.annotations])).toEqual([
			["status", { readOnlyHint: true }],
			["reset", { title: "Reset", destructiveHint: true, idempotentHint: true }],
			["plain", undefined],
		]);
		expect(tools[2]).not.toHaveProperty("annotations");
	});

	it("rejects include paths that are not canonical command paths, listing each", async () => {
		const app = new Crust("cli")
			.add(defineCommand("deploy", { aliases: ["d"] }, (c) => c.action(noop)))
			.add(defineCommand("secret", { hidden: true }, (c) => c.action(noop)));
		const snapshot = await app.snapshot();
		expect(() => toolsFromSnapshot(snapshot, { include: [["dpeloy"], ["d"], ["deploy"]] })).toThrow(
			'Unknown MCP include paths "dpeloy", "d"; include takes canonical command paths',
		);
		// [""] is not the root path [].
		expect(() => toolsFromSnapshot(snapshot, { include: [[""]] })).toThrow(
			"Unknown MCP include paths",
		);
		// A hidden command is still a real command.
		expect(toolsFromSnapshot(snapshot, { include: [["secret"]] }).map((tool) => tool.name)).toEqual(
			["deploy"],
		);
	});

	it("serves Extension commands only when included, and never Extension flags", async () => {
		const app = new Crust("cli", { description: "CLI", version: "1.0.0" })
			.extend(help(), jsonInput(), json(), completion(), schema())
			.extend(mcp())
			.add(defineCommand("work", (c) => c.flags({ fast: { type: "boolean" } }).action(noop)));
		const snapshot = await app.snapshot();
		const tools = toolsFromSnapshot(snapshot);
		expect(tools.map((tool) => tool.name)).toEqual(["work"]);
		expect(Object.keys(tools[0]!.inputSchema.properties)).toEqual(["fast"]);
		expect(
			toolsFromSnapshot(snapshot, { include: [["schema"], ["mcp"], ["mcp", "config"]] }).map(
				(tool) => tool.name,
			),
		).toEqual(["work", "schema"]);
		expect(() => toolsFromSnapshot(snapshot, { include: [["skills"]] })).toThrow(
			'Unknown MCP include paths "skills"; include takes canonical command paths',
		);
	});

	it("exposes the root under its own name only when it has an action", async () => {
		const actionless = new Crust("cli").add(defineCommand("run", (c) => c.action(noop)));
		expect(toolsFromSnapshot(await actionless.snapshot()).map((t) => t.name)).toEqual(["run"]);

		const rooted = new Crust("cli").action(noop);
		const [root] = toolsFromSnapshot(await rooted.snapshot());
		expect(root).toMatchObject({ name: "cli", path: [] });
	});

	it("rejects tool-name collisions after filtering, naming both paths", async () => {
		const colliding = new Crust("cli")
			.add(defineCommand("a_b", (c) => c.action(noop)))
			.add(defineCommand("a", (c) => c.add(defineCommand("b", (sub) => sub.action(noop)))));
		const collidingSnapshot = await colliding.snapshot();
		expect(() => toolsFromSnapshot(collidingSnapshot)).toThrow(
			'Commands "a_b" and "a b" both become MCP tool "a_b"',
		);
		const kept = new Crust("cli")
			.extend(mcp())
			.add(defineCommand("a_b", (c) => c.action(noop)))
			.add(
				defineCommand("a", { mcp: false }, (c) =>
					c.add(defineCommand("b", (sub) => sub.action(noop))),
				),
			);
		expect(toolsFromSnapshot(await kept.snapshot())).toHaveLength(1);

		const rootClash = new Crust("cli")
			.action(noop)
			.add(defineCommand("cli", (c) => c.action(noop)));
		const rootClashSnapshot = await rootClash.snapshot();
		expect(() => toolsFromSnapshot(rootClashSnapshot)).toThrow(
			'Commands "<root>" and "cli" both become MCP tool "cli"',
		);
	});

	it("rejects names outside the MCP tool-name character set", async () => {
		const app = new Crust("cli").add(defineCommand("do:it", (c) => c.action(noop)));
		const appSnapshot = await app.snapshot();
		expect(() => toolsFromSnapshot(appSnapshot)).toThrow(
			'Command "do:it" would become MCP tool "do:it"',
		);
	});

	it("lists confirmation()'s yes input only on tools whose command uses confirmation", async () => {
		const app = new Crust("fixture")
			.extend(confirmation())
			.add(defineCommand("drop", (c) => c.use(confirmation).action(noop)))
			.add(defineCommand("list", (c) => c.action(noop)));
		const properties = Object.fromEntries(
			toolsFromSnapshot(await app.snapshot()).map(({ name, inputSchema }) => [
				name,
				Object.keys(inputSchema.properties),
			]),
		);
		expect(properties).toEqual({ drop: ["yes"], list: [] });
	});

	it("advertises output schemas in the shape structuredContent takes", async () => {
		const DIALECT = "https://json-schema.org/draft/2020-12/schema";
		const node = { type: "object", properties: { name: { type: "string" } } };
		const app = new Crust("cli")
			.command("user", (c) =>
				c.output(jsonSchemaOutput({ $schema: DIALECT, ...node })).action(() => ({})),
			)
			.command("count", (c) =>
				c.output(jsonSchemaOutput({ $schema: DIALECT, type: "number" })).action(() => 1),
			)
			.command("tree", (c) =>
				c
					.output(
						jsonSchemaOutput({
							type: "array",
							items: { $ref: "#/$defs/Node" },
							$defs: { Node: node },
						}),
					)
					.action(() => []),
			)
			.command("maybe", (c) =>
				c.output(jsonSchemaOutput({ anyOf: [node, { type: "null" }] })).action(() => null),
			)
			.command("loop", (c) =>
				c.output(jsonSchemaOutput({ type: "array", items: { $ref: "#" } })).action(() => []),
			)
			.command("pointer", (c) =>
				c
					.output(
						jsonSchemaOutput({
							type: "array",
							prefixItems: [{ type: "string" }],
							items: { $ref: "#/prefixItems/0" },
						}),
					)
					.action(() => []),
			)
			.command("plain", (c) => c.output(passthrough).action(() => 1));
		const outputs = Object.fromEntries(
			toolsFromSnapshot(await app.snapshot()).map((tool) => [tool.name, tool.outputSchema]),
		);
		expect(outputs).toEqual({
			user: { $schema: DIALECT, ...node },
			count: {
				$schema: DIALECT,
				type: "object",
				properties: { result: { type: "number" } },
				required: ["result"],
			},
			tree: {
				type: "object",
				properties: { result: { type: "array", items: { $ref: "#/$defs/Node" } } },
				required: ["result"],
				$defs: { Node: node },
			},
			// Results may be objects or not, so structuredContent may or may not be wrapped.
			maybe: undefined,
			// `#` and `#/prefixItems/0` would resolve against the wrapper.
			loop: undefined,
			pointer: undefined,
			plain: undefined,
		});
	});

	it("rejects a command whose flat input would declare a name twice", async () => {
		const shared = new Crust("cli").add(
			defineCommand("x", (c) =>
				c
					.args({ name: "name", type: "string" })
					.flags({ name: { type: "string" } })
					.action(noop),
			),
		);
		const sharedSnapshot = await shared.snapshot();
		expect(() => toolsFromSnapshot(sharedSnapshot)).toThrow(
			'Command "x" declares "name" more than once',
		);
	});
});
