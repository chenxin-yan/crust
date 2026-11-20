import { describe, expect, it } from "vite-plus/test";

import { operations } from "./operations.ts";
import { schemaFields } from "./schema.ts";

/** The fields of the body of `spec`'s only operation. */
function bodyFields(spec: Record<string, unknown>) {
	const [op] = operations(spec).operations;
	return schemaFields(spec, op?.body?.schema).map(({ name, required, kind }) => ({
		name,
		required,
		kind,
	}));
}

function bodySpec(openapi: string, schema: unknown, schemas: Record<string, unknown> = {}) {
	return {
		openapi,
		paths: {
			"/t": {
				post: { operationId: "t", requestBody: { content: { "application/json": { schema } } } },
			},
		},
		components: { schemas },
	};
}

describe("schemaFields", () => {
	it("lists the fields of the top level and every allOf member", () => {
		const schema = {
			allOf: [{ properties: { a: { type: "string" } }, required: ["a"] }],
			additionalProperties: false,
		};
		expect(bodyFields(bodySpec("3.1.0", schema))).toEqual([
			{ name: "a", required: true, kind: "scalar" },
		]);
		const a = { properties: { a: { type: "string" } }, required: ["a"] };
		const sibling = { $ref: "#/components/schemas/A", additionalProperties: false };
		expect(bodyFields(bodySpec("3.1.0", sibling, { A: a }))).toEqual([
			{ name: "a", required: true, kind: "scalar" },
		]);
	});

	it("reads each field's kind through its $ref, also beside its own keywords", () => {
		const schema = {
			properties: {
				short: { $ref: "#/components/schemas/Name", maxLength: 5 },
				names: { type: "array", items: { $ref: "#/components/schemas/Name" } },
				nested: { type: "object" },
				never: false,
			},
		};
		expect(bodyFields(bodySpec("3.1.0", schema, { Name: { type: "string" } }))).toEqual([
			{ name: "short", required: false, kind: "scalar" },
			{ name: "names", required: false, kind: "array" },
			{ name: "nested", required: false, kind: "other" },
			{ name: "never", required: false, kind: "other" },
		]);
	});

	it("collects every allOf member that refers to the same schema, and ends on a recursive one", () => {
		const schema = {
			allOf: [
				{
					$ref: "#/components/schemas/Base",
					properties: { first: { type: "string" } },
					required: ["first"],
				},
				{
					$ref: "#/components/schemas/Base",
					properties: { second: { type: "string" } },
					required: ["second"],
				},
			],
		};
		const Base = {
			type: "object",
			properties: { id: { type: "string" } },
			allOf: [{ $ref: "#/components/schemas/Base", properties: { loop: { type: "string" } } }],
		};
		expect(
			bodyFields(bodySpec("3.1.0", schema, { Base })).map(({ name, required }) => [name, required]),
		).toEqual([
			["first", true],
			["id", false],
			["loop", false],
			["second", true],
		]);
		// 3.0 ignores the keywords beside a `$ref`.
		expect(bodyFields(bodySpec("3.0.3", schema, { Base })).map(({ name }) => name)).toEqual(["id"]);
	});

	it("keeps a field named __proto__ as an own field", () => {
		const spec = JSON.parse(`{
			"openapi": "3.1.0",
			"paths": { "/t": { "post": { "operationId": "t", "requestBody": { "content": {
				"application/json": { "schema": { "allOf": [{ "properties": {
					"__proto__": { "type": "string" }, "name": { "type": "string" }
				} }] } }
			} } } } }
		}`);
		expect(bodyFields(spec).map(({ name }) => name)).toEqual(["__proto__", "name"]);
	});
});
