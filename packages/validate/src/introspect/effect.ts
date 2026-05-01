// ────────────────────────────────────────────────────────────────────────────
// Effect introspection — AST walking off the Standard Schema wrapper
// ────────────────────────────────────────────────────────────────────────────
//
// Effect 3.14 made `Schema.standardSchemaV1(s)` return a value that
// `extends make(s.ast)` (PR #4648), so the wrapper exposes `.ast` (the
// same instance as the raw schema's AST). We walk that AST directly.
//
// On Effect 3.13.x or hand-rolled wrappers where `.ast` is missing, we
// return `{}` and let the caller fall back to user-supplied options.

import { CrustError } from "@crustjs/core";
import type { AST } from "effect/SchemaAST";
import type { StandardSchema } from "../types.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Duck-typed access to Effect AST internals
// ─────────────────────────────────────────────────────────────────────────────
//
// `effect` is an *optional* peer dependency. Importing anything from
// `effect/*` at runtime in this file would break Zod-only / Standard-Schema-
// only consumers because the import chain `index.ts` → `schema.ts` →
// `introspect/registry.ts` → `introspect/effect.ts` is unconditional.
//
// To stay zero-runtime-cost when `effect` is absent we duck-type the two
// pieces of Effect's API we need:
//
// 1. `getDescriptionAnnotation(ast)` — reads
//    `ast.annotations[Symbol.for("effect/annotation/Description")]`. We do
//    that read directly.
// 2. `isSome(option)` — just checks `option._tag === "Some"`. We inline that
//    too.
//
// Both shapes have been stable since Effect 3.x; the pure-data fallback is
// equally compatible with 3.14.2 (the documented floor for `.ast`) and
// every later 3.x release.

/** Stable since Effect 3.x; see effect/SchemaAST.ts → `DescriptionAnnotationId`. */
const DESCRIPTION_ANNOTATION_KEY = Symbol.for("effect/annotation/Description");

function readDescriptionAnnotation(ast: AST): string | undefined {
	const annotations = (ast as unknown as { annotations?: unknown }).annotations;
	if (!annotations || typeof annotations !== "object") return undefined;
	const raw = (annotations as Record<symbol, unknown>)[
		DESCRIPTION_ANNOTATION_KEY
	];
	return typeof raw === "string" ? raw : undefined;
}

// ────────────────────────────────────────────────────────────────────────────
// Result type
// ────────────────────────────────────────────────────────────────────────────

export interface EffectInferResult {
	type?: "string" | "number" | "boolean";
	multiple?: boolean;
	description?: string;
	optional?: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// AST extraction — read `.ast` off the Standard Schema wrapper
// ────────────────────────────────────────────────────────────────────────────

interface MaybeWithAst {
	ast?: AST;
}

function getAst(schema: StandardSchema): AST | undefined {
	const maybe = schema as unknown as MaybeWithAst;
	if (maybe.ast && typeof maybe.ast === "object" && "_tag" in maybe.ast) {
		return maybe.ast;
	}
	return undefined;
}

// ────────────────────────────────────────────────────────────────────────────
// AST unwrapping — walk to the effective encoded input
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

// ────────────────────────────────────────────────────────────────────────────
// Primitive type resolution
// ────────────────────────────────────────────────────────────────────────────

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

// ────────────────────────────────────────────────────────────────────────────
// Tuple/Array shape resolution (variadic args)
// ────────────────────────────────────────────────────────────────────────────

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

// ────────────────────────────────────────────────────────────────────────────
// Optionality detection
// ────────────────────────────────────────────────────────────────────────────

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
function resolveDescriptionFromAst(ast: AST): string | undefined {
	const seen = new Set<AST>();

	let current: AST = ast;

	for (;;) {
		if (seen.has(current)) {
			return undefined;
		}
		seen.add(current);

		const annotated = readDescriptionAnnotation(current);
		if (annotated !== undefined) {
			return annotated;
		}

		if (current._tag === "Transformation") {
			current = current.from;
			continue;
		}

		if (current._tag === "Refinement") {
			current = current.from;
			continue;
		}

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
// Public entry — full inference for an Effect-wrapped Standard Schema
// ────────────────────────────────────────────────────────────────────────────

/**
 * Infer CLI metadata from an Effect schema wrapped via
 * `Schema.standardSchemaV1()`.
 *
 * Reads `.ast` off the wrapper. If the wrapper does not expose `.ast`
 * (Effect < 3.14 or hand-rolled wrapper), returns `{}`.
 *
 * Throws `CrustError("DEFINITION")` for structural issues that signal
 * definite user mistakes (e.g. tuple schemas with fixed elements, array
 * elements that are not primitives).
 */
export function inferFromEffect(
	schema: StandardSchema,
	label: string,
): EffectInferResult {
	const ast = getAst(schema);
	if (!ast) {
		return {};
	}

	const result: EffectInferResult = {};

	// resolveTupleArrayShape may throw CrustError for structural issues —
	// let those propagate.
	const tupleShape = resolveTupleArrayShape(unwrapInputAst(ast), label);
	if (tupleShape) {
		result.type = tupleShape.type;
		result.multiple = tupleShape.multiple;
	} else {
		const primitive = resolvePrimitiveInputType(ast);
		if (primitive) {
			result.type = primitive;
			result.multiple = false;
		}
	}

	const description = resolveDescriptionFromAst(ast);
	if (description !== undefined) {
		result.description = description;
	}

	result.optional = acceptsUndefined(ast);

	return result;
}
