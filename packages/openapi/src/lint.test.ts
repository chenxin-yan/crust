import { describe, expect, it } from "vite-plus/test";

import { type LintInput, PROBLEM_KINDS, buildProblems, lint, planCommands } from "./lint.ts";
import type { Diagnostic } from "./operations.ts";

const ok = { "200": { description: "ok" } };

/** An operation that lints clean unless `fields` break it. */
function op(operationId: string, fields: Record<string, unknown> = {}) {
	return { operationId, summary: operationId, responses: ok, ...fields };
}

function spec(paths: Record<string, unknown>, components: Record<string, unknown> = {}) {
	return { openapi: "3.1.0", paths, components };
}

const json = (schema: unknown, required = false) => ({
	required,
	content: { "application/json": { schema } },
});

const object = (properties: Record<string, unknown>) => ({ type: "object", properties });

/** The input names of the operation `a` as planned. */
const inputs = (input: LintInput) =>
	planCommands(input)
		.commands.find(({ op }) => op.id === "a")
		?.inputs.map(({ name }) => name);

type Fixture = {
	readonly input: LintInput;
	readonly expected: readonly Partial<Diagnostic>[];
};

// One failing fixture per code; the Record type makes a missing code a type error.
const fixtures: Record<Diagnostic["code"], Fixture> = {
	"unsupported-version": {
		input: { spec: { swagger: "2.0", paths: { "/a": { get: op("a") } } } },
		expected: [{ message: expect.stringContaining("Swagger 2.0") }],
	},
	"missing-operation-id": {
		input: { spec: spec({ "/a": { get: { summary: "a", responses: ok } } }) },
		expected: [{ method: "get", path: "/a" }],
	},
	"duplicate-operation-id": {
		input: { spec: spec({ "/a": { get: op("same") }, "/b": { get: op("same") } }) },
		expected: [
			{ operationId: "same", path: "/a" },
			{ operationId: "same", path: "/b" },
		],
	},
	"no-success-response": {
		input: {
			spec: spec({ "/a": { get: op("a", { responses: { default: { description: "x" } } }) } }),
		},
		expected: [{ operationId: "a", message: "GET /a has no 2xx response" }],
	},
	// Only a required parameter: an optional one just gets no flag.
	"unsupported-param-style": {
		input: {
			spec: spec({
				"/a/{ids}": {
					get: op("a", {
						parameters: [
							{ name: "ids", in: "path", schema: { type: "array", items: { type: "string" } } },
							{
								name: "where",
								in: "query",
								required: true,
								style: "deepObject",
								schema: object({}),
							},
							{ name: "filter", in: "query", style: "deepObject", schema: object({}) },
							{ name: "page", in: "query", schema: { type: "object" } },
							{ name: "x-ids", in: "header", style: "form", schema: { type: "string" } },
							{
								name: "tags",
								in: "query",
								schema: { type: "array", items: { type: "array", items: { type: "string" } } },
							},
						],
					}),
				},
			}),
		},
		expected: ["ids", "where"].map((name) => ({ message: expect.stringContaining(`"${name}"`) })),
	},
	"content-param": {
		input: {
			spec: spec({
				"/a": {
					get: op("a", {
						parameters: [
							{
								name: "q",
								in: "query",
								required: true,
								content: { "application/json": { schema: {} } },
							},
							{ name: "x-meta", in: "header", content: { "application/json": { schema: {} } } },
						],
					}),
				},
			}),
		},
		expected: [
			{
				message: expect.stringContaining('"q" is described by `content` (application/json)'),
			},
		],
	},
	"required-cookie-param": {
		input: {
			spec: spec({
				"/a": { get: op("a", { parameters: [{ name: "session", in: "cookie", required: true }] }) },
			}),
		},
		expected: [{ message: expect.stringContaining('"session"') }],
	},
	"unsupported-body-type": {
		input: {
			spec: spec({
				"/form": {
					post: op("required", {
						requestBody: {
							required: true,
							content: { "application/x-www-form-urlencoded": { schema: object({}) } },
						},
					}),
					put: op("optionalWithFields", {
						requestBody: {
							content: { "multipart/form-data": { schema: object({ file: { type: "string" } }) } },
						},
					}),
					// Stripe's GET operations declare an empty optional form body.
					get: op("optionalEmpty", {
						requestBody: {
							content: { "application/x-www-form-urlencoded": { schema: object({}) } },
						},
					}),
				},
			}),
		},
		expected: [{ operationId: "required" }],
	},
	"command-collision": {
		input: {
			spec: spec({
				"/a": { delete: op("DeleteWebhook", { tags: ["webhooks"] }) },
				"/b": { delete: op("deleteWebhook", { tags: ["Webhooks"] }) },
			}),
		},
		expected: [
			{
				operationId: "deleteWebhook",
				message:
					'DELETE /b: the command "webhooks delete-webhook" is also the command of DELETE /a (DeleteWebhook)',
			},
		],
	},
	"flag-collision": {
		input: {
			spec: spec({
				"/a": {
					post: op("a", {
						parameters: [
							{ name: "notificationUrl", in: "query", schema: { type: "string" } },
							{ name: "notification_url", in: "query", schema: { type: "string" } },
						],
						requestBody: json(
							object({ max_count: { type: "integer" }, maxCount: { type: "integer" } }),
						),
					}),
				},
				"/b": {
					post: op("b", {
						parameters: [{ name: "body", in: "query", schema: { type: "string" } }],
						requestBody: json(object({})),
					}),
				},
			}),
		},
		expected: [
			{
				operationId: "a",
				message:
					'POST /a: query parameter "notificationUrl" and query parameter "notification_url" share the input name "notification-url"',
			},
			{ operationId: "a", message: expect.stringContaining('"max-count"') },
			{ operationId: "b", message: expect.stringContaining("the request body") },
		],
	},
	"reserved-input-name": {
		input: {
			spec: spec({
				"/a": {
					get: op("a", { parameters: [{ name: "raw", in: "query", schema: { type: "boolean" } }] }),
				},
			}),
		},
		expected: [{ message: expect.stringContaining('"raw"') }],
	},
	"unflaggable-name": {
		input: {
			spec: spec({
				"/a": {
					get: op("a", {
						parameters: [
							{ name: "no_cache", in: "query", schema: { type: "boolean" } },
							{ name: "123", in: "header", schema: { type: "string" } },
							{ name: "日本", in: "query", schema: { type: "string" } },
						],
					}),
				},
			}),
		},
		expected: ["no-cache", "123", ""].map((name) => ({
			message: expect.stringContaining(`the flag "${name}"`),
		})),
	},
	"positional-order": {
		input: {
			spec: spec({
				"/a/{id}": {
					get: op("a", {
						parameters: [
							{ name: "id", in: "path", schema: { type: "string" } },
							{ name: "q", in: "query", schema: { type: "string" } },
							{ name: "tag", in: "query", schema: { type: "array", items: { type: "string" } } },
						],
					}),
				},
			}),
			override: { a: { positional: ["q", "tag", "id"] } },
		},
		expected: ['"q" is optional, before a required one', '"tag" is a list'].map((text) => ({
			message: expect.stringContaining(text),
		})),
	},
	"unusable-name": {
		input: {
			spec: spec({
				"/a": { get: op("日本") },
				"/b/{___}": {
					get: op("b", { parameters: [{ name: "___", in: "path", schema: { type: "string" } }] }),
				},
				"/c": { get: op("c") },
			}),
			override: { c: { group: "dns  records", name: "-c" } },
		},
		expected: [
			'the command name ""',
			'the argument name ""',
			'the group name ""',
			'the command name "-c"',
		].map((text) => ({ message: expect.stringContaining(text) })),
	},
	"override-unknown-operation": {
		input: { spec: spec({ "/a": { get: op("a") } }), override: { gone: { name: "x" } } },
		expected: [{ operationId: "gone" }],
	},
	"override-stale": {
		input: {
			spec: spec({ "/a": { get: op("a") }, "/b": { get: op("b") } }),
			override: {
				a: { expect: { method: "GET", path: "/a" } },
				b: { expect: { method: "post", path: "/b" } },
			},
		},
		expected: [{ operationId: "b", message: expect.stringContaining("POST /b") }],
	},
	"override-unknown-param": {
		input: {
			spec: spec({
				"/a/{id}": {
					post: op("a", {
						parameters: [{ name: "id", in: "path", schema: { type: "string" } }],
						requestBody: json(object({ name: { type: "string" } })),
					}),
				},
			}),
			each: () => ({ flagName: { gone: "x" } }),
			override: {
				a: {
					flagName: { name: "title", nope: "n" },
					positional: ["id", "name", "ghost"],
					bind: { id: () => "1", who: () => "2" },
				},
			},
		},
		expected: ["nope", "name", "ghost", "who"].map((name) => ({
			message: expect.stringContaining(`"${name}"`),
		})),
	},
	"confirm-without-handler": {
		input: {
			spec: spec({ "/a": { delete: op("a") } }),
			override: { a: { confirm: "Delete it?" } },
		},
		expected: [{ operationId: "a" }],
	},
};

describe("lint", () => {
	it.each(Object.entries(fixtures))("reports %s", (code, { input, expected }) => {
		expect(lint(input).filter((diagnostic) => diagnostic.code === code)).toEqual(
			expected.map((fields) => expect.objectContaining({ ...fields, fix: expect.any(String) })),
		);
	});

	it("passes a spec every rule accepts", () => {
		const clean = spec(
			{
				"/zones/{zone_id}/dns_records": {
					parameters: [{ $ref: "#/components/parameters/Zone" }],
					get: op("dnsRecordsList", {
						tags: ["DNS Records"],
						parameters: [
							{ name: "type", in: "query", schema: { type: "string", enum: ["A", "AAAA"] } },
							{ name: "tag", in: "query", schema: { type: "array", items: { type: "string" } } },
							{ name: "X-Request-Id", in: "header", schema: { type: "string" } },
						],
					}),
					post: op("dnsRecordsCreate", {
						tags: ["DNS Records"],
						requestBody: json({ $ref: "#/components/schemas/Record" }, true),
						responses: { "201": { description: "created" } },
					}),
				},
				"/zones/{zone_id}": {
					get: op("zonesGet", {
						tags: ["Zones"],
						parameters: [{ $ref: "#/components/parameters/Zone" }],
					}),
					delete: op("zonesDelete", {
						tags: ["Zones"],
						deprecated: true,
						responses: { default: { description: "x" } },
					}),
				},
			},
			{
				parameters: {
					Zone: { name: "zone_id", in: "path", required: true, schema: { type: "string" } },
				},
				schemas: {
					Record: {
						allOf: [
							object({ name: { type: "string" }, ttl: { type: "integer", nullable: true } }),
							object({ data: object({}), tags: { type: "array", items: { type: "string" } } }),
						],
					},
				},
			},
		);
		expect(lint({ spec: clean })).toEqual([]);
	});

	it("excludes deprecated operations unless an override brings them back", () => {
		const deprecated = spec({
			"/a": { get: op("a", { deprecated: true, summary: undefined }) },
			"/b": { get: op("a2", { tags: [], deprecated: true, summary: undefined }) },
		});
		expect(planCommands({ spec: deprecated })).toEqual({ diagnostics: [], commands: [] });
		expect(
			planCommands({ spec: deprecated, override: { a: { exclude: false } } }).commands.map(
				({ op }) => op.id,
			),
		).toEqual(["a"]);
		expect(
			lint({
				spec: spec({ "/a": { get: op("a", { summary: undefined }) } }),
				each: () => ({ exclude: true }),
			}),
		).toEqual([]);
	});

	it("lets an override field replace the rule's field, and keeps the rule's where the override leaves it undefined", () => {
		const two = spec({
			"/a": { get: op("listA", { tags: ["t"] }) },
			"/b": { get: op("listB", { tags: ["t"] }) },
		});
		const each = () => ({ name: "list" });
		expect(
			lint({ spec: two, each }).map(({ code, operationId }) => `${code} ${operationId}`),
		).toEqual(["command-collision listB"]);
		expect(lint({ spec: two, each, override: { listB: { name: "list-b" } } })).toEqual([]);
		expect(lint({ spec: two, each, override: { listB: { name: undefined } } })).toHaveLength(1);
	});

	it("uses flagName, positional and bind to rename, place and hide inputs", () => {
		const collide = spec({
			"/a/{id}": {
				get: op("a", {
					parameters: [
						{ name: "id", in: "path", schema: { type: "string" } },
						{ name: "ID", in: "query", schema: { type: "string" } },
					],
				}),
			},
		});
		expect(lint({ spec: collide }).map(({ code }) => code)).toEqual(["flag-collision"]);
		expect(lint({ spec: collide, override: { a: { flagName: { ID: "query-id" } } } })).toEqual([]);
		expect(lint({ spec: collide, override: { a: { bind: { id: () => "1" } } } })).toEqual([]);
		// A rule's entry for a parameter the operation lacks is ignored.
		expect(lint({ spec: collide, each: () => ({ flagName: { ID: "q", other: "o" } }) })).toEqual(
			[],
		);
		// Only a flag can be unflaggable, so "no-id" shows that `positional: []` made the path parameter a flag.
		const renamed = { flagName: { id: "no-id", ID: "query-id" } };
		expect(lint({ spec: collide, override: { a: renamed } })).toEqual([]);
		expect(
			lint({ spec: collide, override: { a: { ...renamed, positional: [] } } }).map(
				({ code }) => code,
			),
		).toEqual(["unflaggable-name"]);
	});

	it("offers no flag for an optional parameter it cannot map, so it cannot collide", () => {
		const optional = spec({
			"/a/{id}": {
				get: op("a", {
					parameters: [
						{ name: "id", in: "path", schema: { type: "string" } },
						{ name: "ID", in: "query", style: "deepObject", schema: object({}) },
						{ name: "Id", in: "header", content: { "text/plain": {} } },
					],
				}),
			},
		});
		expect(lint({ spec: optional })).toEqual([]);
		expect(inputs({ spec: optional })).toEqual(["id"]);
	});

	it("offers no flag for a recursive or unsatisfiable parameter schema instead of overflowing", () => {
		const recursive = spec(
			{
				"/a": {
					get: op("a", {
						parameters: [
							{ name: "deep", in: "query", schema: { $ref: "#/components/schemas/A" } },
							{ name: "never", in: "query", schema: false },
						],
					}),
				},
			},
			{ schemas: { A: { type: "array", items: { $ref: "#/components/schemas/A" } } } },
		);
		expect(lint({ spec: recursive })).toEqual([]);
		expect(inputs({ spec: recursive })).toEqual([]);
	});

	it("checks body fields from every allOf member that refers to the same schema", () => {
		const twice = spec(
			{
				"/a": {
					post: op("a", {
						parameters: [{ name: "second", in: "query", schema: { type: "string" } }],
						requestBody: json({
							allOf: [
								{ $ref: "#/components/schemas/Base", properties: { first: { type: "string" } } },
								{ $ref: "#/components/schemas/Base", properties: { second: { type: "string" } } },
							],
						}),
					}),
				},
			},
			{ schemas: { Base: object({ id: { type: "string" } }) } },
		);
		// "second" repeats the query parameter, which keeps its input; the body field gets none.
		expect(lint({ spec: twice })).toEqual([]);
		expect(inputs({ spec: twice })).toEqual(["second", "body", "first", "id"]);
	});

	it("reads a body field's type through the $ref beside its own keywords", () => {
		const sibling = spec(
			{
				"/a": {
					post: op("a", {
						parameters: [{ name: "short", in: "query", schema: { type: "string" } }],
						requestBody: json(
							object({ short: { $ref: "#/components/schemas/Name", maxLength: 5 } }),
						),
					}),
				},
			},
			{ schemas: { Name: { type: "string" } } },
		);
		expect(inputs({ spec: sibling })).toEqual(["short", "body"]);
	});

	it("classifies a schema behind annotated $refs and $ref chains like its inline equivalent", () => {
		const schemas = {
			Objects: { type: "array", items: { type: "object" } },
			Strings: { type: "array", items: { type: "string" } },
			Alias: { $ref: "#/components/schemas/Object", description: "Inner" },
			Object: { type: "object" },
			StringsAlias: { $ref: "#/components/schemas/Strings", description: "Inner" },
		};
		const param = (schema: unknown) =>
			lint({
				spec: spec(
					{
						"/a": {
							get: op("a", { parameters: [{ name: "q", in: "query", required: true, schema }] }),
						},
					},
					{ schemas },
				),
			}).map(({ code }) => code);
		const ref = (name: string) => ({ $ref: `#/components/schemas/${name}`, description: "Outer" });
		const unsupported = ["unsupported-param-style"];
		expect(param(schemas.Objects)).toEqual(unsupported);
		expect(param(ref("Objects"))).toEqual(unsupported);
		expect(param(schemas.Object)).toEqual(unsupported);
		expect(param(ref("Alias"))).toEqual(unsupported);
		expect(param(schemas.Strings)).toEqual([]);
		expect(param(ref("Strings"))).toEqual([]);
		expect(param(ref("StringsAlias"))).toEqual([]);

		// A list of strings is a flag; a list of objects is not.
		const field = (names: unknown) =>
			inputs({
				spec: spec(
					{ "/a": { post: op("a", { requestBody: json(object({ names })) }) } },
					{ schemas },
				),
			});
		expect(field(schemas.Strings)).toEqual(["body", "names"]);
		expect(field(ref("Strings"))).toEqual(["body", "names"]);
		expect(field(ref("StringsAlias"))).toEqual(["body", "names"]);
		expect(field(ref("Objects"))).toEqual(["body"]);

		// A cycle through `allOf` ends at the search's depth bound, as an untyped (string) parameter.
		const cyclic = { Loop: { allOf: [{ $ref: "#/components/schemas/Loop", description: "x" }] } };
		Object.assign(schemas, cyclic);
		expect(param(ref("Loop"))).toEqual([]);
	});

	it("offers a body field named __proto__ an input like any other", () => {
		const proto = JSON.parse(`{ "openapi": "3.1.0", "paths": { "/p": { "post": {
			"operationId": "p", "summary": "p", "responses": { "200": { "description": "ok" } },
			"requestBody": { "content": { "application/json": { "schema": { "type": "object",
				"properties": { "__proto__": { "type": "string" }, "proto": { "type": "string" } } } } } }
		} } } }`);
		expect(lint({ spec: proto }).map(({ code, message }) => `${code} ${message}`)).toEqual([
			'flag-collision POST /p: body field "__proto__" and body field "proto" share the input name "proto"',
		]);
	});

	it("reports a command that is also a group, and an added command clashing with a generated one", () => {
		const nested = spec({
			"/dns": { get: op("dns", { tags: [] }) },
			"/dns/records": { get: op("recordsList", { tags: ["dns"] }) },
			"/users": { get: op("usersList", { tags: ["users"] }) },
		});
		expect(
			lint({
				spec: nested,
				each: (o) => (o.id === "recordsList" ? { group: "dns records" } : undefined),
				added: { users: ["list"], "": ["users"] },
			}).map(({ code, operationId, message }) => `${code} ${operationId ?? ""} ${message}`),
		).toEqual([
			'command-collision dns GET /dns: the command "dns" is also a command group',
			'command-collision usersList GET /users: the command "users list" is also a command added to the group "users"',
			'command-collision usersList GET /users: the command "users list" is in the group "users", which is also a command added to the group ""',
			'command-collision  The command "users", a command added to the group "", is also a group of added commands',
		]);
	});

	it("leaves the Extension's root commands to it: a generated command or group of that name collides", () => {
		const apiNamed = spec({
			"/api": { get: op("api") },
			"/keys": { get: op("listKeys", { tags: ["API"] }) },
		});
		expect(
			lint({ spec: apiNamed, extensionCommands: ["api"] }).map(
				({ code, operationId, message }) => `${code} ${operationId ?? ""} ${message}`,
			),
		).toEqual([
			`command-collision api GET /api: the command "api" is also a command group`,
			`command-collision api GET /api: the command "api" is also the Extension's "api" command`,
			`command-collision listKeys GET /keys: the command "api list-keys" is in the group "api", which is also the Extension's "api" command`,
		]);
	});

	it("advises `bind` or a written command when inputs share their spec name, which `flagName` renames alike", () => {
		const shared = spec({
			"/a/{id}": {
				get: op("a", {
					parameters: [
						{ name: "id", in: "path", schema: { type: "string" } },
						{ name: "id", in: "query", schema: { type: "string" } },
					],
				}),
			},
		});
		expect(
			lint({
				spec: shared,
				override: { a: { positional: [], flagName: { id: "identifier" } } },
			}).map(({ code, fix }) => [code, fix]),
		).toEqual([
			[
				"flag-collision",
				"Fill them with one `bind` entry, or set `exclude: true` and write the command with `call()`, or use `api`",
			],
		]);
	});

	it("reports confirm only without a handler", () => {
		const input = { spec: spec({ "/a": { delete: op("a") } }), each: () => ({ confirm: "Sure?" }) };
		expect(lint(input).map(({ code }) => code)).toEqual(["confirm-without-handler"]);
		expect(lint({ ...input, hasConfirmHandler: true })).toEqual([]);
		expect(lint({ ...input, each: () => ({ confirm: false as const }) })).toEqual([]);
	});

	it("fails the build for a problem configuration settles, and skips one it cannot", () => {
		const diagnostics = lint({
			spec: spec({
				"/a": { get: op("a", { tags: ["t"] }) },
				"/b": { get: op("t-a", { tags: ["t"] }) },
				"/c": { get: op("c", { parameters: [{ name: "s", in: "cookie", required: true }] }) },
			}),
		});
		expect(diagnostics.map(({ code }) => [code, PROBLEM_KINDS[code]])).toEqual([
			["required-cookie-param", "skip"],
			["command-collision", "fix"],
		]);
		expect(buildProblems(diagnostics)).toBe(
			[
				"defineApi: 1 problem needs a decision before this CLI can be built.",
				"",
				'  GET /b: the command "t a" is also the command of GET /a (a)',
				"    fix: Set `group` or `name` in the override of one of them",
			].join("\n"),
		);
		expect(buildProblems(diagnostics.slice(0, 1))).toBeUndefined();
	});

	it("settles every problem of an excluded operation, also its override's", () => {
		const one = spec({ "/a": { get: op("a") } });
		expect(
			lint({
				spec: one,
				override: {
					a: { exclude: true, expect: { method: "POST", path: "/a" }, flagName: { x: "y" } },
				},
			}),
		).toEqual([]);
	});
});
