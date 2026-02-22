import type { ArgDef, FlagsDef } from "@crustjs/core";
import { CrustError } from "@crustjs/core";
import { encodedSchema } from "effect/Schema";
import type { AST } from "effect/SchemaAST";
import { isFlagSpec, resolveDescription } from "./schema.ts";
import type {
	ArgSpecs,
	EffectSchemaLike,
	FlagShape,
	FlagSpec,
} from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Schema analysis helpers
// ────────────────────────────────────────────────────────────────────────────

type InputShape = {
	type: "string" | "number" | "boolean";
	multiple: boolean;
};

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
function resolveInputShape(
	schema: EffectSchemaLike,
	label: string,
): InputShape {
	const ast = unwrapInputAst(encodedSchema(schema).ast);

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

function isOptionalInputSchema(schema: EffectSchemaLike): boolean {
	return acceptsUndefined(encodedSchema(schema).ast);
}

// ────────────────────────────────────────────────────────────────────────────
// Public definition generation
// ────────────────────────────────────────────────────────────────────────────

/** Build Crust positional arg definitions from ordered `arg()` specs. */
export function argsToDefinitions(args: ArgSpecs): ArgDef[] {
	const seen = new Set<string>();

	for (let i = 0; i < args.length; i++) {
		const spec = args[i];
		if (!spec) continue;

		if (seen.has(spec.name)) {
			throw new CrustError(
				"DEFINITION",
				`defineEffectCommand: duplicate arg name "${spec.name}"`,
			);
		}
		seen.add(spec.name);

		if (spec.variadic && i !== args.length - 1) {
			throw new CrustError(
				"DEFINITION",
				`defineEffectCommand: only the last arg can be variadic (arg "${spec.name}")`,
			);
		}
	}

	return args.map((spec) => {
		const shape = resolveInputShape(spec.schema, `arg "${spec.name}"`);

		if (spec.variadic && shape.multiple) {
			throw new CrustError(
				"DEFINITION",
				`arg "${spec.name}": variadic args must use a scalar schema; do not wrap the schema in Schema.Array(...)`,
			);
		}

		if (!spec.variadic && shape.multiple) {
			throw new CrustError(
				"DEFINITION",
				`arg "${spec.name}": array schema requires { variadic: true }`,
			);
		}

		const description = resolveDescription(spec.schema);
		const required = !isOptionalInputSchema(spec.schema);

		const def: ArgDef = {
			name: spec.name,
			type: shape.type,
			...(description !== undefined && { description }),
			...(spec.variadic && { variadic: true }),
			...(required && { required: true }),
		};

		return def;
	});
}

function getFlagMetadata(value: EffectSchemaLike | FlagSpec): {
	schema: EffectSchemaLike;
	alias?: string | readonly string[];
} {
	if (isFlagSpec(value)) {
		return {
			schema: value.schema,
			alias: value.alias,
		};
	}
	return { schema: value };
}

/** Build Crust flag definitions from schema-first `flags` shape. */
export function flagsToDefinitions(flags: FlagShape | undefined): FlagsDef {
	if (!flags) {
		return {};
	}

	const result: FlagsDef = {};

	for (const [name, value] of Object.entries(flags)) {
		const metadata = getFlagMetadata(value);
		const { schema } = metadata;
		const shape = resolveInputShape(schema, `flag "--${name}"`);
		const required = !isOptionalInputSchema(schema);
		const description = resolveDescription(schema);

		// Convert readonly alias to mutable for core FlagDef compatibility
		const alias: string | string[] | undefined =
			metadata.alias === undefined
				? undefined
				: typeof metadata.alias === "string"
					? metadata.alias
					: [...metadata.alias];

		result[name] = {
			type: shape.type,
			...(shape.multiple && { multiple: true }),
			...(alias !== undefined && { alias }),
			...(description !== undefined && { description }),
			...(required && { required: true }),
		};
	}

	return result;
}
