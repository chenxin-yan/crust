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
import { json, nextSteps } from "@crustjs/extensions";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createMcpServer, toolResultFromOutcome } from "./server.ts";

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
	.flags({ bail: { type: "boolean" } })
	.handle("bail", (ctx) => ctx.stdout("bailed"));

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
				.flags({
					times: { type: "number", default: 1 },
					origin: { type: "url" },
					tag: { type: "string", multiple: true },
				})
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
			c.flags({ plain: { type: "boolean" } }).action(({ flags }) => {
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
			content: [{ type: "text", text: "PARSE: Expected a string for <word>." }],
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
		expect(badUrl).toMatchObject({
			isError: true,
			content: [
				{
					type: "text",
					text: "PARSE: Invalid URL for --origin (missing protocol — e.g. https://example.com).",
				},
			],
		});
		const badRaw = await client.callTool({ name: "echo", arguments: { word: "x", raw: "nope" } });
		expect(badRaw).toMatchObject({
			isError: true,
			content: [{ type: "text", text: 'PARSE: Expected an array of strings for "raw"' }],
		});
	});

	it("returns captured stdout when an Extension handles the invocation", async () => {
		const client = await connect(fixture);
		const result = await client.callTool({ name: "print", arguments: { bail: true } });
		expect(result.content).toEqual([{ type: "text", text: "bailed" }]);
	});

	it("appends captured stderr as a text block after the result", async () => {
		const client = await connect(fixture);
		expect(await client.callTool({ name: "print" })).toEqual({
			content: [
				{ type: "text", text: "plain output" },
				{ type: "text", text: "noise" },
			],
		});
	});

	it("carries nextSteps() blocks in completed and failed tool results", async () => {
		class NotLoggedInError extends Error {}
		const status = defineCommand("status", (c) => c.action(() => {}));
		const login = defineCommand("login", (c) => c.action(() => {}));
		const app = new Crust("cli")
			.extend(
				nextSteps({
					onError: (error) =>
						error instanceof NotLoggedInError
							? [{ command: login, description: "Log in" }]
							: undefined,
				}),
			)
			.add(
				defineCommand("deploy", (c) =>
					c
						.use(nextSteps)
						.flags({ fail: { type: "boolean" } })
						.action(async ({ flags, ctx }) => {
							(await ctx.nextSteps).add(status, undefined, "Check the deployment");
							if (flags.fail) throw new NotLoggedInError("not logged in");
							return { ok: true };
						}),
				),
				status,
				login,
			);
		const client = await connect(app);
		expect(await client.callTool({ name: "deploy" })).toEqual({
			content: [
				{ type: "text", text: JSON.stringify({ ok: true }, null, 2) },
				{ type: "text", text: "Next steps:\n  Check the deployment:\n    cli status" },
			],
			structuredContent: { ok: true },
		});
		expect(await client.callTool({ name: "deploy", arguments: { fail: true } })).toEqual({
			content: [
				{ type: "text", text: "Error: not logged in" },
				{
					type: "text",
					text: "Next steps:\n  Log in:\n    cli login\n  Check the deployment:\n    cli status",
				},
			],
			isError: true,
		});
	});

	it("forwards cancellation per invocation and closes active Contexts on disconnect", async () => {
		const calls = Array.from({ length: 2 }, () => ({
			started: Promise.withResolvers<AbortSignal>(),
			disposed: Promise.withResolvers<void>(),
		}));
		const session = defineContext("session")
			.flags({ id: { type: "number", required: true } })
			.setup(({ flags, defer }) => {
				const call = calls[flags.id]!;
				defer(() => call.disposed.resolve());
				return call;
			});
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

	it("binds prototype-named args and flags as own properties", async () => {
		// `__proto__` itself never crosses the SDK: its request parsing drops the key
		// before the handler runs. The manifest side is covered in tools.test.ts.
		const app = new Crust("proto").add(
			defineCommand("probe", (c) =>
				c
					.args({ name: "hasOwnProperty", type: "string", required: true })
					.flags({ constructor: { type: "string" }, toString: { type: "number" } })
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

	it("reads an ordinary result's next getter once", async () => {
		let reads = 0;
		const app = new Crust("getter").add(
			defineCommand("probe", (c) =>
				c.action(() => ({
					get next() {
						return ++reads;
					},
				})),
			),
		);
		const client = await connect(app);
		const result = await client.callTool({ name: "probe" });
		expect(result.structuredContent).toEqual({ next: 1 });
		expect(reads).toBe(1);
	});

	it("rejects unknown and hidden tools at the protocol level", async () => {
		const client = await connect(fixture);
		await expect(client.callTool({ name: "secret" })).rejects.toThrow("Tool secret not found");
	});

	it("keeps concurrent calls isolated and off process stdout", async () => {
		const client = await connect(fixture);
		const writeSync = vi.spyOn(process.getBuiltinModule("node:fs"), "writeSync");
		try {
			const [a, b] = await Promise.all([
				client.callTool({ name: "slow", arguments: { id: "a" } }),
				client.callTool({ name: "slow", arguments: { id: "b" } }),
			]);
			expect(a.structuredContent).toEqual({ id: "a" });
			expect(b.structuredContent).toEqual({ id: "b" });
			expect(writeSync.mock.calls.filter(([fd]) => fd === 1)).toEqual([]);
		} finally {
			writeSync.mockRestore();
		}
	});

	it("advertises output schemas that the results' structuredContent satisfies", async () => {
		const DIALECT = "https://json-schema.org/draft/2020-12/schema";
		const user = {
			type: "object",
			properties: { id: { type: "number" } },
			required: ["id"],
			additionalProperties: false,
		};
		const app = new Crust("cli")
			.add(
				defineCommand("rm", (c) =>
					c.output(jsonSchemaOutput({ $schema: DIALECT, ...user })).action(() => ({ id: 1 })),
				),
			)
			.add(
				defineCommand("count", (c) =>
					c.output(jsonSchemaOutput({ $schema: DIALECT, type: "number" })).action(() => 2),
				),
			);
		const client = await connect(app);
		const { tools } = await client.listTools();
		expect(tools).toMatchObject([
			{
				name: "rm",
				outputSchema: { $schema: DIALECT, ...user },
			},
			{
				name: "count",
				outputSchema: {
					$schema: DIALECT,
					type: "object",
					properties: { result: { type: "number" } },
					required: ["result"],
				},
			},
		]);
		// The SDK client validates structuredContent against the advertised outputSchema.
		expect((await client.callTool({ name: "rm" })).structuredContent).toEqual({ id: 1 });
		expect((await client.callTool({ name: "count" })).structuredContent).toEqual({ result: 2 });
	});

	it("returns only the result when a call passes json: true to a command with .output()", async () => {
		const app = new Crust("cli").extend(json()).add(
			defineCommand("users", (c) =>
				c.output(jsonSchemaOutput({ type: "object" })).action(({ stdout }) => {
					stdout("ID  NAME");
					return { id: 1 };
				}),
			),
		);
		const client = await connect(app);
		const expected = {
			content: [{ type: "text", text: JSON.stringify({ id: 1 }, null, 2) }],
			structuredContent: { id: 1 },
		};
		expect(await client.callTool({ name: "users" })).toEqual(expected);
		// json() holds the printed table under --json, so the result carries no stderr copy of it.
		expect(await client.callTool({ name: "users", arguments: { json: true } })).toEqual(expected);
		expect(await app.run(["users"], { flags: { json: true } })).toMatchObject({
			stdout: '{"id":1}',
			stderr: "",
		});
	});

	it("reports text-only results of tools with an outputSchema as errors", async () => {
		const app = new Crust("cli")
			.add(
				defineCommand("count", (c) =>
					c.output(jsonSchemaOutput({ type: "number" })).action(() => -0),
				),
			)
			.extend(finisher);
		const client = await connect(app);
		await client.listTools();
		// An Extension handling the call leaves only stdout, which cannot satisfy the outputSchema.
		const unmet = {
			type: "text",
			text: "The command finished without a JSON result for this tool's outputSchema; its stdout follows",
		};
		expect(await client.callTool({ name: "count", arguments: { bail: true } })).toEqual({
			content: [unmet, { type: "text", text: "bailed" }],
			isError: true,
		});
		// -0 does not survive JSON, so the result falls back to stdout.
		expect(await client.callTool({ name: "count" })).toEqual({
			content: [unmet, { type: "text", text: "" }],
			isError: true,
		});
	});

	it("sends progress notifications for yielded events when the request has a progress token", async () => {
		const app = new Crust("cli").add(
			defineCommand("sync", (c) =>
				c.action(async function* () {
					yield "fetching";
					yield { done: 1, total: 2 };
					yield "writing";
					return { synced: 2 };
				}),
			),
		);
		const client = await connect(app);
		const progress: unknown[] = [];
		const result = await client.callTool({ name: "sync" }, undefined, {
			onprogress: (notification) => progress.push(notification),
		});
		expect(result.structuredContent).toEqual({ synced: 2 });
		expect(progress).toEqual([
			{ progress: 1, message: "fetching" },
			{ progress: 2 },
			{ progress: 3, message: "writing" },
		]);
	});

	it("sends no progress notifications without a progress token", async () => {
		const app = new Crust("cli").add(
			defineCommand("sync", (c) =>
				c.action(async function* () {
					yield "fetching";
					return { synced: 1 };
				}),
			),
		);
		const client = await connect(app);
		const notifications: unknown[] = [];
		client.fallbackNotificationHandler = async (notification) => {
			notifications.push(notification);
		};
		const result = await client.callTool({ name: "sync" });
		expect(result.structuredContent).toEqual({ synced: 1 });
		expect(notifications).toEqual([]);
	});

	it("keeps the tool result when a progress notification fails to send", async () => {
		const app = new Crust("cli").add(
			defineCommand("sync", (c) =>
				c.action(async function* () {
					yield "fetching";
					return { synced: 1 };
				}),
			),
		);
		const client = await connect(app);
		const notification = vi
			.spyOn(Server.prototype, "notification")
			.mockRejectedValue(new Error("transport gone"));
		try {
			const result = await client.callTool({ name: "sync" }, undefined, { onprogress: () => {} });
			expect(notification).toHaveBeenCalledOnce();
			expect(result.structuredContent).toEqual({ synced: 1 });
		} finally {
			notification.mockRestore();
		}
	});
});

/** Standard Schema whose output converts to `jsonSchema`. */
function jsonSchemaOutput(jsonSchema: Record<string, unknown>) {
	return {
		"~standard": {
			version: 1 as const,
			vendor: "test",
			validate: (value: unknown) => ({ value }),
			jsonSchema: { input: () => jsonSchema, output: () => jsonSchema },
		},
	};
}

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

	it.each([
		[
			"completed",
			completed({ a: 1 }),
			{ content: [{ type: "text", text: '{\n  "a": 1\n}' }], structuredContent: { a: 1 } },
		],
		[
			"handled",
			{ status: "handled" as const, by: defineExtensionId("test:h"), stdout: "out", stderr: "" },
			{ content: [{ type: "text", text: "out" }] },
		],
		[
			"failed",
			{ status: "failed" as const, error: new Error("boom"), stdout: "", stderr: "" },
			{ content: [{ type: "text", text: "Error: boom" }], isError: true },
		],
	])("appends non-empty stderr after a %s result", (_label, outcome, withoutStderr) => {
		expect(toolResultFromOutcome(outcome)).toEqual(withoutStderr);
		expect(toolResultFromOutcome({ ...outcome, stderr: "warn" })).toEqual({
			...withoutStderr,
			content: [...withoutStderr.content, { type: "text", text: "warn" }],
		});
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

	it.each(["object", "array", "symbol", "non-enumerable", "array length"])(
		"falls back when getter capture adds data: %s",
		(kind) => {
			let reads = 0;
			const added = vi.fn(() => 2);
			const result = kind.startsWith("array") ? [1] : { first: 1 };
			Object.defineProperty(result, Array.isArray(result) ? "0" : "first", {
				get() {
					reads++;
					if (kind === "array length" && Array.isArray(result)) {
						result.length = 2;
					} else {
						const key = Array.isArray(result) ? "1" : kind === "symbol" ? Symbol() : "added";
						Object.defineProperty(result, key, {
							enumerable: kind !== "non-enumerable",
							get: added,
						});
					}
					return 1;
				},
			});
			expect(toolResultFromOutcome(completed(result))).toEqual({
				content: [{ type: "text", text: "out" }],
			});
			expect(reads).toBe(1);
			expect(added).not.toHaveBeenCalled();
		},
	);

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
		["array hole masked by a named key", Object.assign(Array(1), { extra: 2 })],
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
