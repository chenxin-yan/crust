import { describe, expect, it } from "vite-plus/test";

import { CrustError } from "../errors.ts";
import { commandInputSchema, parseCommandInput, RAW_INPUT_PROPERTY } from "./command-input.ts";
import { Crust, defineCommand } from "./crust.ts";

const noop = () => {};
/** Minimal hand-rolled Standard Schema; the snapshot never sees it. */
const passthrough = {
	"~standard": { version: 1 as const, vendor: "test", validate: (value: unknown) => ({ value }) },
};

const send = defineCommand("send", (c) =>
	c
		.args(
			{ name: "target", type: "string", required: true, description: "Where" },
			{ name: "level", type: "string", choices: ["low", "high"], default: "low" },
			{ name: "files", type: "path", variadic: true },
		)
		.flags({
			count: { type: "number", default: 1 },
			"dry-run": { type: "boolean" },
			origin: { type: "url", multiple: true },
			home: { type: "url" },
			payload: { type: "json", description: "Any JSON" },
			port: { type: "string", parse: Number },
			mode: { type: "string", schema: passthrough },
		})
		.action(noop),
);

async function sendSnapshot() {
	return (await new Crust("cli").add(send).snapshot()).subCommands.send!;
}

describe("commandInputSchema", () => {
	it("maps args, flags, and the raw passthrough onto one flat JSON Schema object", async () => {
		expect(commandInputSchema(await sendSnapshot(), ["send"])).toEqual({
			type: "object",
			properties: {
				target: { type: "string", description: "Where" },
				level: { type: "string", enum: ["low", "high"], default: "low" },
				files: { type: "array", items: { type: "string" } },
				count: { type: "number", default: 1 },
				"dry-run": { type: "boolean" },
				origin: { type: "array", items: { type: "string", format: "uri" } },
				home: { type: "string", format: "uri" },
				payload: { description: "Any JSON" },
				port: { type: "string" },
				mode: { type: "string" },
				[RAW_INPUT_PROPERTY]: {
					type: "array",
					items: { type: "string" },
					description: "Passthrough values, received as `rawArgs`; they never fill arguments",
				},
			},
			required: ["target"],
		});
	});

	it("omits defaults JSON cannot represent faithfully", async () => {
		const cycle = { self: {} };
		cycle.self = cycle;
		const snapshot = await new Crust("cli")
			.flags({
				cycle: { type: "json", default: cycle },
				limit: { type: "number", default: Infinity },
				url: { type: "url", default: new URL("https://example.com/") },
			})
			.snapshot();
		const { properties } = commandInputSchema(snapshot, []);
		expect(properties.cycle).not.toHaveProperty("default");
		expect(properties.limit).not.toHaveProperty("default");
		expect(properties.url?.default).toBe("https://example.com/");
	});

	it("rejects names claimed twice, naming the command path", async () => {
		const snapshot = await new Crust("cli")
			.add(
				defineCommand("x", (c) =>
					c
						.args({ name: "name", type: "string" })
						.flags({ name: { type: "string" } })
						.action(noop),
				),
			)
			.add(defineCommand("y", (c) => c.flags({ raw: { type: "string" } }).action(noop)))
			.snapshot();
		expect(() => commandInputSchema(snapshot.subCommands.x!, ["x"])).toThrow(
			'Command "x" declares "name" more than once across args, flags, and "raw"',
		);
		expect(() => commandInputSchema(snapshot.subCommands.y!, [])).toThrow(
			'Command "<root>" declares "raw" more than once',
		);
	});
});

describe("parseCommandInput", () => {
	it("splits flat input into args and flags, building URLs and passing raw through", async () => {
		const input = parseCommandInput(await sendSnapshot(), {
			target: "prod",
			files: ["a", "b"],
			count: 2,
			origin: ["https://a.example/", "https://b.example/"],
			home: "https://home.example/",
			payload: { nested: [1, null] },
			skipped: undefined,
			[RAW_INPUT_PROPERTY]: ["--dry-run"],
		});
		expect(input).toEqual({
			args: { target: "prod", files: ["a", "b"] },
			flags: {
				count: 2,
				origin: [new URL("https://a.example/"), new URL("https://b.example/")],
				home: new URL("https://home.example/"),
				payload: { nested: [1, null] },
			},
			raw: ["--dry-run"],
		});
		expect(Object.getPrototypeOf(input.args)).toBeNull();
		expect(Object.getPrototypeOf(input.flags)).toBeNull();
	});

	it("leaves unknown names to run() validation and omits raw when absent", async () => {
		expect(parseCommandInput(await sendSnapshot(), { unknown: 1 })).toEqual({
			args: {},
			flags: { unknown: 1 },
		});
	});

	it("binds prototype-named definitions as own properties", async () => {
		const snapshot = await new Crust("cli")
			.args({ name: "__proto__", type: "string" })
			.flags({ constructor: { type: "string" } })
			.snapshot();
		const input = parseCommandInput(snapshot, JSON.parse('{"__proto__":"p","constructor":"c"}'));
		expect(Object.hasOwn(input.args!, "__proto__")).toBe(true);
		expect(input.args!["__proto__"]).toBe("p");
		expect(input.flags!["constructor"]).toBe("c");
	});

	it.each([
		["a non-JSON value", { target: new Date(0) }, 'Expected a JSON value for "target"'],
		["a non-finite number", { count: Number.NaN }, 'Expected a JSON value for "count"'],
		[
			"raw that is not a string array",
			{ raw: ["ok", 1] },
			'Expected an array of strings for "raw"',
		],
	])("rejects %s with PARSE", async (_label, values, message) => {
		const snapshot = await sendSnapshot();
		expect(() => parseCommandInput(snapshot, values)).toThrow(new CrustError("PARSE", message));
	});

	it("lets an invalid URL throw the URL constructor's TypeError", async () => {
		const snapshot = await sendSnapshot();
		expect(() => parseCommandInput(snapshot, { home: "nope" })).toThrow(TypeError);
	});
});
