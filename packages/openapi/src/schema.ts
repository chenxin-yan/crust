// Schemas as the operation model publishes them, and the internal field listing that lint and the
// generated commands read instead of the published schema.
import type { OpenApiSpec } from "./api-command.ts";
import { isLocalRef, refTarget } from "./spec-traversal.ts";

/** A JSON Schema, an object or a boolean. */
export type JsonSchema = Readonly<Record<string, unknown>> | boolean;

export function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Readonly<Record<string, unknown>>)
		: undefined;
}

export function isOpenApi30(spec: OpenApiSpec): boolean {
	return typeof spec.openapi === "string" && spec.openapi.startsWith("3.0");
}

/**
 * `value` with its local `$ref` chain followed, stopping at a dangling `$ref` or one already on
 * `path`. In 3.1 a `$ref` with sibling keywords applies in place like a one-member `allOf`, so the
 * siblings stay as written and the resolved target becomes the first member of their `allOf`; a
 * `$ref` alone, and every 3.0 `$ref` (whose siblings OpenAPI ignores), is replaced by its target.
 */
function resolveSchema(
	spec: OpenApiSpec,
	value: unknown,
	v30: boolean,
	path: ReadonlySet<string>,
): unknown {
	const node = record(value);
	const ref = node?.$ref;
	if (node === undefined || !isLocalRef(ref) || path.has(ref)) return value;
	const found = refTarget(spec, ref);
	if (found === undefined) return value;
	const target = resolveSchema(spec, found, v30, new Set([...path, ref]));
	if (v30 || Object.keys(node).length === 1) return target;
	const { $ref: _ref, ...siblings } = node;
	return { ...siblings, allOf: [target, ...(Array.isArray(siblings.allOf) ? siblings.allOf : [])] };
}

/**
 * One schema node of an OpenAPI 3.0 document as the JSON Schema 2020-12 node that means the same;
 * its subschemas are left as they are. Every resolver of a 3.0 schema node must call it.
 * - A `$ref` keeps no siblings: 3.0 ignores them.
 * - `nullable: true` adds `"null"` to `type`; without `type` it has no effect in 3.0, so it is dropped.
 * - The boolean `exclusiveMinimum` / `exclusiveMaximum` become the numeric form.
 */
export function fromOpenApi30Node(
	node: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
	if (Object.hasOwn(node, "$ref")) return { $ref: node.$ref };
	const { nullable, exclusiveMinimum, exclusiveMaximum, ...out } = node as Record<string, unknown>;
	for (const [bound, exclusive, limit] of [
		["minimum", exclusiveMinimum, "exclusiveMinimum"],
		["maximum", exclusiveMaximum, "exclusiveMaximum"],
	] as const) {
		if (exclusive === true && typeof out[bound] === "number") {
			out[limit] = out[bound];
			delete out[bound];
		} else if (exclusive !== undefined && typeof exclusive !== "boolean") {
			out[limit] = exclusive;
		}
	}
	const { type } = out;
	if (nullable === true && typeof type === "string") out.type = [type, "null"];
	if (nullable === true && Array.isArray(type) && !type.includes("null"))
		out.type = [...type, "null"];
	return out;
}

const SCHEMA_MAPS = ["properties", "patternProperties"];
const SCHEMAS = ["additionalProperties", "items", "not"];
const SCHEMA_LISTS = ["prefixItems", "allOf", "anyOf", "oneOf"];

/** `value` with {@link fromOpenApi30Node} applied to it and every inline subschema; `$ref`s are not followed. */
function fromOpenApi30(value: unknown, ancestors: Set<object> = new Set()): unknown {
	const node = record(value);
	if (node === undefined || ancestors.has(node)) return value;
	const out: Record<string, unknown> = { ...fromOpenApi30Node(node) };
	if (Object.hasOwn(out, "$ref")) return out;
	ancestors.add(node);
	const sub = (item: unknown) => fromOpenApi30(item, ancestors);
	for (const key of SCHEMA_MAPS) {
		const map = record(out[key]);
		if (map)
			out[key] = Object.fromEntries(Object.entries(map).map(([name, item]) => [name, sub(item)]));
	}
	for (const key of SCHEMAS) if (Object.hasOwn(out, key)) out[key] = sub(out[key]);
	for (const key of SCHEMA_LISTS) {
		const list = out[key];
		if (Array.isArray(list)) out[key] = list.map(sub);
	}
	ancestors.delete(node);
	return out;
}

/**
 * A schema as the model publishes it: a JSON Schema 2020-12 schema that means what the API's
 * schema means. Its top-level `$ref` is resolved by {@link resolveSchema}; in a 3.0 document the
 * dialect differences are translated ({@link fromOpenApi30Node}) at every inline level. Nothing
 * else is rewritten, and nested `$ref`s stay as they are.
 */
export function publishedSchema(
	spec: OpenApiSpec,
	value: unknown,
	path: ReadonlySet<string> = new Set(),
): unknown {
	const v30 = isOpenApi30(spec);
	const resolved = resolveSchema(spec, value, v30, path);
	return v30 ? fromOpenApi30(resolved) : resolved;
}

/** A top-level field of an object schema, as {@link schemaFields} lists it. */
export interface SchemaField {
	readonly name: string;
	readonly required: boolean;
	/** The field's schema as published. */
	readonly schema: unknown;
	/** What a flag can carry: {@link valueKind}. */
	readonly kind: "scalar" | "array" | "other";
}

/**
 * The top-level fields of an object schema: its own `properties` and `required` and those of every
 * `allOf` member, each member resolved like a published schema; the first definition of a name
 * wins. A schema referred to twice is read twice (its siblings may differ); a `$ref` already being
 * expanded is not followed again (in 3.1 the keywords beside it still count). Reads `schema` only.
 */
export function schemaFields(spec: OpenApiSpec, schema: unknown): SchemaField[] {
	const v30 = isOpenApi30(spec);
	// A Map, since assigning a `__proto__` key to a plain object sets its prototype instead.
	const properties = new Map<string, unknown>();
	const required = new Set<string>();
	const seen = new Set<unknown>();
	const collect = (part: unknown, path: ReadonlySet<string>): void => {
		const raw = record(part);
		const ref = raw?.$ref;
		// A plain `$ref` (3.0 ignores siblings) to a schema already read adds nothing.
		const key = isLocalRef(ref) && (v30 || Object.keys(raw!).length === 1) ? ref : part;
		if (seen.has(key)) return;
		seen.add(key);
		const node = record(publishedSchema(spec, part, path));
		if (node === undefined) return;
		for (const [name, property] of Object.entries(record(node.properties) ?? {})) {
			if (!properties.has(name)) properties.set(name, property);
		}
		for (const name of Array.isArray(node.required) ? node.required : []) {
			if (typeof name === "string") required.add(name);
		}
		const inner = isLocalRef(ref) ? new Set([...path, ref]) : path;
		for (const member of Array.isArray(node.allOf) ? node.allOf : []) collect(member, inner);
	};
	collect(schema, new Set());
	return [...properties].map(([name, property]) => {
		const field = publishedSchema(spec, property);
		return {
			name,
			required: required.has(name),
			schema: field,
			kind: valueKind(spec, field, "other"),
		};
	});
}

/**
 * Whether a schema's values fit a typed flag: a scalar (a scalar type, or an enum of scalars), an
 * array of scalars, or neither. `untyped` is the kind of a schema with no `type` and no `enum`
 * (also `true`); `false` accepts no value, so it is neither. `type`, `enum` and `items` are read
 * from one {@link typedView}, and only one item level is read, so a recursive array schema ends.
 */
export function valueKind(
	spec: OpenApiSpec,
	value: unknown,
	untyped: "scalar" | "other",
): "scalar" | "array" | "other" {
	const view = typedView(spec, value, 0);
	const kind = view === undefined ? untyped : typeShape(view)!;
	if (kind !== "array") return kind;
	const items = typedView(spec, publishedSchema(spec, record(view)?.items), 0);
	return (items === undefined ? untyped : typeShape(items)) === "scalar" ? "array" : "other";
}

/** Whether a schema's values are arrays, by its own `type` or its {@link typedView}. */
export function isArraySchema(spec: OpenApiSpec, value: unknown): boolean {
	return typeShape(typedView(spec, value, 0)) === "array";
}

/**
 * The flag value of a schema {@link valueKind} calls a scalar or an array of scalars: `number` for
 * numbers and integers, `boolean`, else `string`, with a string enum as `choices`. A numeric enum
 * is a plain `number`: the API checks it.
 */
export function flagValue(
	spec: OpenApiSpec,
	value: unknown,
): { type: "string" | "number" | "boolean"; multiple: boolean; choices?: string[] } {
	const view = record(typedView(spec, value, 0));
	const multiple = typeShape(view) === "array";
	const item = multiple ? record(typedView(spec, publishedSchema(spec, view?.items), 0)) : view;
	const values = Array.isArray(item?.enum) ? item.enum.filter((entry) => entry !== null) : [];
	const types = [item?.type, ...values.map((entry) => typeof entry)].flat();
	const type = types.some((entry) => entry === "number" || entry === "integer")
		? "number"
		: types.includes("boolean")
			? "boolean"
			: "string";
	const choices = values.every((entry): entry is string => typeof entry === "string") ? values : [];
	return { type, multiple, ...(type === "string" && choices.length > 0 && { choices }) };
}

/** The node budget of {@link standaloneSchema}: a larger schema is too big to publish whole. */
const STANDALONE_NODES = 2000;
/** Keys whose values are data, not schemas. */
const DATA_KEYS = new Set(["const", "enum", "default", "examples", "example"]);
/** Keys whose values map names to schemas. */
const NAMED_SCHEMAS = new Set(["properties", "patternProperties", "dependentSchemas"]);

/**
 * `value` as a JSON Schema that stands alone, for `schema()` and MCP, which publish no schema with
 * a `$ref`: each local `$ref` is replaced by its target, resolved like a published schema (so a
 * 3.0 node is translated by {@link fromOpenApi30Node}), and other `$` keywords except `$comment`,
 * and `x-` extensions, are dropped. `undefined` for a recursive schema, a `$ref` that cannot be followed, or one with
 * more than `budget` nodes.
 */
export function standaloneSchema(
	spec: OpenApiSpec,
	value: unknown,
	budget: number = STANDALONE_NODES,
): unknown {
	let nodes = 0;
	const inline = (node: unknown, path: ReadonlySet<string>): unknown => {
		if (++nodes > budget) throw new RangeError("too large");
		if (Array.isArray(node)) return node.map((item) => inline(item, path));
		const object = record(node);
		if (object === undefined) return node;
		const ref = object.$ref;
		if (ref !== undefined) {
			if (!isLocalRef(ref) || path.has(ref) || refTarget(spec, ref) === undefined) {
				throw new RangeError("unresolvable");
			}
			return inline(publishedSchema(spec, object, path), new Set([...path, ref]));
		}
		const out: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(object)) {
			if (key.startsWith("$") && key !== "$comment") {
				if (key === "$dynamicRef" || key === "$recursiveRef") throw new RangeError("dynamic");
				continue;
			}
			// OpenAPI extensions are not JSON Schema, and may hold anything.
			if (key.startsWith("x-")) continue;
			const names = NAMED_SCHEMAS.has(key) ? record(entry) : undefined;
			out[key] = DATA_KEYS.has(key)
				? entry
				: names
					? Object.fromEntries(
							Object.entries(names).map(([name, item]) => [name, inline(item, path)]),
						)
					: inline(entry, path);
		}
		return out;
	};
	try {
		return inline(publishedSchema(spec, value), new Set());
	} catch (error) {
		if (error instanceof RangeError) return undefined;
		throw error;
	}
}

/** How many nested `allOf` levels {@link typedView} searches, so a cycle or a deep chain ends. */
const TYPED_VIEW_DEPTH = 8;

/**
 * The node that classifies a schema: the schema itself when it has a `type` or an `enum` (or is
 * `false`), else the first such node among its `allOf` members, each resolved like a published
 * schema and searched in order through nested `allOf`s, as a `$ref` with sibling keywords and a
 * chain of them wrap their target; `undefined` when there is none within {@link TYPED_VIEW_DEPTH}.
 */
function typedView(spec: OpenApiSpec, value: unknown, depth: number): unknown {
	if (typeShape(value) !== undefined) return value;
	const allOf = record(value)?.allOf;
	if (depth >= TYPED_VIEW_DEPTH || !Array.isArray(allOf)) return undefined;
	for (const member of allOf) {
		const view = typedView(spec, publishedSchema(spec, member), depth + 1);
		if (view !== undefined) return view;
	}
	return undefined;
}

const SCALAR_TYPES: readonly unknown[] = ["string", "number", "integer", "boolean"];

/** The kind a schema's own `type` or `enum` gives, or `undefined` without either. */
function typeShape(value: unknown): "scalar" | "array" | "other" | undefined {
	if (value === false) return "other";
	const schema = record(value);
	if (schema === undefined) return undefined;
	const types = (
		Array.isArray(schema.type) ? schema.type : schema.type === undefined ? [] : [schema.type]
	).filter((type) => type !== "null");
	if (types.length === 0) {
		if (!Array.isArray(schema.enum)) return undefined;
		return schema.enum.every(
			(item) => item === null || ["string", "number", "boolean"].includes(typeof item),
		)
			? "scalar"
			: "other";
	}
	if (types.length > 1) return "other";
	if (SCALAR_TYPES.includes(types[0])) return "scalar";
	return types[0] === "array" ? "array" : "other";
}
