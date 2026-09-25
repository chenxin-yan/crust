import { Crust, defineCommand, defineExtension, defineExtensionId } from "@crustjs/core";
import { describe, expect, it } from "vite-plus/test";

import { toolsFromSnapshot } from "./tools.ts";

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

	it("exposes the root under its own name only when it has an action", async () => {
		const actionless = new Crust("cli").add(defineCommand("run", (c) => c.action(noop)));
		expect(toolsFromSnapshot(await actionless.snapshot()).map((t) => t.name)).toEqual(["run"]);

		const rooted = new Crust("cli").action(noop);
		const [root] = toolsFromSnapshot(await rooted.snapshot());
		expect(root).toMatchObject({ name: "cli", path: [] });
	});

	it("maps snapshot definitions onto JSON Schema", async () => {
		const app = new Crust("cli").add(
			defineCommand("send", (c) =>
				c
					.args(
						{ name: "target", type: "string", required: true, description: "Where" },
						{ name: "level", type: "string", choices: ["low", "high"], default: "low" },
						{ name: "files", type: "path", variadic: true },
					)
					.flags(
						{ name: "count", type: "number", required: true, default: 1 },
						{ name: "dry-run", type: "boolean" },
						{ name: "origin", type: "url", multiple: true },
						{ name: "payload", type: "json", description: "Any JSON" },
						{ name: "port", type: "string", parse: Number },
						{ name: "mode", type: "string", schema: passthrough },
					)
					.action(noop),
			),
		);
		const [tool] = toolsFromSnapshot(await app.snapshot());
		expect(tool?.inputSchema).toEqual({
			type: "object",
			properties: {
				target: { type: "string", description: "Where" },
				level: { type: "string", enum: ["low", "high"], default: "low" },
				files: { type: "array", items: { type: "string" } },
				count: { type: "number", default: 1 },
				"dry-run": { type: "boolean" },
				origin: { type: "array", items: { type: "string", format: "uri" } },
				payload: { description: "Any JSON" },
				port: { type: "string" },
				mode: { type: "string" },
				raw: {
					type: "array",
					items: { type: "string" },
					description: "Passthrough values, as if written after `--`",
				},
			},
			required: ["target"],
		});
		expect(tool?.urlFields).toEqual(["origin"]);
		expect(tool?.argNames).toEqual(["target", "level", "files"]);
	});

	it("omits unserializable defaults and detaches serializable defaults for discovery", async () => {
		const cycle = { self: {} };
		cycle.self = cycle;
		const throwing = {
			get value() {
				throw new Error("default getter");
			},
		};
		const ordinary = { value: 1 };
		const app = new Crust("cli")
			.flags(
				{ name: "cycle", type: "json", default: cycle },
				{ name: "bigint", type: "json", default: 1n, required: true },
				{ name: "throwing", type: "json", default: throwing },
				{ name: "ordinary", type: "json", default: ordinary },
				{ name: "url", type: "url", default: new URL("https://example.com/") },
			)
			.action(noop);
		const tools = toolsFromSnapshot(await app.snapshot());
		const properties = tools[0]!.inputSchema.properties;
		for (const name of ["cycle", "bigint", "throwing"]) {
			expect(properties[name]).not.toHaveProperty("default");
		}
		expect(tools[0]!.inputSchema.required).toBeUndefined();
		expect(properties.ordinary?.default).toEqual(ordinary);
		expect(properties.ordinary?.default).not.toBe(ordinary);
		expect(properties.url?.default).toBe("https://example.com/");
		expect(() => JSON.stringify(tools)).not.toThrow();
	});

	it("maps schema and custom-parse definitions by token type; only declared required is required", async () => {
		const app = new Crust("cli").add(
			defineCommand("check", (c) =>
				c
					.args({ name: "id", schema: passthrough })
					.flags(
						{ name: "mode", type: "string", schema: passthrough },
						{ name: "on", type: "boolean", schema: passthrough },
						{ name: "port", type: "string", parse: Number },
						{ name: "level", type: "string", parse: Number, required: true },
					)
					.action(noop),
			),
		);
		const [tool] = toolsFromSnapshot(await app.snapshot());
		expect(tool?.inputSchema.properties).toMatchObject({
			id: { type: "string" },
			mode: { type: "string" },
			on: { type: "boolean" },
			port: { type: "string" },
			level: { type: "string" },
		});
		// Schema-owned requiredness is invisible; a custom parser's `required` is declared and kept.
		expect(tool?.inputSchema.required).toEqual(["level"]);
	});

	it("accepts prototype-named definitions as own properties", async () => {
		const app = new Crust("cli").add(
			defineCommand("probe", (c) =>
				c
					.args({ name: "__proto__", type: "string" })
					.flags(
						{ name: "constructor", type: "string" },
						{ name: "hasOwnProperty", type: "boolean" },
					)
					.action(noop),
			),
		);
		const [tool] = toolsFromSnapshot(await app.snapshot());
		const properties = tool!.inputSchema.properties;
		expect(Object.hasOwn(properties, "__proto__")).toBe(true);
		expect(Object.getPrototypeOf(properties)).toBeNull();
		expect(properties["constructor"]).toEqual({ type: "string" });
		expect(properties["hasOwnProperty"]).toEqual({ type: "boolean" });
		expect(tool!.argNames).toEqual(["__proto__"]);
	});

	it("includes Extension-contributed commands", async () => {
		const contributed = defineExtension(defineExtensionId("test:contrib"), {
			commands: [defineCommand("extra", (c) => c.action(noop))],
		});
		const app = new Crust("cli").extend(contributed);
		expect(toolsFromSnapshot(await app.snapshot()).map((t) => t.name)).toEqual(["extra"]);
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

	it("rejects an arg and flag sharing a name, or a definition named raw", async () => {
		const shared = new Crust("cli").add(
			defineCommand("x", (c) =>
				c
					.args({ name: "name", type: "string" })
					.flags({ name: "name", type: "string" })
					.action(noop),
			),
		);
		const sharedSnapshot = await shared.snapshot();
		expect(() => toolsFromSnapshot(sharedSnapshot)).toThrow(
			'Command "x" declares "name" more than once',
		);
		const raw = new Crust("cli").add(
			defineCommand("y", (c) => c.flags({ name: "raw", type: "string" }).action(noop)),
		);
		const rawSnapshot = await raw.snapshot();
		expect(() => toolsFromSnapshot(rawSnapshot)).toThrow('declares "raw" more than once');
	});
});
