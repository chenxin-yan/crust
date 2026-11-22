import { describe, expect, it } from "vite-plus/test";

import type { OpenApiSpec } from "./api-command.ts";
import { type Operation, operations } from "./operations.ts";

const user = { $ref: "#/components/schemas/User" };

// Conformance fixture: path-item `$ref` and shared parameters, `$ref`'d parameters, bodies,
// responses and schemas, `allOf`, ignored headers, inherited and empty `security`.
const conformance = {
	openapi: "3.1.0",
	security: [{ bearer: [] }],
	paths: {
		"x-internal": { get: { operationId: "skipped" } },
		"/users": {
			parameters: [{ $ref: "#/components/parameters/Limit" }],
			get: {
				operationId: "listUsers",
				tags: ["Users"],
				summary: "List users",
				description: "Every user.",
				parameters: [
					{ name: "limit", in: "query", schema: { type: "integer", maximum: 10 } },
					{ name: "accept", in: "header", schema: { type: "string" } },
					{
						name: "cursor",
						in: "query",
						style: "form",
						explode: false,
						schema: { type: "string" },
					},
				],
				responses: {
					"200": {
						description: "ok",
						content: { "application/json": { schema: { type: "array", items: user } } },
					},
					default: { description: "error" },
				},
			},
			post: {
				operationId: "createUser",
				tags: ["Users"],
				security: [],
				requestBody: {
					required: true,
					content: {
						"application/xml": { schema: { type: "string" } },
						"application/json": { schema: { $ref: "#/components/schemas/NewUser" } },
					},
				},
				responses: { "201": { $ref: "#/components/responses/User" } },
			},
		},
		"/users/{id}": {
			parameters: [{ name: "id", in: "path", description: "User id", schema: { type: "string" } }],
			get: {
				operationId: "getUser",
				deprecated: true,
				responses: { "2XX": { description: "ok" } },
			},
			delete: { responses: { "204": { description: "gone" } } },
			patch: { deprecated: true, responses: { "200": { description: "ok" } } },
		},
		"/teams": { $ref: "#/components/pathItems/Teams" },
	},
	components: {
		parameters: { Limit: { name: "limit", in: "query", schema: { type: "integer" } } },
		pathItems: {
			Teams: {
				get: {
					operationId: "listTeams",
					parameters: [
						{ name: "filter", in: "query", content: { "application/json": { schema: user } } },
					],
					responses: { "200": { description: "ok" } },
				},
			},
		},
		responses: {
			User: { description: "user", content: { "application/json": { schema: user } } },
		},
		schemas: {
			User: {
				type: "object",
				properties: { id: { type: "string" }, friends: { type: "array", items: user } },
			},
			NewUser: {
				allOf: [
					{ $ref: "#/components/schemas/Named" },
					{ type: "object", properties: { email: { type: "string" } }, required: ["email"] },
				],
			},
			Named: {
				type: "object",
				properties: { name: { $ref: "#/components/schemas/Name" } },
				required: ["name"],
			},
			Name: { type: "string", minLength: 1 },
		},
	},
};

const userSchema = conformance.components.schemas.User;

const expected: Operation[] = [
	{
		id: "listUsers",
		method: "get",
		path: "/users",
		tags: ["Users"],
		summary: "List users",
		description: "Every user.",
		deprecated: false,
		params: [
			{ name: "limit", in: "query", required: false, schema: { type: "integer", maximum: 10 } },
			{
				name: "cursor",
				in: "query",
				required: false,
				style: "form",
				explode: false,
				schema: { type: "string" },
			},
		],
		responses: [
			{
				status: "200",
				contentType: "application/json",
				schema: { type: "array", items: user },
			},
			{ status: "default" },
		],
		security: [{ bearer: [] }],
	},
	{
		id: "createUser",
		method: "post",
		path: "/users",
		tags: ["Users"],
		deprecated: false,
		params: [{ name: "limit", in: "query", required: false, schema: { type: "integer" } }],
		body: {
			required: true,
			contentType: "application/json",
			schema: conformance.components.schemas.NewUser,
		},
		responses: [{ status: "201", contentType: "application/json", schema: userSchema }],
		security: [],
	},
	{
		id: "getUser",
		method: "get",
		path: "/users/{id}",
		tags: [],
		deprecated: true,
		params: [
			{
				name: "id",
				in: "path",
				required: true,
				description: "User id",
				schema: { type: "string" },
			},
		],
		responses: [{ status: "2XX" }],
		security: [{ bearer: [] }],
	},
	{
		id: "listTeams",
		method: "get",
		path: "/teams",
		tags: [],
		deprecated: false,
		params: [
			{
				name: "filter",
				in: "query",
				required: false,
				contentType: "application/json",
				schema: userSchema,
			},
		],
		responses: [{ status: "200" }],
		security: [{ bearer: [] }],
	},
];

function deepFreeze<T>(value: T): T {
	if (typeof value === "object" && value !== null) {
		for (const item of Object.values(value)) deepFreeze(item);
		Object.freeze(value);
	}
	return value;
}

/**
 * A mini-spec with the given operations and every local `$ref` target they reach, copied to the
 * same pointers, as the per-group spec files hold. Besides `paths`, the model reads only the
 * root `openapi` and `security`.
 */
function slice(spec: OpenApiSpec, picks: readonly { method: string; path: string }[]): OpenApiSpec {
	const out: Record<string, unknown> = {
		openapi: spec.openapi,
		security: spec.security,
		paths: {},
	};
	const at = (root: unknown, pointer: string[]): unknown =>
		pointer.reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], root);
	const pointer = (ref: string) =>
		decodeURIComponent(ref.slice(2))
			.split("/")
			.map((key) => key.replaceAll("~1", "/").replaceAll("~0", "~"));
	const seen = new Set<string>();
	const visit = (node: unknown): void => {
		if (typeof node !== "object" || node === null) return;
		const { $ref } = node as { $ref?: unknown };
		if (typeof $ref === "string" && $ref.startsWith("#/") && !seen.has($ref)) {
			seen.add($ref);
			const keys = pointer($ref);
			let parent = out;
			for (const key of keys.slice(0, -1)) parent = (parent[key] ??= {}) as Record<string, unknown>;
			parent[keys.at(-1)!] = at(spec, keys);
			visit(at(spec, keys));
		}
		for (const item of Object.values(node)) visit(item);
	};
	const paths = out.paths as Record<string, Record<string, unknown>>;
	for (const { method, path } of picks) {
		const item = spec.paths![path] as Record<string, unknown>;
		const copy = (paths[path] ??= {});
		for (const key of ["$ref", "parameters", method]) if (key in item) copy[key] = item[key];
		visit(copy);
	}
	return out;
}

describe("operations", () => {
	it("derives the conformance fixture in paths order, then method order", () => {
		const result = operations(deepFreeze(structuredClone(conformance)));
		expect(result.operations).toEqual(expected);
		expect(result.diagnostics).toEqual([
			{
				level: "error",
				code: "missing-operation-id",
				method: "delete",
				path: "/users/{id}",
				message: "DELETE /users/{id} has no operationId, so it gets no command",
				fix: "Add a unique operationId to the operation in the spec",
			},
		]);
	});

	it("derives the same operations from a slice that holds them and the $ref targets they reach", () => {
		const users = expected.filter(({ tags }) => tags[0] === "Users");
		const part = slice(conformance, users);
		expect(Object.keys((part.components as object) ?? {}).sort()).toEqual([
			"parameters",
			"responses",
			"schemas",
		]);
		expect(operations(part).operations).toEqual(users);

		const teams = slice(conformance, [{ method: "get", path: "/teams" }]);
		expect(operations(teams).operations).toEqual(expected.slice(3));
	});

	it("turns 3.0 nullable into a type union on parameters, bodies, body fields and responses", () => {
		const spec = (version: string) => ({
			openapi: version,
			paths: {
				"/pets": {
					put: {
						operationId: "putPet",
						parameters: [{ name: "q", in: "query", schema: { type: "string", nullable: true } }],
						requestBody: {
							content: {
								"application/vnd.api+json": {
									schema: {
										type: "object",
										nullable: true,
										properties: {
											age: { type: ["integer"], nullable: true },
											any: { nullable: true },
										},
									},
								},
							},
						},
						responses: {
							"200": {
								content: { "application/json": { schema: { type: "string", nullable: false } } },
							},
						},
					},
				},
			},
		});
		const [pet] = operations(spec("3.0.3")).operations;
		expect(pet?.params[0]?.schema).toEqual({ type: ["string", "null"] });
		expect(pet?.body).toEqual({
			required: false,
			contentType: "application/vnd.api+json",
			schema: {
				type: ["object", "null"],
				properties: { age: { type: ["integer", "null"] }, any: {} },
			},
		});
		expect(pet?.responses[0]?.schema).toEqual({ type: "string" });

		const [pet31] = operations(spec("3.1.0")).operations;
		expect(pet31?.params[0]?.schema).toEqual({ type: "string", nullable: true });
	});

	it("keeps recursive and dangling $refs inside schemas as $ref", () => {
		const recursive = {
			openapi: "3.1.0",
			paths: {
				"/nodes": {
					post: {
						operationId: "addNode",
						requestBody: {
							content: { "application/json": { schema: { $ref: "#/components/schemas/Node" } } },
						},
					},
				},
			},
			components: {
				schemas: {
					Node: {
						allOf: [{ $ref: "#/components/schemas/Node" }, { $ref: "#/components/schemas/Gone" }],
						properties: { child: { $ref: "#/components/schemas/Node" }, x: { $ref: "#/x" } },
					},
				},
			},
		};
		const [node] = operations(recursive).operations;
		expect(node?.body?.schema).toEqual(recursive.components.schemas.Node);
	});

	it("publishes a 3.1 $ref with siblings as the siblings plus its target as the first allOf member, and ignores them in 3.0", () => {
		const base = {
			type: "object",
			description: "Base",
			properties: { id: { type: "string" } },
			required: ["id"],
		};
		const name = { type: "string", minLength: 1, description: "A name" };
		const spec = (version: string) => ({
			openapi: version,
			paths: {
				"/things": {
					post: {
						operationId: "addThing",
						requestBody: {
							content: {
								"application/json": {
									schema: {
										$ref: "#/components/schemas/Base",
										description: "A thing",
										properties: {
											extra: { type: "string" },
											short: { $ref: "#/components/schemas/Name", maxLength: 5 },
											long: { $ref: "#/components/schemas/Name", minLength: 3 },
										},
										required: ["extra"],
									},
								},
							},
						},
					},
				},
			},
			components: { schemas: { Base: base, Name: name } },
		});
		const { $ref: _ref, ...siblings } =
			spec("3.1.0").paths["/things"].post.requestBody.content["application/json"].schema;
		const [thing] = operations(spec("3.1.0")).operations;
		// The siblings stay as written and the target becomes the first `allOf` member.
		expect(thing?.body?.schema).toEqual({ ...siblings, allOf: [base] });

		const [thing30] = operations(spec("3.0.3")).operations;
		expect(thing30?.body?.schema).toEqual(base);
	});

	it("keeps a 3.1 sibling allOf beside a $ref, whatever the target", () => {
		const body = (base: unknown) => ({
			openapi: "3.1.0",
			paths: {
				"/t": {
					post: {
						operationId: "t",
						requestBody: {
							content: {
								"application/json": {
									schema: {
										$ref: "#/components/schemas/Base",
										type: "object",
										allOf: [{ properties: { name: { type: "string" } }, required: ["name"] }],
									},
								},
							},
						},
					},
				},
			},
			components: { schemas: { Base: base } },
		});
		const member = { properties: { name: { type: "string" } }, required: ["name"] };
		expect(operations(body({ type: "object" })).operations[0]?.body?.schema).toEqual({
			type: "object",
			allOf: [{ type: "object" }, member],
		});
		expect(operations(body(true)).operations[0]?.body?.schema).toEqual({
			type: "object",
			allOf: [true, member],
		});
		expect(operations(body(false)).operations[0]?.body?.schema).toEqual({
			type: "object",
			allOf: [false, member],
		});
	});

	it("keeps a keyword that depends on its neighbors beside the $ref target and the sibling allOf", () => {
		const spec = {
			openapi: "3.1.0",
			paths: {
				"/t": {
					post: {
						operationId: "t",
						requestBody: {
							content: {
								"application/json": {
									schema: {
										$ref: "#/components/schemas/Base",
										allOf: [{ properties: { name: { type: "string" } } }],
										unevaluatedProperties: false,
									},
								},
							},
						},
					},
				},
			},
			components: { schemas: { Base: { type: "object" } } },
		};
		expect(operations(spec).operations[0]?.body?.schema).toEqual({
			allOf: [{ type: "object" }, { properties: { name: { type: "string" } } }],
			unevaluatedProperties: false,
		});
	});

	it("keeps boolean schemas, also behind a $ref", () => {
		const spec = {
			openapi: "3.1.0",
			paths: {
				"/never": {
					post: {
						operationId: "never",
						parameters: [{ name: "q", in: "query", schema: false }],
						requestBody: { content: { "application/json": { schema: false } } },
						responses: {
							"200": {
								content: { "application/json": { schema: { $ref: "#/components/schemas/Never" } } },
							},
							"201": { content: { "application/json": { schema: true } } },
						},
					},
				},
			},
			components: { schemas: { Never: false } },
		};
		const [never] = operations(spec).operations;
		expect(never?.params[0]?.schema).toBe(false);
		expect(never?.body?.schema).toBe(false);
		expect(never?.responses.map(({ schema }) => schema)).toEqual([false, true]);
	});

	it("lists a body property named __proto__ as an own property", () => {
		const spec = JSON.parse(`{
			"openapi": "3.1.0",
			"paths": { "/p": { "post": { "operationId": "p", "requestBody": { "content": {
				"application/json": { "schema": { "type": "object", "properties": {
					"__proto__": { "type": "string" }, "name": { "type": "string" }
				} } }
			} } } } }
		}`);
		const [p] = operations(spec).operations;
		const { properties } = p!.body!.schema as { properties: object };
		expect(Object.keys(properties)).toEqual(["__proto__", "name"]);
		expect(Object.getOwnPropertyDescriptor(properties, "__proto__")?.value).toEqual({
			type: "string",
		});
	});

	it("publishes an allOf body as written, without hoisting its members' fields", () => {
		const schema = {
			allOf: [{ properties: { a: { type: "string" } }, required: ["a"] }],
			additionalProperties: false,
		};
		const spec = {
			openapi: "3.1.0",
			paths: {
				"/a": {
					post: { operationId: "a", requestBody: { content: { "application/json": { schema } } } },
					put: {
						operationId: "b",
						requestBody: {
							content: {
								"application/json": {
									schema: { $ref: "#/components/schemas/A", additionalProperties: false },
								},
							},
						},
					},
				},
			},
			components: { schemas: { A: { properties: { a: { type: "string" } }, required: ["a"] } } },
		};
		const [a, b] = operations(spec).operations;
		expect(a?.body?.schema).toEqual(schema);
		expect(b?.body?.schema).toEqual({
			additionalProperties: false,
			allOf: [spec.components.schemas.A],
		});
	});

	it("translates a 3.0 schema into JSON Schema at every inline level, and leaves 3.1 as written", () => {
		const schema = {
			type: "object",
			properties: {
				name: { type: "string", nullable: true },
				tags: { type: "array", items: { type: "string", nullable: true } },
				owner: {
					$ref: "#/components/schemas/Owner",
					nullable: true,
					description: "ignored in 3.0",
				},
				count: {
					type: "integer",
					minimum: 0,
					exclusiveMinimum: true,
					maximum: 9,
					exclusiveMaximum: false,
				},
				size: { type: "number", exclusiveMaximum: true },
			},
			allOf: [{ properties: { note: { type: "string", nullable: true } } }],
			additionalProperties: { type: "boolean", nullable: true },
		};
		const spec = (openapi: string) => ({
			openapi,
			paths: {
				"/a": {
					post: { operationId: "a", requestBody: { content: { "application/json": { schema } } } },
				},
			},
			components: { schemas: { Owner: { type: "string", nullable: true } } },
		});
		const [a30] = operations(spec("3.0.3")).operations;
		expect(a30?.body?.schema).toEqual({
			type: "object",
			properties: {
				name: { type: ["string", "null"] },
				tags: { type: "array", items: { type: ["string", "null"] } },
				owner: { $ref: "#/components/schemas/Owner" },
				count: { type: "integer", exclusiveMinimum: 0, maximum: 9 },
				size: { type: "number" },
			},
			allOf: [{ properties: { note: { type: ["string", "null"] } } }],
			additionalProperties: { type: ["boolean", "null"] },
		});
		const [a31] = operations(spec("3.1.0")).operations;
		expect(a31?.body?.schema).toEqual(schema);
	});

	it("keeps every operation sharing an operationId and flags each", () => {
		const spec = {
			openapi: "3.0.0",
			paths: {
				"/a": { get: { operationId: "same" } },
				"/b": { get: { operationId: "same" }, post: { operationId: "other" } },
			},
		};
		const result = operations(spec);
		expect(result.operations.map(({ id, path }) => `${id} ${path}`)).toEqual([
			"same /a",
			"same /b",
			"other /b",
		]);
		expect(result.diagnostics.map(({ code, path }) => `${code} ${path}`)).toEqual([
			"duplicate-operation-id /a",
			"duplicate-operation-id /b",
		]);
	});

	it.each<[string, Record<string, unknown>]>([
		["a Swagger 2.0 document", { swagger: "2.0", paths: { "/a": { get: { operationId: "a" } } } }],
		["a document without a version", { paths: {} }],
		["OpenAPI 3.2", { openapi: "3.2.0", paths: {} }],
		["a non-string version", { openapi: 3.1, paths: {} }],
	])("derives nothing from %s", (_, spec) => {
		expect(operations(spec)).toEqual({
			operations: [],
			diagnostics: [
				{
					level: "error",
					code: "unsupported-version",
					message: expect.stringContaining("OpenAPI 3.0 and 3.1"),
					fix: "Convert the document to OpenAPI 3.1 or 3.0",
				},
			],
		});
	});
});
