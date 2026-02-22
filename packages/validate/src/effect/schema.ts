import { CrustError } from "@crustjs/core";
import { isSome } from "effect/Option";
import { isSchema } from "effect/Schema";
import { getDescriptionAnnotation } from "effect/SchemaAST";
import type {
	ArgOptions,
	ArgSpec,
	EffectSchemaLike,
	FlagOptions,
	FlagSpec,
} from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Public schema-first DSL
// ────────────────────────────────────────────────────────────────────────────

/**
 * Define a named positional argument schema for `defineEffectCommand()`.
 */
export function arg<
	Name extends string,
	SchemaType extends EffectSchemaLike,
	const Variadic extends true | undefined = undefined,
>(
	name: Name,
	schema: SchemaType,
	options?: ArgOptions & { variadic?: Variadic },
): ArgSpec<Name, SchemaType, Variadic> {
	if (!name.trim()) {
		throw new CrustError(
			"DEFINITION",
			"arg(): name is required and must be a non-empty string",
		);
	}
	if (!isSchema(schema)) {
		throw new CrustError(
			"DEFINITION",
			`arg("${name}"): schema must be an Effect schema`,
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
 * Define a flag schema for `defineEffectCommand()` with optional alias/description.
 */
export function flag<
	SchemaType extends EffectSchemaLike,
	const Alias extends string | readonly string[] | undefined = undefined,
>(
	schema: SchemaType,
	options?: FlagOptions & { alias?: Alias },
): FlagSpec<SchemaType, Alias> {
	if (!isSchema(schema)) {
		throw new CrustError(
			"DEFINITION",
			"flag(): schema must be an Effect schema",
		);
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
export function getFlagSchema(
	value: EffectSchemaLike | FlagSpec,
): EffectSchemaLike {
	return isFlagSpec(value) ? value.schema : value;
}

/** Resolve description from metadata first, then schema annotations. */
export function resolveDescription(
	schema: EffectSchemaLike,
	metaDescription: string | undefined,
): string | undefined {
	if (metaDescription !== undefined) {
		return metaDescription;
	}

	const annotated = getDescriptionAnnotation(schema.ast);
	if (isSome(annotated) && typeof annotated.value === "string") {
		return annotated.value;
	}

	return undefined;
}
