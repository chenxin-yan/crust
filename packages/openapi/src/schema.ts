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
 * (also `true`); `false` accepts no value, so it is neither. Only one item level is read, so a
 * recursive array schema ends.
 */
export function valueKind(
	spec: OpenApiSpec,
	value: unknown,
	untyped: "scalar" | "other",
): "scalar" | "array" | "other" {
	const kind = shapeOf(spec, value, untyped);
	if (kind !== "array") return kind;
	const items = publishedSchema(spec, (value as Readonly<Record<string, unknown>>).items);
	return shapeOf(spec, items, untyped) === "scalar" ? "array" : "other";
}

/**
 * {@link valueKind} for the schema itself, without reading its `items`. A schema without `type` or
 * `enum` takes the kind of its first `allOf` member that has one, as a `$ref` with sibling keywords
 * becomes; only that one level is read.
 */
function shapeOf(
	spec: OpenApiSpec,
	value: unknown,
	untyped: "scalar" | "other",
): "scalar" | "array" | "other" {
	const own = typeShape(value);
	if (own !== undefined || record(value) === undefined) return own ?? untyped;
	const { allOf } = value as Readonly<Record<string, unknown>>;
	const members = Array.isArray(allOf) ? allOf : [];
	return members.map((member) => typeShape(publishedSchema(spec, member))).find(Boolean) ?? untyped;
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
