import type { ArgDef, FlagsDef } from "@crustjs/core";
import { CrustError } from "@crustjs/core";
import { isFlagSpec, resolveDescription } from "./schema.ts";
import type { ArgSpecs, FlagShape, FlagSpec, ZodSchemaLike } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Schema analysis helpers
// ────────────────────────────────────────────────────────────────────────────

type InputShape = {
	type: "string" | "number" | "boolean";
	multiple: boolean;
};

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

	for (;;) {
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

/** Resolve Crust parser input shape from a Zod schema. */
function resolveInputShape(schema: ZodSchemaLike, label: string): InputShape {
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
function isOptionalInputSchema(schema: ZodSchemaLike): boolean {
	let current: unknown = schema;

	for (;;) {
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

// ────────────────────────────────────────────────────────────────────────────
// Public definition generation
// ────────────────────────────────────────────────────────────────────────────

/** Build Crust positional arg definitions from ordered `arg()` specs. */
export function argsToDefinitions(args: ArgSpecs): ArgDef[] {
	const seen = new Set<string>();

	for (let i = 0; i < args.length; i++) {
		const spec = args[i];
		if (!spec) continue;

		if (seen.has(spec.name)) {
			throw new CrustError(
				"DEFINITION",
				`defineZodCommand: duplicate arg name "${spec.name}"`,
			);
		}
		seen.add(spec.name);

		if (spec.variadic && i !== args.length - 1) {
			throw new CrustError(
				"DEFINITION",
				`defineZodCommand: only the last arg can be variadic (arg "${spec.name}")`,
			);
		}
	}

	return args.map((spec) => {
		const shape = resolveInputShape(spec.schema, `arg "${spec.name}"`);

		if (spec.variadic && shape.multiple) {
			throw new CrustError(
				"DEFINITION",
				`arg "${spec.name}": variadic args must use a scalar schema; do not wrap the schema in z.array(...)`,
			);
		}

		if (!spec.variadic && shape.multiple) {
			throw new CrustError(
				"DEFINITION",
				`arg "${spec.name}": array schema requires { variadic: true }`,
			);
		}

		const description = resolveDescription(spec.schema, spec.description);
		const required = !isOptionalInputSchema(spec.schema);

		const def: ArgDef = {
			name: spec.name,
			type: shape.type,
			...(description !== undefined && { description }),
			...(spec.variadic && { variadic: true }),
			...(required && { required: true }),
		};

		return def;
	});
}

function getFlagMetadata(value: ZodSchemaLike | FlagSpec): {
	schema: ZodSchemaLike;
	alias?: string | readonly string[];
	description?: string;
} {
	if (isFlagSpec(value)) {
		return {
			schema: value.schema,
			alias: value.alias,
			description: value.description,
		};
	}
	return { schema: value };
}

/** Build Crust flag definitions from schema-first `flags` shape. */
export function flagsToDefinitions(flags: FlagShape | undefined): FlagsDef {
	if (!flags) {
		return {};
	}

	const result: FlagsDef = {};

	for (const [name, value] of Object.entries(flags)) {
		const metadata = getFlagMetadata(value);
		const { schema } = metadata;
		const shape = resolveInputShape(schema, `flag "--${name}"`);
		const required = !isOptionalInputSchema(schema);
		const description = resolveDescription(schema, metadata.description);

		// Convert readonly alias to mutable for core FlagDef compatibility
		const alias: string | string[] | undefined =
			metadata.alias === undefined
				? undefined
				: typeof metadata.alias === "string"
					? metadata.alias
					: [...metadata.alias];

		result[name] = {
			type: shape.type,
			...(shape.multiple && { multiple: true }),
			...(alias !== undefined && { alias }),
			...(description !== undefined && { description }),
			...(required && { required: true }),
		};
	}

	return result;
}
