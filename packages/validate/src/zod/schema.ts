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

/** Narrow unknown input to Standard Schema-compatible validator shape. */
function isStandardSchema(value: unknown): value is ZodSchemaLike {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	if (!("~standard" in value)) {
		return false;
	}
	const standard = (value as { "~standard"?: unknown })["~standard"];
	if (typeof standard !== "object" || standard === null) {
		return false;
	}
	return (
		"validate" in standard &&
		typeof (standard as { validate?: unknown }).validate === "function"
	);
}

// ────────────────────────────────────────────────────────────────────────────
// Public schema-first DSL
// ────────────────────────────────────────────────────────────────────────────

/**
 * Define a named positional argument schema for `defineZodCommand()`.
 *
 * @param name - Positional arg name used in parser output and help text
 * @param schema - Standard Schema-compatible validator (Zod 4 schema)
 * @param options - Optional CLI metadata (description, variadic)
 */
export function arg<Name extends string, Schema extends ZodSchemaLike>(
	name: Name,
	schema: Schema,
	options?: ArgOptions,
): ArgSpec<Name, Schema> {
	if (!name.trim()) {
		throw new CrustError(
			"DEFINITION",
			"arg(): name is required and must be a non-empty string",
		);
	}
	if (!isStandardSchema(schema)) {
		throw new CrustError(
			"DEFINITION",
			`arg("${name}"): schema must implement Standard Schema (~standard.validate)`,
		);
	}

	return {
		kind: "arg",
		name,
		schema,
		description: options?.description,
		variadic: options?.variadic,
	};
}

/**
 * Define a flag schema for `defineZodCommand()` with optional alias/description.
 *
 * @param schema - Standard Schema-compatible validator (Zod 4 schema)
 * @param options - Optional flag metadata
 */
export function flag<Schema extends ZodSchemaLike>(
	schema: Schema,
	options?: FlagOptions,
): FlagSpec<Schema> {
	if (!isStandardSchema(schema)) {
		throw new CrustError(
			"DEFINITION",
			"flag(): schema must implement Standard Schema (~standard.validate)",
		);
	}

	return {
		kind: "flag",
		schema,
		alias: options?.alias,
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
