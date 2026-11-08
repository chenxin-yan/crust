import { Crust, defineCommand } from "@crustjs/core";
import { commandInputFields, commandInputSchema } from "@crustjs/core/tooling";
import { describe, expect, it } from "vite-plus/test";

import { RAW_PROPERTY, toolsFromSnapshot } from "./tools.ts";

const noop = () => {};
/** Minimal hand-rolled Standard Schema; the snapshot never sees it. */
const passthrough = {
	"~standard": { version: 1 as const, vendor: "test", validate: (value: unknown) => ({ value }) },
};

describe("toolsFromSnapshot", () => {
	it("names tools by canonical path, skipping hidden, actionless, excluded, and mcp commands", async () => {
		const app = new Crust("fixture", { description: "Fixture app" })
			.add(
				defineCommand("deploy", { description: "Deploy", aliases: ["d"] }, (c) => c.action(noop)),
			)
			.add(
				defineCommand("group", (c) =>
					c
						.add(defineCommand("leaf", (sub) => sub.action(noop)))
						.add(
							defineCommand("dangerous", (sub) =>
								sub.action(noop).add(defineCommand("nested", (n) => n.action(noop))),
							),
						),
				),
			)
			.add(
				defineCommand("secret", { hidden: true }, (c) =>
					c.action(noop).add(defineCommand("child", (sub) => sub.action(noop))),
				),
			)
			.add(defineCommand("mcp", (c) => c.action(noop)));
		const tools = toolsFromSnapshot(await app.snapshot(), { exclude: [["group", "dangerous"]] });
		expect(tools.map((tool) => [tool.name, tool.path])).toEqual([
			["deploy", ["deploy"]],
			["group_leaf", ["group", "leaf"]],
		]);
		expect(tools[0]?.description).toBe("Deploy");
	});

	it("rejects exclude paths that are not canonical command paths, listing each", async () => {
		const app = new Crust("cli")
			.add(defineCommand("deploy", { aliases: ["d"] }, (c) => c.action(noop)))
			.add(
				defineCommand("group", (c) =>
					c.add(defineCommand("leaf", (sub) => sub.action(noop))).action(noop),
				),
			)
			.add(defineCommand("secret", { hidden: true }, (c) => c.action(noop)));
		const snapshot = await app.snapshot();
		expect(() => toolsFromSnapshot(snapshot, { exclude: [["dpeloy"], ["d"], ["deploy"]] })).toThrow(
			'Unknown MCP exclude paths "dpeloy", "d"; exclude takes canonical command paths',
		);
		// [""] is not the root path [], so it must not exclude the whole tree.
		expect(() => toolsFromSnapshot(snapshot, { exclude: [[""]] })).toThrow(
			"Unknown MCP exclude paths",
		);
		// Paths under an excluded parent or a hidden command are still real commands.
		expect(
			toolsFromSnapshot(snapshot, {
				exclude: [["group"], ["group", "leaf"], ["secret"]],
			}).map((tool) => tool.name),
		).toEqual(["deploy"]);
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
		expect(toolsFromSnapshot(collidingSnapshot, { exclude: [["a"]] })).toHaveLength(1);

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

	it("takes each tool's input schema and split metadata from core tooling", async () => {
		const app = new Crust("cli").add(
			defineCommand("send", (c) =>
				c
					.args({ name: "target", type: "string", required: true })
					.flags({
						origin: { type: "url", multiple: true },
						mode: { type: "string", schema: passthrough },
					})
					.action(noop),
			),
		);
		const snapshot = await app.snapshot();
		const command = snapshot.subCommands.send!;
		expect(toolsFromSnapshot(snapshot)).toEqual([
			{
				name: "send",
				inputSchema: commandInputSchema(command, ["send"]),
				urlFields: ["origin"],
				argNames: ["target"],
				path: ["send"],
			},
		]);
		expect(commandInputFields(command)).toEqual({ urlFields: ["origin"], argNames: ["target"] });
		expect(RAW_PROPERTY).toBe("raw");
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
