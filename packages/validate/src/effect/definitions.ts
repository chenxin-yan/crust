import type { ArgDef, FlagsDef } from "@crustjs/core";
import { CrustError } from "@crustjs/core";
import { encodedSchema } from "effect/Schema";
import type { AST } from "effect/SchemaAST";
import type { DefinitionAdapter, InputShape } from "../definitionBuilders.ts";
import {
	buildArgDefinitions,
	buildFlagDefinitions,
} from "../definitionBuilders.ts";
import { resolveDescription } from "./schema.ts";
import type { ArgSpecs, EffectSchemaLike, FlagShape } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Schema analysis helpers — Effect-specific
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
// Adapter + public definition generation
// ────────────────────────────────────────────────────────────────────────────

const effectAdapter: DefinitionAdapter = {
	resolveInputShape,
	isOptionalInputSchema,
	resolveDescription: resolveDescription as (
		schema: unknown,
	) => string | undefined,
	commandLabel: "defineEffectCommand",
	arrayHint: "Schema.Array(...)",
};

/** Build Crust positional arg definitions from ordered `arg()` specs. */
export function argsToDefinitions(args: ArgSpecs): ArgDef[] {
	return buildArgDefinitions(args, effectAdapter);
}

/** Build Crust flag definitions from schema-first `flags` shape. */
export function flagsToDefinitions(flags: FlagShape | undefined): FlagsDef {
	return buildFlagDefinitions(
		flags as Record<string, unknown> | undefined,
		effectAdapter,
	);
}
