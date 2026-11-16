import type { OpenApiSpec } from "./api-command.ts";
import {
	type METHODS,
	deref,
	isLocalRef,
	mergeParameters,
	rawOperations,
	refTarget,
} from "./spec-traversal.ts";

/** A JSON Schema as the spec has it, an object or a boolean; nested `$ref`s stay as they are. */
type JsonSchema = Readonly<Record<string, unknown>> | boolean;

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
 * One operation of an OpenAPI 3.0 or 3.1 document, as plain data. Each top-level schema (of a
 * parameter, the body, a body property, a response) is dereferenced, in a 3.1 document with the
 * keywords beside its `$ref` kept, and in a 3.0 document its `nullable: true` becomes a `type`
 * union with `"null"`. An object schema's `properties` and
 * `required` include those of its `allOf` members. Deeper `$ref`s stay as they are, so a recursive
 * schema stays finite.
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
	const v30 = openapi.startsWith("3.0");
	const schemaOf = (value: unknown): JsonSchema | undefined => normalizeSchema(spec, value, v30);
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

export function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Readonly<Record<string, unknown>>)
		: undefined;
}

/** `schema` with a 3.0 `nullable` turned into a `type` union with `"null"`. */
function withNullable(
	schema: Readonly<Record<string, unknown>> | undefined,
	v30: boolean,
): Readonly<Record<string, unknown>> | undefined {
	if (!v30 || schema === undefined || !Object.hasOwn(schema, "nullable")) return schema;
	const { nullable, ...rest } = schema;
	if (nullable !== true) return rest;
	const { type } = rest;
	if (typeof type === "string") return { ...rest, type: [type, "null"] };
	if (Array.isArray(type) && !type.includes("null")) return { ...rest, type: [...type, "null"] };
	return rest;
}

// Keywords that only describe; beside a 3.1 `$ref` they replace the target's.
const ANNOTATIONS = new Set([
	"title",
	"description",
	"default",
	"examples",
	"example",
	"deprecated",
	"readOnly",
	"writeOnly",
	"$comment",
]);
// Keywords whose meaning depends on other keywords of the same schema object.
const ADJACENT_DEPENDENT = new Set([
	"additionalProperties",
	"unevaluatedProperties",
	"unevaluatedItems",
	"items",
	"prefixItems",
	"contains",
	"minContains",
	"maxContains",
	"if",
	"then",
	"else",
]);

/**
 * `value` with its local `$ref` chain followed, stopping at a cycle or a dangling `$ref`. In 3.1 the
 * keywords beside a Schema Object's `$ref` apply with its target, so they are kept: annotations
 * replace the target's, the others are added to it, except that a keyword the target also has, or
 * any keyword when either side has one whose meaning depends on its neighbors, joins the target's
 * `allOf` instead, which keeps the schema's meaning. In 3.0 they are ignored, as OpenAPI says.
 */
function resolveSchema(
	spec: OpenApiSpec,
	value: unknown,
	v30: boolean,
	seen: Set<string> = new Set(),
): unknown {
	const node = record(value);
	const ref = node?.$ref;
	if (node === undefined || !isLocalRef(ref) || seen.has(ref)) return value;
	const found = refTarget(spec, ref);
	if (found === undefined) return value;
	seen.add(ref);
	const target = resolveSchema(spec, found, v30, seen);
	if (v30 || Object.keys(node).length === 1) return target;
	const { $ref: _ref, ...siblings } = node;
	const base = record(target);
	if (base === undefined) return { ...siblings, allOf: [target] };
	const dependent = [...Object.keys(base), ...Object.keys(siblings)].some((key) =>
		ADJACENT_DEPENDENT.has(key),
	);
	const added: [string, unknown][] = [];
	const joined: [string, unknown][] = [];
	for (const [key, item] of Object.entries(siblings)) {
		(ANNOTATIONS.has(key) || (!dependent && !Object.hasOwn(base, key)) ? added : joined).push([
			key,
			item,
		]);
	}
	return {
		...base,
		...Object.fromEntries(added),
		...(joined.length > 0 && {
			allOf: [...(Array.isArray(base.allOf) ? base.allOf : []), Object.fromEntries(joined)],
		}),
	};
}

/**
 * `value` resolved by {@link resolveSchema} and with {@link withNullable}; an object schema also gets
 * the `properties` (each resolved, the first definition of a name kept) and `required` of its
 * `allOf` members.
 */
function normalizeSchema(spec: OpenApiSpec, value: unknown, v30: boolean): JsonSchema | undefined {
	const resolved = resolveSchema(spec, value, v30);
	if (typeof resolved === "boolean") return resolved;
	const schema = withNullable(record(resolved), v30);
	if (
		schema === undefined ||
		(record(schema.properties) === undefined && !Array.isArray(schema.allOf))
	) {
		return schema;
	}
	// A Map, since assigning a `__proto__` key to a plain object sets its prototype instead.
	const properties = new Map<string, unknown>();
	const required = new Set<string>();
	const seenRefs = new Set<string>();
	const seen = new Set<unknown>();
	const collect = (part: unknown): void => {
		const ref = record(part)?.$ref;
		if (isLocalRef(ref)) {
			if (seenRefs.has(ref)) return;
			seenRefs.add(ref);
		}
		const node = record(resolveSchema(spec, part, v30));
		if (node === undefined || seen.has(node)) return;
		seen.add(node);
		for (const [name, property] of Object.entries(record(node.properties) ?? {})) {
			if (properties.has(name)) continue;
			const item = resolveSchema(spec, property, v30);
			properties.set(name, withNullable(record(item), v30) ?? item);
		}
		for (const name of Array.isArray(node.required) ? node.required : []) {
			if (typeof name === "string") required.add(name);
		}
		for (const member of Array.isArray(node.allOf) ? node.allOf : []) collect(member);
	};
	collect(value);
	return {
		...schema,
		properties: Object.fromEntries(properties),
		...(required.size > 0 && { required: [...required] }),
	};
}
