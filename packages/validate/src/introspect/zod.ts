// ────────────────────────────────────────────────────────────────────────────
// Zod introspection — duck-types Zod 4 schemas via top-level runtime fields
// ────────────────────────────────────────────────────────────────────────────
//
// Zod 4 schemas are themselves Standard Schemas (they expose `~standard`
// natively). We therefore read directly off the schema; no adapter shim is
// required between the Standard Schema wrapper and the internal Zod API.
//
// We intentionally avoid `_zod.def.*` (Zod's true private internals) and
// instead rely on the stable top-level runtime surface that Zod 4 exposes
// on every schema instance:
//   • `type`         — discriminator string ("string", "optional", "pipe", …)
//   • `unwrap()`     — present on optional/nullable/default/etc. wrappers
//   • `in`           — input schema for `pipe`/`transform`
//   • `values`       — populated for `enum`/`literal`
//   • `description`  — set via `.describe("…")`

import type { StandardSchema } from "../types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Result type — partial because not every property is always inferable
// ────────────────────────────────────────────────────────────────────────────

export interface ZodInferResult {
	type?: "string" | "number" | "boolean";
	multiple?: boolean;
	description?: string;
	optional?: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// Internal duck-typing helpers
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

// ────────────────────────────────────────────────────────────────────────────
// Wrapper unwrapping — walk to the effective input schema
// ────────────────────────────────────────────────────────────────────────────

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

// ────────────────────────────────────────────────────────────────────────────
// Primitive type resolution
// ────────────────────────────────────────────────────────────────────────────

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

// ────────────────────────────────────────────────────────────────────────────
// Optionality detection
// ────────────────────────────────────────────────────────────────────────────

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

// ────────────────────────────────────────────────────────────────────────────
// Description resolution
// ────────────────────────────────────────────────────────────────────────────

/**
 * Resolve description by walking through Zod wrappers.
 *
 * Zod's `.describe()` sets `.description` on the schema node it's called on.
 * Wrappers like `.optional()`, `.default()`, `.transform()`, `.pipe()` create
 * new nodes that lose the description. This function unwraps those layers to
 * find the first `.description` string.
 */
function resolveZodDescription(schema: unknown): string | undefined {
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
// Public entry — full inference for a Zod-based Standard Schema
// ────────────────────────────────────────────────────────────────────────────

/**
 * Infer CLI metadata from a Zod schema (via Standard Schema interface).
 *
 * Returns a partial result; missing fields signal "no inference available"
 * rather than absence of the property. Caller merges with explicit options.
 *
 * Recognises array schemas — when detected, returns `multiple: true` plus
 * the inner element's primitive type.
 */
export function inferFromZod(schema: StandardSchema): ZodInferResult {
	const result: ZodInferResult = {};

	const inputSchema = unwrapInputSchema(schema);

	if (getSchemaType(inputSchema) === "array") {
		const runtime = asRuntimeSchema(inputSchema);
		if (typeof runtime?.unwrap === "function") {
			const elementSchema = unwrapInputSchema(runtime.unwrap());
			const primitive = resolvePrimitiveInputType(elementSchema);
			if (primitive) {
				result.type = primitive;
				result.multiple = true;
			}
		}
	} else {
		const primitive = resolvePrimitiveInputType(inputSchema);
		if (primitive) {
			result.type = primitive;
			result.multiple = false;
		}
	}

	const description = resolveZodDescription(schema);
	if (description !== undefined) {
		result.description = description;
	}

	result.optional = isOptionalInputSchema(schema);

	return result;
}
