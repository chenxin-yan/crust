import { CrustError } from "@crustjs/core";
import {
	type ArgOptions,
	type FlagOptions,
	ZOD_SCHEMA,
	type ZodArgDef,
	type ZodFlagDef,
	type ZodSchemaLike,
} from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Runtime guards
// ────────────────────────────────────────────────────────────────────────────

/** Narrow unknown input to a Zod schema instance. */
function isZodSchema(value: unknown): value is ZodSchemaLike {
	return typeof value === "object" && value !== null && "_zod" in value;
}

// ────────────────────────────────────────────────────────────────────────────
// Schema introspection — duck-typing Zod 4 internals
// ────────────────────────────────────────────────────────────────────────────

interface ZodRuntimeSchemaLike {
	type?: unknown;
	unwrap?: () => unknown;
	in?: unknown;
	values?: Set<unknown>;
}

function asRuntimeSchema(value: unknown): ZodRuntimeSchemaLike | undefined {
	if (typeof value !== "object" || value === null) {
		return undefined;
	}
	return value as ZodRuntimeSchemaLike;
}

function getSchemaType(schema: unknown): string | undefined {
	const runtime = asRuntimeSchema(schema);
	if (!runtime || typeof runtime.type !== "string") {
		return undefined;
	}
	return runtime.type;
}

/** Unwrap wrappers/pipelines until the effective input schema is reached. */
function unwrapInputSchema(schema: unknown): unknown {
	let current: unknown = schema;
	const seen = new Set<unknown>();

	for (;;) {
		if (seen.has(current)) {
			return current;
		}
		seen.add(current);

		const type = getSchemaType(current);
		const runtime = asRuntimeSchema(current);

		if (!type || !runtime) {
			return current;
		}

		if (type === "pipe" || type === "transform") {
			if (runtime.in === undefined) {
				return current;
			}
			current = runtime.in;
			continue;
		}

		if (
			type === "optional" ||
			type === "nullable" ||
			type === "default" ||
			type === "prefault" ||
			type === "nonoptional" ||
			type === "readonly" ||
			type === "catch"
		) {
			if (typeof runtime.unwrap !== "function") {
				return current;
			}
			current = runtime.unwrap();
			continue;
		}

		return current;
	}
}

function resolvePrimitiveInputType(
	schema: unknown,
): "string" | "number" | "boolean" | undefined {
	const type = getSchemaType(schema);
	if (!type) {
		return undefined;
	}

	if (type === "string" || type === "enum") {
		return "string";
	}

	if (type === "number") {
		return "number";
	}

	if (type === "boolean") {
		return "boolean";
	}

	if (type === "literal") {
		const runtime = asRuntimeSchema(schema);
		const first = runtime?.values?.values().next().value;
		if (typeof first === "string") {
			return "string";
		}
		if (typeof first === "number") {
			return "number";
		}
		if (typeof first === "boolean") {
			return "boolean";
		}
	}

	return undefined;
}

/** Resolved CLI input shape for a schema. */
interface InputShape {
	type: "string" | "number" | "boolean";
	multiple: boolean;
}

/** Resolve Crust parser input shape from a Zod schema. */
function resolveInputShape(schema: unknown, label: string): InputShape {
	const inputSchema = unwrapInputSchema(schema);

	if (getSchemaType(inputSchema) === "array") {
		const runtime = asRuntimeSchema(inputSchema);
		if (typeof runtime?.unwrap !== "function") {
			throw new CrustError(
				"DEFINITION",
				`${label}: unable to inspect array element schema`,
			);
		}
		const elementSchema = unwrapInputSchema(runtime.unwrap());
		const primitive = resolvePrimitiveInputType(elementSchema);
		if (primitive) {
			return { type: primitive, multiple: true };
		}
		throw new CrustError(
			"DEFINITION",
			`${label}: array element type must be string, number, or boolean`,
		);
	}

	const primitive = resolvePrimitiveInputType(inputSchema);
	if (primitive) {
		return { type: primitive, multiple: false };
	}

	throw new CrustError(
		"DEFINITION",
		`${label}: unsupported schema type for CLI parsing. Use string, number, boolean, enum/literal, or array of these.`,
	);
}

/** Check if the schema accepts `undefined` as input. */
function isOptionalInputSchema(schema: unknown): boolean {
	let current: unknown = schema;
	const seen = new Set<unknown>();

	for (;;) {
		if (seen.has(current)) {
			return false;
		}
		seen.add(current);

		const type = getSchemaType(current);
		const runtime = asRuntimeSchema(current);

		if (!type || !runtime) {
			return false;
		}

		if (
			type === "optional" ||
			type === "default" ||
			type === "prefault" ||
			type === "catch"
		) {
			return true;
		}

		if (type === "pipe" || type === "transform") {
			if (runtime.in === undefined) {
				return false;
			}
			current = runtime.in;
			continue;
		}

		if (type === "nullable" || type === "nonoptional" || type === "readonly") {
			if (typeof runtime.unwrap !== "function") {
				return false;
			}
			current = runtime.unwrap();
			continue;
		}

		return false;
	}
}

/**
 * Resolve description by walking through Zod wrappers.
 *
 * Zod's `.describe()` sets `.description` on the schema node it's called on.
 * Wrappers like `.optional()`, `.default()`, `.transform()`, `.pipe()` create
 * new nodes that lose the description. This function unwraps those layers to
 * find the first `.description` string.
 */
export function resolveDescription(schema: unknown): string | undefined {
	let current: unknown = schema;
	const seen = new Set<unknown>();

	for (;;) {
		if (current === undefined || current === null || seen.has(current)) {
			return undefined;
		}
		seen.add(current);

		if (typeof current !== "object") {
			return undefined;
		}

		// Check if this node has a description
		if (
			"description" in current &&
			typeof (current as { description?: unknown }).description === "string"
		) {
			return (current as { description: string }).description;
		}

		// Try to unwrap wrappers to find inner description
		const type =
			"type" in current ? (current as { type?: unknown }).type : undefined;

		if (typeof type !== "string") {
			return undefined;
		}

		// Pipe/transform: check the input side
		if (type === "pipe" || type === "transform") {
			const input = (current as { in?: unknown }).in;
			if (input !== undefined) {
				current = input;
				continue;
			}
			return undefined;
		}

		// Unwrappable wrappers: optional, nullable, default, etc.
		if (
			type === "optional" ||
			type === "nullable" ||
			type === "default" ||
			type === "prefault" ||
			type === "nonoptional" ||
			type === "readonly" ||
			type === "catch"
		) {
			const unwrap = (current as { unwrap?: unknown }).unwrap;
			if (typeof unwrap === "function") {
				current = unwrap();
				continue;
			}
			return undefined;
		}

		return undefined;
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Public DSL — arg() / flag()
// ────────────────────────────────────────────────────────────────────────────

/**
 * Define a named positional argument from a Zod schema.
 *
 * Returns a core `ArgDef` (accepted by `defineCommand`) enriched with hidden
 * schema metadata (via `[ZOD_SCHEMA]` symbol) for runtime validation by `withZod`.
 *
 * CLI metadata (`type`, `required`, `description`, `variadic`) is derived
 * from the schema automatically — single source of truth.
 *
 * @param name - Positional arg name used in parser output and help text
 * @param schema - Zod schema (source of truth for type/optionality/description)
 * @param options - Optional CLI metadata (`variadic`)
 *
 * @example
 * ```ts
 * arg("port", z.number().int().min(1).describe("Port to listen on"))
 * arg("files", z.string(), { variadic: true })
 * ```
 */
export function arg<
	Name extends string,
	Schema extends ZodSchemaLike,
	const Variadic extends true | undefined = undefined,
>(
	name: Name,
	schema: Schema,
	options?: ArgOptions & { variadic?: Variadic },
): ZodArgDef<Name, Schema, Variadic> {
	if (!name.trim()) {
		throw new CrustError(
			"DEFINITION",
			"arg(): name is required and must be a non-empty string",
		);
	}
	if (!isZodSchema(schema)) {
		throw new CrustError(
			"DEFINITION",
			`arg("${name}"): schema must be a Zod schema`,
		);
	}

	const shape = resolveInputShape(schema, `arg "${name}"`);
	const variadic = options?.variadic;

	if (variadic && shape.multiple) {
		throw new CrustError(
			"DEFINITION",
			`arg "${name}": variadic args must use a scalar schema; do not wrap the schema in z.array(...)`,
		);
	}

	if (!variadic && shape.multiple) {
		throw new CrustError(
			"DEFINITION",
			`arg "${name}": array schema requires { variadic: true }`,
		);
	}

	const description = resolveDescription(schema);
	const required = !isOptionalInputSchema(schema);

	const def = {
		name,
		type: shape.type,
		...(description !== undefined && { description }),
		variadic: variadic as Variadic,
		...(required && { required: true as const }),
		[ZOD_SCHEMA]: schema,
	};

	return def as ZodArgDef<Name, Schema, Variadic>;
}

/**
 * Define a flag from a Zod schema with optional alias.
 *
 * Returns a core `FlagDef` (accepted by `defineCommand`) enriched with hidden
 * schema metadata (via `[ZOD_SCHEMA]` symbol) for runtime validation by `withZod`.
 *
 * CLI metadata (`type`, `multiple`, `required`, `description`) is derived
 * from the schema automatically — single source of truth.
 *
 * @param schema - Zod schema (source of truth for type/optionality/description)
 * @param options - Optional flag metadata (`alias`)
 *
 * @example
 * ```ts
 * flag(z.boolean().default(false).describe("Enable verbose logging"), { alias: "v" })
 * flag(z.enum(["json", "text"]).default("text"))
 * ```
 */
export function flag<
	Schema extends ZodSchemaLike,
	const Alias extends string | readonly string[] | undefined = undefined,
>(
	schema: Schema,
	options?: FlagOptions & { alias?: Alias },
): ZodFlagDef<Schema, Alias> {
	if (!isZodSchema(schema)) {
		throw new CrustError("DEFINITION", "flag(): schema must be a Zod schema");
	}

	const shape = resolveInputShape(schema, "flag");
	const required = !isOptionalInputSchema(schema);
	const description = resolveDescription(schema);

	// Convert readonly alias to mutable for core FlagDef compatibility
	const alias: string | string[] | undefined =
		options?.alias === undefined
			? undefined
			: typeof options.alias === "string"
				? options.alias
				: [...options.alias];

	const def = {
		type: shape.type,
		...(shape.multiple && { multiple: true as const }),
		alias,
		...(description !== undefined && { description }),
		...(required && { required: true as const }),
		[ZOD_SCHEMA]: schema,
	};

	return def as ZodFlagDef<Schema, Alias>;
}
