import { describe, expect, it } from "vite-plus/test";

import { type LintInput, lint } from "./lint.ts";
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

type Fixture = {
	readonly input: LintInput;
	readonly expected: readonly Partial<Diagnostic>[];
};

// One failing fixture per code; the Record type makes a missing code a type error.
const fixtures: Record<Diagnostic["code"], Fixture> = {
	"unsupported-version": {
		input: { spec: { swagger: "2.0", paths: { "/a": { get: op("a") } } } },
		expected: [{ level: "error", message: expect.stringContaining("Swagger 2.0") }],
	},
	"missing-operation-id": {
		input: { spec: spec({ "/a": { get: { summary: "a", responses: ok } } }) },
		expected: [{ level: "error", method: "get", path: "/a" }],
	},
	"duplicate-operation-id": {
		input: { spec: spec({ "/a": { get: op("same") }, "/b": { get: op("same") } }) },
		expected: [
			{ level: "error", operationId: "same", path: "/a" },
			{ level: "error", operationId: "same", path: "/b" },
		],
	},
	"no-success-response": {
		input: {
			spec: spec({ "/a": { get: op("a", { responses: { default: { description: "x" } } }) } }),
		},
		expected: [{ level: "error", operationId: "a", message: "GET /a has no 2xx response" }],
	},
	"missing-summary": {
		input: { spec: spec({ "/a": { get: op("a", { summary: undefined }) } }) },
		expected: [{ level: "warning", operationId: "a" }],
	},
	// Required: the operation cannot be called without the parameter, so it is excluded (error);
	// optional: the parameter gets no flag and the operation stays (warning).
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
		expected: [
			...["ids", "where"].map((name) => ({
				level: "error" as const,
				message: expect.stringContaining(`"${name}"`),
			})),
			...["filter", "page", "x-ids", "tags"].map((name) => ({
				level: "warning" as const,
				message: expect.stringMatching(`"${name}" .*api /a/\\{ids\\}`),
			})),
		],
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
				level: "error",
				message: expect.stringContaining('"q" is described by `content` (application/json)'),
			},
			{ level: "warning", message: expect.stringContaining('"x-meta" is described by `content`') },
		],
	},
	"required-cookie-param": {
		input: {
			spec: spec({
				"/a": { get: op("a", { parameters: [{ name: "session", in: "cookie", required: true }] }) },
			}),
		},
		expected: [{ level: "error", message: expect.stringContaining('"session"') }],
	},
	"cookie-param-ignored": {
		input: {
			spec: spec({ "/a": { get: op("a", { parameters: [{ name: "theme", in: "cookie" }] }) } }),
		},
		expected: [{ level: "warning", message: expect.stringContaining('"theme"') }],
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
		expected: [
			{ level: "warning", operationId: "optionalWithFields" },
			{ level: "error", operationId: "required" },
		],
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
				level: "error",
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
				level: "error",
				operationId: "a",
				message:
					'POST /a: query parameter "notificationUrl" and query parameter "notification_url" share the input name "notification-url"',
			},
			{ level: "error", operationId: "a", message: expect.stringContaining('"max-count"') },
			{ level: "error", operationId: "b", message: expect.stringContaining("the request body") },
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
		expected: [{ level: "error", message: expect.stringContaining('"raw"') }],
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
			level: "error" as const,
			message: expect.stringContaining(`the flag "${name}"`),
		})),
	},
	"body-field-shadowed": {
		input: {
			spec: spec({
				"/accounts/{account_id}": {
					post: op("a", {
						parameters: [
							{ name: "account_id", in: "path", schema: { type: "string" } },
							{ name: "Scan", in: "query", schema: { type: "boolean" } },
							{ name: "x-trace", in: "header", schema: { type: "string" } },
						],
						requestBody: json(
							object({
								accountId: { type: "string" },
								scan: { type: "boolean" },
								xTrace: { type: "string" },
								nested: object({}),
							}),
						),
					}),
				},
			}),
		},
		expected: ["accountId", "scan", "xTrace"].map((field) => ({
			level: "warning" as const,
			message: expect.stringContaining(`body field "${field}"`),
		})),
	},
	"many-root-commands": {
		input: {
			spec: spec(
				Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`/r${i}`, { get: op(`r${i}`) }])),
			),
		},
		expected: [{ level: "warning", message: "21 untagged operations become root commands" }],
	},
	"override-unknown-operation": {
		input: { spec: spec({ "/a": { get: op("a") } }), override: { gone: { name: "x" } } },
		expected: [{ level: "error", operationId: "gone" }],
	},
	"override-stale": {
		input: {
			spec: spec({ "/a": { get: op("a") }, "/b": { get: op("b") } }),
			override: {
				a: { expect: { method: "GET", path: "/a" } },
				b: { expect: { method: "post", path: "/b" } },
			},
		},
		expected: [{ level: "error", operationId: "b", message: expect.stringContaining("POST /b") }],
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
					positional: ["id", "ghost"],
					bind: { id: 1, who: 2 },
				},
			},
		},
		expected: ["nope", "ghost", "who"].map((name) => ({
			level: "error" as const,
			message: expect.stringContaining(`"${name}"`),
		})),
	},
	"confirm-without-handler": {
		input: {
			spec: spec({ "/a": { delete: op("a") } }),
			override: { a: { confirm: "Delete it?" } },
		},
		expected: [{ level: "error", operationId: "a" }],
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
		expect(lint({ spec: deprecated })).toEqual([]);
		expect(
			lint({ spec: deprecated, override: { a: { exclude: false } } }).map(({ code }) => code),
		).toEqual(["missing-summary"]);
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
		expect(lint({ spec: optional }).map(({ level, code }) => `${level} ${code}`)).toEqual([
			"warning unsupported-param-style",
			"warning content-param",
		]);
	});

	it("reports a recursive or unsatisfiable parameter schema instead of overflowing", () => {
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
		expect(
			lint({ spec: recursive }).map(
				({ level, code, message }) => `${level} ${code} ${message.split('"')[1]}`,
			),
		).toEqual(["warning unsupported-param-style deep", "warning unsupported-param-style never"]);
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
			'command-collision  The added command "users" is also a command group',
		]);
	});

	it("reports confirm only without a handler", () => {
		const input = { spec: spec({ "/a": { delete: op("a") } }), each: () => ({ confirm: "Sure?" }) };
		expect(lint(input).map(({ code }) => code)).toEqual(["confirm-without-handler"]);
		expect(lint({ ...input, hasConfirmHandler: true })).toEqual([]);
		expect(lint({ ...input, each: () => ({ confirm: false as const }) })).toEqual([]);
	});

	it("warns about root commands only above 20 untagged operations, not about grouped ones", () => {
		const paths = (n: number) =>
			Object.fromEntries(Array.from({ length: n }, (_, i) => [`/r${i}`, { get: op(`r${i}`) }]));
		expect(lint({ spec: spec(paths(20)) })).toEqual([]);
		expect(lint({ spec: spec(paths(21)), each: () => ({ group: "all" }) })).toEqual([]);
	});
});
