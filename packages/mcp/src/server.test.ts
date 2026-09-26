import {
	type AnyCrust,
	Crust,
	CrustError,
	defineCommand,
	defineContext,
	defineExtension,
	defineExtensionId,
	type RunOutcome,
} from "@crustjs/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createMcpServer, DEFAULT_SERVER_VERSION, toolResultFromOutcome } from "./server.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function connect(app: AnyCrust, exclude?: readonly (readonly string[])[]) {
	const server = await createMcpServer(app, exclude ? { exclude } : {});
	const client = new Client({ name: "test-client", version: "0.0.0" });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
	cleanups.push(async () => {
		await client.close();
		await server.close();
	});
	return client;
}

const finisher = defineExtension(defineExtensionId("test:finisher"))
	.flags({ name: "bail", type: "boolean" })
	.preRun((ctx) => {
		if (ctx.flags.bail === true) {
			ctx.stdout("bailed");
			return ctx.finish();
		}
	});

const contributed = defineExtension(defineExtensionId("test:contrib")).add(
	defineCommand("extra", { description: "From an Extension" }, (c) =>
		c.action(() => ({ from: "extension" })),
	),
);

const fixture = new Crust("fixture", { description: "Fixture", version: "1.2.3" })
	.add(
		defineCommand("echo", { description: "Echo input" }, (c) =>
			c
				.args({ name: "word", type: "string", required: true })
				.flags(
					{ name: "times", type: "number", default: 1 },
					{ name: "origin", type: "url" },
					{ name: "tag", type: "string", multiple: true },
				)
				.action(({ args, flags, rawArgs }) => ({
					word: args.word.repeat(flags.times),
					origin: flags.origin?.href,
					tags: flags.tag,
					rawArgs,
				})),
		),
	)
	.add(
		defineCommand("print", (c) =>
			c.action(({ stdout, stderr }) => {
				stdout("plain output");
				stderr("noise");
			}),
		),
	)
	.add(defineCommand("date", (c) => c.action(() => new Date(0))))
	.add(defineCommand("scalar", (c) => c.action(() => 42)))
	.add(
		defineCommand("fail", (c) =>
			c.flags({ name: "plain", type: "boolean" }).action(({ flags }) => {
				if (flags.plain) throw new Error("boom");
				throw new CrustError("VALIDATION", "custom failure");
			}),
		),
	)
	.add(
		defineCommand("slow", (c) =>
			c.args({ name: "id", type: "string", required: true }).action(async ({ args, stdout }) => {
				stdout(`start ${args.id}`);
				await new Promise((resolve) => setTimeout(resolve, args.id === "a" ? 30 : 1));
				stdout(`end ${args.id}`);
				return { id: args.id };
			}),
		),
	)
	.add(defineCommand("secret", { hidden: true }, (c) => c.action(() => "hidden")))
	.extend(finisher)
	.extend(contributed);

describe("createMcpServer", () => {
	it("advertises the root identity and the filtered tool manifest", async () => {
		const client = await connect(fixture, [["date"]]);
		expect(client.getServerVersion()).toMatchObject({ name: "fixture", version: "1.2.3" });
		const { tools } = await client.listTools();
		expect(tools.map((tool) => tool.name)).toEqual([
			"echo",
			"print",
			"scalar",
			"fail",
			"slow",
			"extra",
		]);
		expect(tools[0]).toMatchObject({
			description: "Echo input",
			inputSchema: {
				type: "object",
				required: ["word"],
				properties: { origin: { type: "string", format: "uri" } },
			},
		});
	});

	it("falls back to a default version", async () => {
		const client = await connect(new Crust("bare").action(() => "ok"));
		expect(client.getServerVersion()).toMatchObject({
			name: "bare",
			version: DEFAULT_SERVER_VERSION,
		});
	});

	it("runs typed input, converting url fields and passing raw through", async () => {
		const client = await connect(fixture);
		const result = await client.callTool({
			name: "echo",
			arguments: {
				word: "ab",
				times: 2,
				origin: "https://example.com/x",
				tag: ["one", "two"],
				raw: ["--dry-run"],
			},
		});
		const expected = {
			word: "abab",
			origin: "https://example.com/x",
			tags: ["one", "two"],
			rawArgs: ["--dry-run"],
		};
		expect(result.isError).toBeUndefined();
		expect(result.structuredContent).toEqual(expected);
		expect(result.content).toEqual([{ type: "text", text: JSON.stringify(expected, null, 2) }]);
	});

	it("accepts -0 input, which JSON.parse can produce", async () => {
		const client = await connect(fixture);
		const result = await client.callTool({
			name: "echo",
			arguments: { word: "ab", times: -0, origin: "https://example.com/", tag: ["t"], raw: [] },
		});
		expect(result.isError).toBeUndefined();
		expect(result.structuredContent).toEqual({
			word: "",
			origin: "https://example.com/",
			tags: ["t"],
			rawArgs: [],
		});
	});

	it("reaches Extension-contributed commands", async () => {
		const client = await connect(fixture);
		const result = await client.callTool({ name: "extra" });
		expect(result.structuredContent).toEqual({ from: "extension" });
	});

	it("wraps JSON scalars and returns captured stdout for non-JSON results", async () => {
		const client = await connect(fixture);
		const scalar = await client.callTool({ name: "scalar" });
		expect(scalar.structuredContent).toEqual({ result: 42 });
		expect(scalar.content).toEqual([{ type: "text", text: "42" }]);

		const printed = await client.callTool({ name: "print" });
		expect(printed.structuredContent).toBeUndefined();
		expect(printed.content).toEqual([{ type: "text", text: "plain output" }]);

		const date = await client.callTool({ name: "date" });
		expect(date.structuredContent).toBeUndefined();
		expect(date.content).toEqual([{ type: "text", text: "" }]);
	});

	it("reports Crust validation, thrown errors, and input shaping as tool errors", async () => {
		const client = await connect(fixture);
		const missing = await client.callTool({ name: "echo", arguments: {} });
		expect(missing).toMatchObject({
			isError: true,
			content: [{ type: "text", text: 'VALIDATION: Missing required argument "<word>"' }],
		});
		const wrongType = await client.callTool({ name: "echo", arguments: { word: 1 } });
		expect(wrongType).toMatchObject({
			isError: true,
			content: [{ type: "text", text: "PARSE: Expected string for <word>" }],
		});
		const crust = await client.callTool({ name: "fail" });
		expect(crust).toMatchObject({
			isError: true,
			content: [{ type: "text", text: "VALIDATION: custom failure" }],
		});
		const plain = await client.callTool({ name: "fail", arguments: { plain: true } });
		expect(plain).toMatchObject({
			isError: true,
			content: [{ type: "text", text: "Error: boom" }],
		});
		const badUrl = await client.callTool({
			name: "echo",
			arguments: { word: "x", origin: "not a url" },
		});
		expect(badUrl.isError).toBe(true);
		expect(badUrl.content).toEqual([{ type: "text", text: expect.stringMatching(/^TypeError: /) }]);
		const badRaw = await client.callTool({ name: "echo", arguments: { word: "x", raw: "nope" } });
		expect(badRaw).toMatchObject({
			isError: true,
			content: [{ type: "text", text: 'PARSE: Expected an array of strings for "raw"' }],
		});
	});

	it("returns captured stdout when an Extension finishes the invocation", async () => {
		const client = await connect(fixture);
		const result = await client.callTool({ name: "print", arguments: { bail: true } });
		expect(result.content).toEqual([{ type: "text", text: "bailed" }]);
	});

	it("forwards cancellation per invocation and closes active Contexts on disconnect", async () => {
		const calls = Array.from({ length: 2 }, () => ({
			started: Promise.withResolvers<AbortSignal>(),
			disposed: Promise.withResolvers<void>(),
		}));
		const session = defineContext(
			"session",
			{ flags: [{ name: "id", type: "number", required: true }] },
			({ flags, defer }) => {
				const call = calls[flags.id]!;
				defer(() => call.disposed.resolve());
				return call;
			},
		);
		const app = new Crust("cancellation").add(
			defineCommand("wait", (c) =>
				c.provide(session()).action(async ({ ctx, signal }) => {
					const call = await ctx.session;
					await new Promise<void>((resolve) => {
						signal.addEventListener("abort", () => resolve(), { once: true });
						call.started.resolve(signal);
					});
					signal.throwIfAborted();
				}),
			),
		);
		const client = await connect(app);
		const controller = new AbortController();
		const first = Promise.allSettled([
			client.callTool({ name: "wait", arguments: { id: 0 } }, undefined, {
				signal: controller.signal,
			}),
		]);
		const second = Promise.allSettled([client.callTool({ name: "wait", arguments: { id: 1 } })]);
		const [firstSignal, secondSignal] = await Promise.all(
			calls.map((call) => call.started.promise),
		);
		controller.abort(new Error("cancelled by test"));
		expect(await first).toMatchObject([
			{ status: "rejected", reason: { message: expect.stringContaining("cancelled by test") } },
		]);
		expect(firstSignal!.aborted).toBe(true);
		expect(secondSignal!.aborted).toBe(false);
		await calls[0]!.disposed.promise;
		await client.close();
		expect(await second).toMatchObject([{ status: "rejected", reason: expect.any(Error) }]);
		expect(secondSignal!.aborted).toBe(true);
		await calls[1]!.disposed.promise;
	});

	it("captures Context setup and disposal output per call under concurrency", async () => {
		const session = defineContext(
			"session",
			{ flags: [{ name: "id", type: "string", required: true }] },
			async ({ flags, stdout, defer }) => {
				stdout(`open ${flags.id}`);
				await new Promise((resolve) => setTimeout(resolve, flags.id === "a" ? 20 : 1));
				defer(() => stdout(`close ${flags.id}`));
				return { id: flags.id };
			},
		);
		const app = new Crust("ctx").add(
			defineCommand("session", (c) =>
				c.provide(session()).action(async ({ ctx, stdout }) => {
					const { id } = await ctx.session;
					stdout(`work ${id}`);
				}),
			),
		);
		const client = await connect(app);
		const stdoutWrite = process.stdout.write;
		let liveWrites = 0;
		process.stdout.write = () => {
			liveWrites++;
			return true;
		};
		try {
			const [a, b] = await Promise.all([
				client.callTool({ name: "session", arguments: { id: "a" } }),
				client.callTool({ name: "session", arguments: { id: "b" } }),
			]);
			expect(a.content).toEqual([{ type: "text", text: "open a\nwork a\nclose a" }]);
			expect(b.content).toEqual([{ type: "text", text: "open b\nwork b\nclose b" }]);
		} finally {
			process.stdout.write = stdoutWrite;
		}
		expect(liveWrites).toBe(0);
	});

	it("binds prototype-named args and flags as own properties", async () => {
		// `__proto__` itself never crosses the SDK: its request parsing drops the key
		// before the handler runs. The manifest side is covered in tools.test.ts.
		const app = new Crust("proto").add(
			defineCommand("probe", (c) =>
				c
					.args({ name: "hasOwnProperty", type: "string", required: true })
					.flags({ name: "constructor", type: "string" }, { name: "toString", type: "number" })
					.action(({ args, flags }) => ({
						own: args.hasOwnProperty,
						constructor: flags.constructor ?? null,
						toString: flags.toString ?? null,
					})),
			),
		);
		const client = await connect(app);
		const { tools } = await client.listTools();
		expect(Object.keys(tools[0]!.inputSchema.properties!)).toEqual([
			"hasOwnProperty",
			"constructor",
			"toString",
			"raw",
		]);
		expect(tools[0]!.inputSchema.required).toEqual(["hasOwnProperty"]);
		const result = await client.callTool({
			name: "probe",
			arguments: { hasOwnProperty: "p", constructor: "c", toString: 7 },
		});
		expect(result.structuredContent).toEqual({ own: "p", constructor: "c", toString: 7 });
		// Omitting them must not read Object.prototype as supplied values.
		const omitted = await client.callTool({ name: "probe", arguments: { hasOwnProperty: "p" } });
		expect(omitted.structuredContent).toEqual({ own: "p", constructor: null, toString: null });
	});

	it("rejects unknown and hidden tools at the protocol level", async () => {
		const client = await connect(fixture);
		await expect(client.callTool({ name: "secret" })).rejects.toThrow("Tool secret not found");
	});

	it("keeps concurrent calls isolated and off process stdout", async () => {
		const client = await connect(fixture);
		const stdoutWrite = process.stdout.write;
		let liveWrites = 0;
		process.stdout.write = () => {
			liveWrites++;
			return true;
		};
		try {
			const [a, b] = await Promise.all([
				client.callTool({ name: "slow", arguments: { id: "a" } }),
				client.callTool({ name: "slow", arguments: { id: "b" } }),
			]);
			expect(a.structuredContent).toEqual({ id: "a" });
			expect(b.structuredContent).toEqual({ id: "b" });
		} finally {
			process.stdout.write = stdoutWrite;
		}
		expect(liveWrites).toBe(0);
	});
});

interface Cyclic {
	self?: Cyclic;
}

describe("toolResultFromOutcome", () => {
	type CompletedResult = Extract<RunOutcome<unknown>, { status: "completed" }>["result"];
	const completed = (result: CompletedResult) => ({
		status: "completed" as const,
		result,
		stdout: "out",
		stderr: "",
	});

	it("falls back to stdout when a result getter throws", () => {
		const result = {
			get value() {
				throw new Error("result getter");
			},
		};
		expect(toolResultFromOutcome(completed(result))).toEqual({
			content: [{ type: "text", text: "out" }],
		});
	});

	it.each([
		["undefined", undefined],
		["a Date", new Date(0)],
	])("captures each result getter once, even if it would later return %s", (_label, later) => {
		let reads = 0;
		const result = {
			get value() {
				return ++reads === 1 ? 1 : later;
			},
		};
		const response = toolResultFromOutcome(completed(result));
		// Round-trip like a transport would; it must not reach the action's getter.
		expect(JSON.parse(JSON.stringify(response))).toEqual({
			content: [{ type: "text", text: JSON.stringify({ value: 1 }, null, 2) }],
			structuredContent: { value: 1 },
		});
		expect(reads).toBe(1);
	});

	it("captures a shared object's getters once for every reference", () => {
		let reads = 0;
		const shared = {
			get value() {
				return ++reads;
			},
		};
		const response = toolResultFromOutcome(completed({ first: shared, second: shared }));
		const captured = { first: { value: 1 }, second: { value: 1 } };
		expect(JSON.parse(JSON.stringify(response))).toEqual({
			content: [{ type: "text", text: JSON.stringify(captured, null, 2) }],
			structuredContent: captured,
		});
		expect(reads).toBe(1);
	});

	it("falls back when a getter creates an array hole during capture", () => {
		let reads = 0;
		const result = [1, 2];
		Object.defineProperty(result, "0", {
			get() {
				reads++;
				// oxlint-disable-next-line typescript/no-array-delete -- the fixture intentionally creates a hole during capture.
				delete result[1];
				return 1;
			},
		});
		expect(toolResultFromOutcome(completed(result))).toEqual({
			content: [{ type: "text", text: "out" }],
		});
		expect(reads).toBe(1);
	});

	it("captures validated object keys even when a getter hides a later property", () => {
		const first = vi.fn(() => {
			Object.defineProperty(result, "second", { enumerable: false });
			return 1;
		});
		const second = vi.fn(() => 2);
		const result = {
			get first() {
				return first();
			},
			get second() {
				return second();
			},
		};
		const response = toolResultFromOutcome(completed(result));
		const captured = { first: 1, second: 2 };
		expect(JSON.parse(JSON.stringify(response))).toEqual({
			content: [{ type: "text", text: JSON.stringify(captured, null, 2) }],
			structuredContent: captured,
		});
		expect(first).toHaveBeenCalledTimes(1);
		expect(second).toHaveBeenCalledTimes(1);
	});

	it("falls back when a getter deletes a later object property during capture", () => {
		const result = {
			get first() {
				Reflect.deleteProperty(result, "second");
				return 1;
			},
			second: 2,
		};
		expect(toolResultFromOutcome(completed(result))).toEqual({
			content: [{ type: "text", text: "out" }],
		});
	});

	it("never runs a result's toJSON hook", () => {
		const toJSON = vi.fn(() => 1);
		expect(toolResultFromOutcome(completed({ toJSON }))).toEqual({
			content: [{ type: "text", text: "out" }],
		});
		expect(toJSON).not.toHaveBeenCalled();
	});

	const shared = { value: 1 };
	it.each([
		["null", null, { result: null }],
		["array", [1, "two"], { result: [1, "two"] }],
		["string", "hi", { result: "hi" }],
		["false", false, { result: false }],
		["object", { a: { b: [1] } }, { a: { b: [1] } }],
		// One object referenced twice is not a cycle.
		["shared reference", { first: shared, second: shared }, { first: shared, second: shared }],
		["shared reference in arrays", [shared, [shared]], { result: [shared, [shared]] }],
		["null-prototype object", Object.assign(Object.create(null), { a: 1 }), { a: 1 }],
		["own __proto__ key", JSON.parse('{"__proto__":{"a":1}}'), JSON.parse('{"__proto__":{"a":1}}')],
	])("structures faithful JSON: %s", (_label, result, structured) => {
		expect(toolResultFromOutcome(completed(result))).toEqual({
			content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			structuredContent: structured,
		});
	});

	it.each([
		["undefined", undefined],
		["BigInt", 1n],
		["NaN", Number.NaN],
		["negative zero", -0],
		["nested negative zero", { a: [-0] }],
		["array hole", Array(1)],
		["array with a named property", Object.assign([1], { extra: 2 })],
		["array with a symbol key", Object.assign([1], { [Symbol("s")]: 2 })],
		["array subclass", new (class extends Array {})()],
		["object with a non-enumerable key", Object.defineProperty({}, "hidden", { value: 1 })],
		["function", () => {}],
		["Date", new Date(0)],
		["Map", new Map()],
		["URL", new URL("https://example.com")],
		["object holding undefined", { a: undefined }],
		["object with symbol key", { [Symbol("s")]: 1 }],
		[
			"cycle",
			(() => {
				const self: Cyclic = {};
				self.self = self;
				return self;
			})(),
		],
	])("falls back to stdout for lossy values: %s", (_label, result) => {
		expect(toolResultFromOutcome(completed(result))).toEqual({
			content: [{ type: "text", text: "out" }],
		});
	});
});
