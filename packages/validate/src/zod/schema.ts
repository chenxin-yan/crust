import { CrustError } from "@crustjs/core";
import type {
	ArgOptions,
	ArgSpec,
	FlagOptions,
	FlagSpec,
	ZodSchemaLike,
} from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Runtime guards
// ────────────────────────────────────────────────────────────────────────────

/** Narrow unknown input to a Zod schema instance. */
function isZodSchema(value: unknown): value is ZodSchemaLike {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	if (!("_zod" in value)) {
		return false;
	}
	return true;
}

// ────────────────────────────────────────────────────────────────────────────
// Public schema-first DSL
// ────────────────────────────────────────────────────────────────────────────

/**
 * Define a named positional argument schema for `defineZodCommand()`.
 *
 * The `const Variadic` parameter preserves `{ variadic: true }` as a
 * literal in the return type, enabling compile-time variadic position
 * validation in `defineZodCommand()`.
 *
 * @param name - Positional arg name used in parser output and help text
 * @param schema - Zod schema
 * @param options - Optional CLI metadata (description, variadic)
 */
export function arg<
	Name extends string,
	Schema extends ZodSchemaLike,
	const Variadic extends true | undefined = undefined,
>(
	name: Name,
	schema: Schema,
	options?: ArgOptions & { variadic?: Variadic },
): ArgSpec<Name, Schema, Variadic> {
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

	return {
		kind: "arg",
		name,
		schema,
		variadic: options?.variadic as Variadic,
	};
}

/**
 * Define a flag schema for `defineZodCommand()` with optional alias/description.
 *
 * The `const Alias` parameter preserves alias literals (e.g. `"v"` or
 * `readonly ["v", "V"]`) in the return type, enabling compile-time alias
 * collision detection in `defineZodCommand()`.
 *
 * @param schema - Zod schema
 * @param options - Optional flag metadata
 */
export function flag<
	Schema extends ZodSchemaLike,
	const Alias extends string | readonly string[] | undefined = undefined,
>(
	schema: Schema,
	options?: FlagOptions & { alias?: Alias },
): FlagSpec<Schema, Alias> {
	if (!isZodSchema(schema)) {
		throw new CrustError("DEFINITION", "flag(): schema must be a Zod schema");
	}

	return {
		kind: "flag",
		schema,
		alias: options?.alias as Alias,
	};
}

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────────

/** Extract flag metadata wrapper state. */
export function isFlagSpec(value: unknown): value is FlagSpec {
	return (
		typeof value === "object" &&
		value !== null &&
		"kind" in value &&
		(value as { kind?: unknown }).kind === "flag"
	);
}

/** Resolve the underlying schema from a plain schema or a `flag()` wrapper. */
export function getFlagSchema(value: ZodSchemaLike | FlagSpec): ZodSchemaLike {
	return isFlagSpec(value) ? value.schema : value;
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
