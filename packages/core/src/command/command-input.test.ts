import { describe, expect, it } from "vite-plus/test";

import { CrustError } from "../errors.ts";
import {
	commandInputFields,
	commandInputSchema,
	parseCommandInput,
	RAW_INPUT_PROPERTY,
} from "./command-input.ts";
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
	it("maps snapshot definitions onto JSON Schema", async () => {
		const app = new Crust("cli").add(
			defineCommand("send", (c) =>
				c
					.args(
						{ name: "target", type: "string", required: true, description: "Where" },
						{ name: "level", type: "string", choices: ["low", "high"], default: "low" },
						{ name: "files", type: "path", variadic: true },
					)
					.flags({
						count: { type: "number", required: true, default: 1 },
						"dry-run": { type: "boolean" },
						origin: { type: "url", multiple: true },
						payload: { type: "json", description: "Any JSON" },
						port: { type: "string", parse: Number },
						mode: { type: "string", schema: passthrough },
					})
					.action(noop),
			),
		);
		const snapshot = await app.snapshot();
		expect(commandInputSchema(snapshot.subCommands.send!, ["send"])).toEqual({
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
				[RAW_INPUT_PROPERTY]: {
					type: "array",
					items: { type: "string" },
					description: "Passthrough values, received as `rawArgs`; they never fill arguments",
				},
			},
			required: ["target"],
		});
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
			.flags({
				cycle: { type: "json", default: cycle },
				bigint: { type: "json", default: 1n, required: true },
				throwing: { type: "json", default: throwing },
				ordinary: { type: "json", default: ordinary },
				url: { type: "url", default: new URL("https://example.com/") },
			})
			.action(noop);
		const schema = commandInputSchema(await app.snapshot(), []);
		const properties = schema.properties;
		for (const name of ["cycle", "bigint", "throwing"]) {
			expect(properties[name]).not.toHaveProperty("default");
		}
		expect(schema.required).toBeUndefined();
		expect(properties.ordinary?.default).toEqual(ordinary);
		expect(properties.ordinary?.default).not.toBe(ordinary);
		expect(properties.url?.default).toBe("https://example.com/");
		expect(() => JSON.stringify(schema)).not.toThrow();
	});

	it("omits defaults containing non-finite numbers, which JSON would publish as null", async () => {
		const app = new Crust("cli")
			.flags({
				limit: { type: "number", default: Infinity },
				bounds: { type: "number", multiple: true, default: [0, -Infinity] },
				config: { type: "json", default: { ratio: Number.NaN } },
			})
			.action(noop);
		const { properties } = commandInputSchema(await app.snapshot(), []);
		for (const name of ["limit", "bounds", "config"]) {
			expect(properties[name]).not.toHaveProperty("default");
		}
	});

	it("maps schema and custom-parse definitions by token type; only declared required is required", async () => {
		const app = new Crust("cli").add(
			defineCommand("check", (c) =>
				c
					.args({ name: "id", schema: passthrough })
					.flags({
						mode: { type: "string", schema: passthrough },
						on: { type: "boolean", schema: passthrough },
						port: { type: "string", parse: Number },
						level: { type: "string", parse: Number, required: true },
					})
					.action(noop),
			),
		);
		const schema = commandInputSchema((await app.snapshot()).subCommands.check!, ["check"]);
		expect(schema.properties).toMatchObject({
			id: { type: "string" },
			mode: { type: "string" },
			on: { type: "boolean" },
			port: { type: "string" },
			level: { type: "string" },
		});
		// Schema-owned requiredness is invisible; a custom parser's `required` is declared and kept.
		expect(schema.required).toEqual(["level"]);
	});

	it("accepts prototype-named definitions as own properties", async () => {
		const app = new Crust("cli").add(
			defineCommand("probe", (c) =>
				c
					.args({ name: "__proto__", type: "string" })
					.flags({ constructor: { type: "string" }, hasOwnProperty: { type: "boolean" } })
					.action(noop),
			),
		);
		const { properties } = commandInputSchema((await app.snapshot()).subCommands.probe!, ["probe"]);
		expect(Object.hasOwn(properties, "__proto__")).toBe(true);
		expect(Object.getPrototypeOf(properties)).toBeNull();
		expect(properties["constructor"]).toEqual({ type: "string" });
		expect(properties["hasOwnProperty"]).toEqual({ type: "boolean" });
	});

	it("rejects an arg and flag sharing a name, or a definition named raw, naming the path", async () => {
		const snapshot = await new Crust("cli")
			.add(
				defineCommand("x", (c) =>
					c
						.args({ name: "name", type: "string" })
						.flags({ name: { type: "string" } })
						.action(noop),
				),
			)
			.flags({ raw: { type: "string" } })
			.snapshot();
		expect(() => commandInputSchema(snapshot.subCommands.x!, ["x"])).toThrow(
			'Command "x" declares "name" more than once across args, flags, and "raw"; command input is one flat object',
		);
		expect(() => commandInputSchema(snapshot, [])).toThrow(
			'Command "<root>" declares "raw" more than once across args, flags, and "raw"; command input is one flat object',
		);
	});
});

describe("commandInputFields", () => {
	it("lists arg names and url fields in declaration order", async () => {
		const app = new Crust("cli")
			.args({ name: "__proto__", type: "string" }, { name: "site", type: "url" })
			.flags({ origin: { type: "url", multiple: true }, count: { type: "number" } });
		expect(commandInputFields(await app.snapshot())).toEqual({
			urlFields: ["site", "origin"],
			argNames: ["__proto__", "site"],
		});
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
