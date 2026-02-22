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
		description: options?.description,
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
		description: options?.description,
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

/** Resolve description from metadata first, then schema description. */
export function resolveDescription(
	schema: unknown,
	metaDescription: string | undefined,
): string | undefined {
	if (metaDescription !== undefined) {
		return metaDescription;
	}
	if (typeof schema !== "object" || schema === null) {
		return undefined;
	}
	if ("description" in schema) {
		const value = (schema as { description?: unknown }).description;
		if (typeof value === "string") {
			return value;
		}
	}
	return undefined;
}
