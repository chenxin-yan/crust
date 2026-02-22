import { CrustError } from "@crustjs/core";
import { isSome } from "effect/Option";
import { isSchema } from "effect/Schema";
import type { AST } from "effect/SchemaAST";
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
		variadic: options?.variadic as Variadic,
	};
}

/**
 * Define a flag schema for `defineEffectCommand()` with optional alias metadata.
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
	};
}

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Resolve description by walking through Effect schema AST wrappers.
 *
 * Effect's `.annotations({ description: "..." })` sets a description on the
 * AST node it's called on. Wrappers like `Schema.UndefinedOr()`,
 * `Schema.transform()`, and refinements create new AST nodes that lose the
 * annotation. This function walks through those layers to find the first
 * description annotation.
 */
export function resolveDescription(
	schema: EffectSchemaLike,
): string | undefined {
	return resolveDescriptionFromAst(schema.ast);
}

function resolveDescriptionFromAst(ast: AST): string | undefined {
	const seen = new Set<AST>();

	let current: AST = ast;

	for (;;) {
		if (seen.has(current)) {
			return undefined;
		}
		seen.add(current);

		// Check if this node has a description annotation
		const annotated = getDescriptionAnnotation(current);
		if (isSome(annotated) && typeof annotated.value === "string") {
			return annotated.value;
		}

		// Unwrap transformations — check the input (from) side
		if (current._tag === "Transformation") {
			current = current.from;
			continue;
		}

		// Unwrap refinements — check the base schema
		if (current._tag === "Refinement") {
			current = current.from;
			continue;
		}

		// Unwrap suspensions
		if (current._tag === "Suspend") {
			current = current.f();
			continue;
		}

		// Unwrap unions — find description on non-undefined members
		// (handles patterns like Schema.UndefinedOr(Schema.String.annotations({...})))
		if (current._tag === "Union") {
			for (const member of current.types) {
				if (member._tag === "UndefinedKeyword") {
					continue;
				}
				const desc = resolveDescriptionFromAst(member);
				if (desc !== undefined) {
					return desc;
				}
			}
			return undefined;
		}

		return undefined;
	}
}
