import { CrustError } from "@crustjs/core";
import { isSome } from "effect/Option";
import { encodedSchema, isSchema } from "effect/Schema";
import type { AST } from "effect/SchemaAST";
import { getDescriptionAnnotation } from "effect/SchemaAST";
import {
	type ArgOptions,
	EFFECT_SCHEMA,
	type EffectArgDef,
	type EffectFlagDef,
	type EffectSchemaLike,
	type FlagOptions,
} from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Schema introspection — Effect AST walking
// ────────────────────────────────────────────────────────────────────────────

/** Unwrap wrappers until the effective encoded input AST is reached. */
function unwrapInputAst(ast: AST): AST {
	let current = ast;
	const seen = new Set<AST>();

	for (;;) {
		if (seen.has(current)) {
			return current;
		}
		seen.add(current);

		if (current._tag === "Refinement") {
			current = current.from;
			continue;
		}

		if (current._tag === "Transformation") {
			current = current.from;
			continue;
		}

		if (current._tag === "Suspend") {
			current = current.f();
			continue;
		}

		return current;
	}
}

function resolveEnumInputType(
	enums: ReadonlyArray<readonly [string, string | number]>,
): "string" | "number" | undefined {
	let kind: "string" | "number" | undefined;

	for (const [, value] of enums) {
		if (typeof value !== "string" && typeof value !== "number") {
			return undefined;
		}

		const current: "string" | "number" =
			typeof value === "string" ? "string" : "number";
		if (kind === undefined) {
			kind = current;
			continue;
		}

		if (kind !== current) {
			return undefined;
		}
	}

	return kind;
}

function resolvePrimitiveInputType(
	ast: AST,
): "string" | "number" | "boolean" | undefined {
	const unwrapped = unwrapInputAst(ast);

	if (
		unwrapped._tag === "StringKeyword" ||
		unwrapped._tag === "TemplateLiteral"
	) {
		return "string";
	}

	if (unwrapped._tag === "NumberKeyword") {
		return "number";
	}

	if (unwrapped._tag === "BooleanKeyword") {
		return "boolean";
	}

	if (unwrapped._tag === "Literal") {
		if (typeof unwrapped.literal === "string") return "string";
		if (typeof unwrapped.literal === "number") return "number";
		if (typeof unwrapped.literal === "boolean") return "boolean";
		return undefined;
	}

	if (unwrapped._tag === "Enums") {
		return resolveEnumInputType(unwrapped.enums);
	}

	if (unwrapped._tag === "Union") {
		let kind: "string" | "number" | "boolean" | undefined;

		for (const member of unwrapped.types) {
			const resolved = resolvePrimitiveInputType(member);

			if (resolved === undefined) {
				if (unwrapInputAst(member)._tag === "UndefinedKeyword") {
					continue;
				}
				return undefined;
			}

			if (kind === undefined) {
				kind = resolved;
				continue;
			}

			if (kind !== resolved) {
				return undefined;
			}
		}

		return kind;
	}

	return undefined;
}

/** Resolved CLI input shape for a schema. */
interface InputShape {
	type: "string" | "number" | "boolean";
	multiple: boolean;
}

function resolveTupleArrayShape(
	ast: AST,
	label: string,
): InputShape | undefined {
	if (ast._tag !== "TupleType") {
		return undefined;
	}

	if (ast.elements.length > 0) {
		throw new CrustError(
			"DEFINITION",
			`${label}: tuple schemas with fixed elements are not supported for CLI parsing. Use Schema.Array(T) for repeatable arguments.`,
		);
	}

	if (ast.rest.length !== 1) {
		throw new CrustError(
			"DEFINITION",
			`${label}: tuple schemas are not supported for CLI parsing. Use scalar schemas or array schemas with a single element type.`,
		);
	}

	const rest = ast.rest[0];
	if (!rest) {
		throw new CrustError(
			"DEFINITION",
			`${label}: unable to inspect array element schema`,
		);
	}

	const primitive = resolvePrimitiveInputType(rest.type);
	if (!primitive) {
		throw new CrustError(
			"DEFINITION",
			`${label}: array element type must be string, number, or boolean`,
		);
	}

	return { type: primitive, multiple: true };
}

/** Resolve Crust parser input shape from an Effect schema. */
function resolveInputShape(schema: unknown, label: string): InputShape {
	const ast = unwrapInputAst(encodedSchema(schema as EffectSchemaLike).ast);

	const tupleShape = resolveTupleArrayShape(ast, label);
	if (tupleShape) {
		return tupleShape;
	}

	const primitive = resolvePrimitiveInputType(ast);
	if (primitive) {
		return { type: primitive, multiple: false };
	}

	throw new CrustError(
		"DEFINITION",
		`${label}: unsupported schema type for CLI parsing. Use string, number, boolean, enum/literal, or array of these.`,
	);
}

/** Check if the schema accepts `undefined` as encoded input. */
function acceptsUndefined(ast: AST): boolean {
	const unwrapped = unwrapInputAst(ast);

	if (unwrapped._tag === "UndefinedKeyword") {
		return true;
	}

	if (unwrapped._tag === "Union") {
		return unwrapped.types.some((member: AST) => acceptsUndefined(member));
	}

	return false;
}

function isOptionalInputSchema(schema: unknown): boolean {
	return acceptsUndefined(encodedSchema(schema as EffectSchemaLike).ast);
}

// ────────────────────────────────────────────────────────────────────────────
// Description resolution — walk AST annotations
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

// ────────────────────────────────────────────────────────────────────────────
// Public DSL — arg() / flag()
// ────────────────────────────────────────────────────────────────────────────

/**
 * Define a named positional argument from an Effect schema.
 *
 * Returns a core `ArgDef` (accepted by `defineCommand`) enriched with hidden
 * schema metadata (via `[EFFECT_SCHEMA]` symbol) for runtime validation by `withEffect`.
 *
 * CLI metadata (`type`, `required`, `description`, `variadic`) is derived
 * from the schema automatically — single source of truth.
 *
 * @param name - Positional arg name used in parser output and help text
 * @param schema - Effect schema (source of truth for type/optionality/description)
 * @param options - Optional CLI metadata (`variadic`)
 *
 * @example
 * ```ts
 * arg("port", Schema.Number.annotations({ description: "Port to listen on" }))
 * arg("files", Schema.String, { variadic: true })
 * ```
 */
export function arg<
	Name extends string,
	SchemaType extends EffectSchemaLike,
	const Variadic extends true | undefined = undefined,
>(
	name: Name,
	schema: SchemaType,
	options?: ArgOptions & { variadic?: Variadic },
): EffectArgDef<Name, SchemaType, Variadic> {
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

	const shape = resolveInputShape(schema, `arg "${name}"`);
	const variadic = options?.variadic;

	if (variadic && shape.multiple) {
		throw new CrustError(
			"DEFINITION",
			`arg "${name}": variadic args must use a scalar schema; do not wrap the schema in Schema.Array(...)`,
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
		[EFFECT_SCHEMA]: schema,
	};

	return def as EffectArgDef<Name, SchemaType, Variadic>;
}

/**
 * Define a flag from an Effect schema with optional alias.
 *
 * Returns a core `FlagDef` (accepted by `defineCommand`) enriched with hidden
 * schema metadata (via `[EFFECT_SCHEMA]` symbol) for runtime validation by `withEffect`.
 *
 * CLI metadata (`type`, `multiple`, `required`, `description`) is derived
 * from the schema automatically — single source of truth.
 *
 * @param schema - Effect schema (source of truth for type/optionality/description)
 * @param options - Optional flag metadata (`alias`)
 *
 * @example
 * ```ts
 * flag(Schema.Boolean.annotations({ description: "Enable verbose logging" }), { alias: "v" })
 * flag(Schema.UndefinedOr(Schema.Number))
 * ```
 */
export function flag<
	SchemaType extends EffectSchemaLike,
	const Alias extends string | readonly string[] | undefined = undefined,
>(
	schema: SchemaType,
	options?: FlagOptions & { alias?: Alias },
): EffectFlagDef<SchemaType, Alias> {
	if (!isSchema(schema)) {
		throw new CrustError(
			"DEFINITION",
			"flag(): schema must be an Effect schema",
		);
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
		[EFFECT_SCHEMA]: schema,
	};

	return def as EffectFlagDef<SchemaType, Alias>;
}
