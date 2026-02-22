import type { ArgDef, FlagsDef } from "@crustjs/core";
import { CrustError } from "@crustjs/core";
import type { DefinitionAdapter, InputShape } from "../definitionBuilders.ts";
import {
	buildArgDefinitions,
	buildFlagDefinitions,
} from "../definitionBuilders.ts";
import { resolveDescription } from "./schema.ts";
import type { ArgSpecs, FlagShape } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Schema analysis helpers — Zod-specific
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
// Adapter + public definition generation
// ────────────────────────────────────────────────────────────────────────────

const zodAdapter: DefinitionAdapter = {
	resolveInputShape,
	isOptionalInputSchema,
	resolveDescription: resolveDescription as (
		schema: unknown,
	) => string | undefined,
	commandLabel: "defineZodCommand",
	arrayHint: "z.array(...)",
};

/** Build Crust positional arg definitions from ordered `arg()` specs. */
export function argsToDefinitions(args: ArgSpecs): ArgDef[] {
	return buildArgDefinitions(args, zodAdapter);
}

/** Build Crust flag definitions from schema-first `flags` shape. */
export function flagsToDefinitions(flags: FlagShape | undefined): FlagsDef {
	return buildFlagDefinitions(
		flags as Record<string, unknown> | undefined,
		zodAdapter,
	);
}
