import type { OpenApiSpec } from "./api-command.ts";
import { type JsonSchema, publishedSchema, record } from "./schema.ts";
import { type METHODS, deref, mergeParameters, rawOperations } from "./spec-traversal.ts";

/** A parameter of an {@link Operation}, after its `$ref` and the path item's parameters are resolved. */
export interface Param {
	readonly name: string;
	readonly in: "path" | "query" | "header" | "cookie";
	/** Always `true` for a path parameter. */
	readonly required: boolean;
	/** Its `schema`, or for a parameter described by `content`, that media type's schema. */
	readonly schema?: JsonSchema;
	/** The media type of a parameter described by `content` instead of `schema`. */
	readonly contentType?: string;
	readonly description?: string;
	readonly style?: string;
	readonly explode?: boolean;
}

/**
 * One operation of an OpenAPI 3.0 or 3.1 document, as plain data. Each schema (of a parameter, the
 * body, a response) is a JSON Schema 2020-12 schema that means what the API's schema means: its
 * top-level `$ref` is resolved (in 3.1, a `$ref` with sibling keywords keeps them and its target
 * becomes their first `allOf` member), and a 3.0 document's `nullable`, boolean exclusive bounds and
 * ignored `$ref` siblings are translated at every inline level. Nothing else is rewritten: `allOf`
 * stays as written, and nested `$ref`s stay as they are, so a recursive schema stays finite.
 */
export interface Operation {
	readonly id: string;
	readonly method: (typeof METHODS)[number];
	readonly path: string;
	readonly tags: readonly string[];
	readonly summary?: string;
	readonly description?: string;
	readonly deprecated: boolean;
	/**
	 * The path item's parameters and the operation's, an operation parameter replacing a path
	 * item parameter with the same `name` and `in`. `Accept`, `Content-Type` and `Authorization`
	 * header parameters are left out, as OpenAPI says to ignore them.
	 */
	readonly params: readonly Param[];
	/** The request body's JSON media type, or its first one when none is JSON. */
	readonly body?: {
		readonly required: boolean;
		readonly contentType: string;
		readonly schema?: JsonSchema;
	};
	/** Each response by status (`"200"`, `"2XX"`, `"default"`), with its JSON media type or its first one. */
	readonly responses: readonly {
		readonly status: string;
		readonly contentType?: string;
		readonly schema?: JsonSchema;
	}[];
	/** The operation's security requirements, else the document's; `[]` means a public operation. */
	readonly security?: readonly Readonly<Record<string, readonly string[]>>[];
}

/** A problem that keeps an operation from becoming a command (`"error"`) or that is worth a look. */
export interface Diagnostic {
	readonly level: "error" | "warning";
	readonly code:
		| "unsupported-version"
		| "missing-operation-id"
		| "duplicate-operation-id"
		| "no-success-response"
		| "missing-summary"
		| "unsupported-param-style"
		| "content-param"
		| "required-cookie-param"
		| "cookie-param-ignored"
		| "unsupported-body-type"
		| "command-collision"
		| "flag-collision"
		| "reserved-input-name"
		| "unflaggable-name"
		| "body-field-shadowed"
		| "many-root-commands"
		| "override-unknown-operation"
		| "override-stale"
		| "override-unknown-param"
		| "confirm-without-handler";
	readonly message: string;
	/** What to change in the spec or the configuration. */
	readonly fix: string;
	/** Set when the diagnostic is about one operation, or an override's operationId. */
	readonly operationId?: string;
	readonly method?: Operation["method"];
	readonly path?: string;
}

const SUPPORTED_VERSION = /^3\.[01](?:\.|$)/;
// OpenAPI: "If in is "header" and the name field is "Accept", "Content-Type" or "Authorization",
// the parameter definition SHALL be ignored."
const IGNORED_HEADERS = new Set(["accept", "content-type", "authorization"]);
const LOCATIONS: readonly unknown[] = ["path", "query", "header", "cookie"];

/** `application/json` and `application/<anything>+json`, with or without parameters. */
export function isJsonMediaType(type: string): boolean {
	return /^application\/(?:[^\s;/]+\+)?json\s*(?:;|$)/i.test(type);
}

/** `METHOD path`, as `api --list` prints it. */
export function operationLabel(method: string, path: string): string {
	return `${method.toUpperCase()} ${path}`;
}

/**
 * Every operation of an OpenAPI 3.0 or 3.1 document that has an operationId, in `paths` order and
 * then `get`, `put`, `post`, `delete`, `options`, `head`, `patch`, `trace`, as `api --list` lists them.
 * Keys of `paths` not starting with `/` are skipped. Deprecated operations are included. The
 * diagnostics report an unsupported version (and no operations), an operation without an operationId
 * (left out; not reported when it is deprecated) and operationIds several operations share.
 */
export function operations(spec: OpenApiSpec): {
	operations: Operation[];
	diagnostics: Diagnostic[];
} {
	const { openapi } = spec;
	if (typeof openapi !== "string" || !SUPPORTED_VERSION.test(openapi)) {
		const found =
			typeof openapi === "string"
				? `OpenAPI ${openapi}`
				: typeof spec.swagger === "string"
					? `Swagger ${spec.swagger}`
					: "without an openapi version";
		return {
			operations: [],
			diagnostics: [
				{
					level: "error",
					code: "unsupported-version",
					message: `Only OpenAPI 3.0 and 3.1 documents are supported; this one is ${found}`,
					fix: "Convert the document to OpenAPI 3.1 or 3.0",
				},
			],
		};
	}
	const schemaOf = (value: unknown): JsonSchema | undefined => {
		const schema = publishedSchema(spec, value);
		return typeof schema === "boolean" ? schema : record(schema);
	};
	const mediaOf = (content: unknown): { contentType: string; schema?: JsonSchema } | undefined => {
		const entries = Object.entries(record(content) ?? {});
		const [contentType, media] =
			entries.find(([type]) => isJsonMediaType(type)) ?? entries[0] ?? [];
		if (contentType === undefined) return undefined;
		const schema = schemaOf(record(media)?.schema);
		return { contentType, ...(schema !== undefined && { schema }) };
	};

	const diagnostics: Diagnostic[] = [];
	const result: Operation[] = [];
	for (const { method, path, operation, shared } of rawOperations(spec)) {
		const op = operation as Readonly<Record<string, unknown>>;
		const id = text(op.operationId);
		if (id === undefined) {
			if (op.deprecated !== true) {
				diagnostics.push({
					level: "error",
					code: "missing-operation-id",
					method,
					path,
					message: `${operationLabel(method, path)} has no operationId, so it gets no command`,
					fix: "Add a unique operationId to the operation in the spec",
				});
			}
			continue;
		}

		const params: Param[] = [];
		for (const value of mergeParameters(spec, shared, op.parameters)) {
			const param = record(deref(spec, value));
			const name = param?.name;
			const location = param?.in as Param["in"];
			if (param === undefined || typeof name !== "string" || !LOCATIONS.includes(location))
				continue;
			if (location === "header" && IGNORED_HEADERS.has(name.toLowerCase())) continue;
			const media = param.content === undefined ? undefined : mediaOf(param.content);
			const schema = media === undefined ? schemaOf(param.schema) : media.schema;
			const description = text(param.description);
			params.push({
				name,
				in: location,
				required: location === "path" || param.required === true,
				...(schema !== undefined && { schema }),
				...(media && { contentType: media.contentType }),
				...(description !== undefined && { description }),
				...(typeof param.style === "string" && { style: param.style }),
				...(typeof param.explode === "boolean" && { explode: param.explode }),
			});
		}

		const requestBody = record(deref(spec, op.requestBody));
		const body = requestBody && mediaOf(requestBody.content);
		const responses = Object.entries(record(op.responses) ?? {}).flatMap(([status, value]) => {
			const response = record(deref(spec, value));
			if (response === undefined || status.startsWith("x-")) return [];
			return [{ status, ...mediaOf(response.content) }];
		});
		const security = Array.isArray(op.security)
			? op.security
			: Array.isArray(spec.security)
				? spec.security
				: undefined;
		const summary = text(op.summary);
		const description = text(op.description);
		result.push({
			id,
			method,
			path,
			tags: Array.isArray(op.tags)
				? op.tags.filter((tag): tag is string => typeof tag === "string")
				: [],
			...(summary !== undefined && { summary }),
			...(description !== undefined && { description }),
			deprecated: op.deprecated === true,
			params,
			...(body && { body: { required: requestBody.required === true, ...body } }),
			responses,
			...(security && { security }),
		});
	}

	const byId = Map.groupBy(result, ({ id }) => id);
	for (const { id, method, path } of result) {
		const others = byId.get(id)!.filter((other) => other.method !== method || other.path !== path);
		if (others.length === 0) continue;
		diagnostics.push({
			level: "error",
			code: "duplicate-operation-id",
			operationId: id,
			method,
			path,
			message: `${operationLabel(method, path)} shares the operationId "${id}" with ${others.map((other) => operationLabel(other.method, other.path)).join(", ")}`,
			fix: "Give each operation a unique operationId in the spec",
		});
	}
	return { operations: result, diagnostics };
}

function text(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}
