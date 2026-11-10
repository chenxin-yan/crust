import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

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

/** Standard Schema whose input converts to `jsonSchema`. */
function withInputJsonSchema(jsonSchema: Record<string, unknown>) {
	return {
		"~standard": {
			...passthrough["~standard"],
			jsonSchema: { input: () => jsonSchema, output: () => ({}) },
		},
	};
}

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

	it("advertises JSON.stringify copies of defaults, dropping nested entries JSON cannot hold", async () => {
		const app = new Crust("cli")
			.flags({
				config: { type: "json", default: { keep: 1, gone: undefined, fn: noop } },
			})
			.action(noop);
		const { properties } = commandInputSchema(await app.snapshot(), []);
		expect(properties.config?.default).toEqual({ keep: 1 });
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

	it("advertises a schema's input JSON Schema when run() accepts its type", async () => {
		const app = new Crust("cli")
			.args(
				{ name: "level", schema: z.enum(["low", "high"]), description: "How loud" },
				{ name: "names", schema: z.array(z.string().min(3)), variadic: true },
			)
			.flags({
				endpoint: { type: "string", schema: z.url().describe("Where to send") },
				label: { type: "string", schema: z.string().min(3).default("abc") },
				on: { type: "boolean", schema: z.boolean() },
				contact: { type: "string", schema: z.email() },
				confirm: {
					type: "boolean",
					schema: withInputJsonSchema({ type: "boolean", enum: [true] }),
				},
			})
			.action(noop);
		const { properties } = commandInputSchema(await app.snapshot(), []);
		expect(properties).toMatchObject({
			level: { type: "string", enum: ["low", "high"], description: "How loud" },
			names: { type: "array", items: { type: "string", minLength: 3 } },
			endpoint: { type: "string", format: "uri", description: "Where to send" },
			label: { type: "string", minLength: 3, default: "abc" },
			on: { type: "boolean" },
			contact: { type: "string", format: "email" },
			confirm: { type: "boolean", enum: [true] },
		});
		for (const name of ["level", "names", "endpoint", "label", "on", "contact"]) {
			expect(properties[name]).not.toHaveProperty("$schema");
		}
	});

	it("maps a schema whose JSON Schema run() would reject by its token type", async () => {
		const node = z.object({ name: z.string() });
		// Type-compatible, but its `$ref` would resolve against the command input schema's root.
		const referencing = withInputJsonSchema({
			type: "string",
			allOf: [{ $ref: "#/$defs/Name" }],
			$defs: { Name: { minLength: 1 } },
		});
		const app = new Crust("cli")
			// @ts-expect-error -- a variadic hands its schema string[]; only the JSON Schema mapping is tested
			.args({ name: "ids", schema: z.string(), variadic: true })
			.flags({
				port: { type: "string", schema: z.coerce.number(), description: "Port" },
				any: { type: "string", schema: z.union([z.string(), z.number()]) },
				when: { type: "string", schema: z.coerce.date() },
				ref: { type: "string", schema: referencing },
				// @ts-expect-error -- run() binds strings, never objects
				tags: { type: "string", multiple: true, schema: z.array(node) },
				// `items` covers only the rest; the numeric prefix would fail string binding.
				pair: {
					type: "string",
					multiple: true,
					schema: z.tuple([z.coerce.number()], z.string()),
				},
			})
			.action(noop);
		const { properties } = commandInputSchema(await app.snapshot(), []);
		expect(properties).toMatchObject({
			ids: { type: "array", items: { type: "string" } },
			port: { type: "string", description: "Port" },
			any: { type: "string" },
			when: { type: "string" },
			ref: { type: "string" },
			tags: { type: "array", items: { type: "string" } },
		});
		expect(properties.port).toEqual({ type: "string", description: "Port" });
		expect(properties.ref).toEqual({ type: "string" });
		expect(properties.pair).toEqual({ type: "array", items: { type: "string" } });
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

	it("rejects an invalid URL with PARSE, without the value or a cause", async () => {
		const snapshot = await sendSnapshot();
		for (const values of [{ home: "s3cr3t" }, { origin: ["https://a.example/", "s3cr3t"] }]) {
			const name = Object.keys(values)[0];
			const error = (() => {
				try {
					parseCommandInput(snapshot, values);
				} catch (caught) {
					return caught;
				}
			})();
			expect(error).toEqual(
				new CrustError(
					"PARSE",
					`Invalid URL for --${name} (missing protocol — e.g. https://example.com).`,
				),
			);
			expect(error).toHaveProperty("cause", undefined);
		}
	});
});
