// ────────────────────────────────────────────────────────────────────────────
// Shared option-resolution logic for arg() / flag() across providers
// ────────────────────────────────────────────────────────────────────────────

import { CrustError } from "@crustjs/core";

// ────────────────────────────────────────────────────────────────────────────
// Shared types
// ────────────────────────────────────────────────────────────────────────────

/** CLI value type literals. */
export type ValueType = "string" | "number" | "boolean";

/** Resolved CLI input shape from schema introspection. */
export interface InputShape {
	type: ValueType;
	multiple: boolean;
}

/** Introspection results passed from the provider-specific layer. */
export interface IntrospectionResult {
	shape: InputShape | undefined;
	description: string | undefined;
	optional: boolean;
}

/** Explicit parser metadata options (common across providers). */
export interface ExplicitOptions {
	type?: ValueType;
	description?: string;
	required?: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// resolveType — Resolve CLI type from explicit + inferred
// ────────────────────────────────────────────────────────────────────────────

interface ResolvedType {
	type: ValueType;
	multiple: boolean;
}

export function resolveType(
	label: string,
	inferredShape: InputShape | undefined,
	explicitType: ValueType | undefined,
): ResolvedType {
	if (explicitType !== undefined) {
		if (inferredShape && inferredShape.type !== explicitType) {
			throw new CrustError(
				"DEFINITION",
				`${label}: explicit type "${explicitType}" conflicts with schema-inferred type "${inferredShape.type}". Remove the explicit type or change the schema.`,
			);
		}
		return { type: explicitType, multiple: inferredShape?.multiple ?? false };
	}

	if (inferredShape) {
		return { type: inferredShape.type, multiple: inferredShape.multiple };
	}

	throw new CrustError(
		"DEFINITION",
		`${label}: unsupported schema type for CLI parsing. Use string, number, boolean, enum/literal, or array of these, or provide an explicit { type } in options.`,
	);
}

// ────────────────────────────────────────────────────────────────────────────
// validateArgArrayShape — Validate variadic/multiple constraints for args
// ────────────────────────────────────────────────────────────────────────────

/**
 * Validates that variadic and multiple settings are consistent for args.
 *
 * @param label - Error label (e.g. `arg "name"`)
 * @param variadic - Whether the arg is variadic
 * @param multiple - Whether the schema resolved to an array type
 * @param providerArrayName - Provider-specific array type name for error messages
 *        (e.g. `"z.array(...)"` or `"Schema.Array(...)"`)
 */
export function validateArgArrayShape(
	label: string,
	variadic: true | undefined,
	multiple: boolean,
	providerArrayName: string,
): void {
	if (variadic && multiple) {
		throw new CrustError(
			"DEFINITION",
			`${label}: variadic args must use a scalar schema; do not wrap the schema in ${providerArrayName}`,
		);
	}

	if (!variadic && multiple) {
		throw new CrustError(
			"DEFINITION",
			`${label}: array schema requires { variadic: true }`,
		);
	}
}

// ────────────────────────────────────────────────────────────────────────────
// resolveDescription — Resolve description from explicit + inferred
// ────────────────────────────────────────────────────────────────────────────

export function resolveDescription(
	explicitDescription: string | undefined,
	inferredDescription: string | undefined,
): string | undefined {
	return explicitDescription ?? inferredDescription;
}

// ────────────────────────────────────────────────────────────────────────────
// resolveRequired — Resolve required from explicit + inferred optionality
// ────────────────────────────────────────────────────────────────────────────

export function resolveRequired(
	label: string,
	inferredOptional: boolean,
	explicitRequired: boolean | undefined,
): boolean {
	if (explicitRequired !== undefined) {
		if (explicitRequired && inferredOptional) {
			throw new CrustError(
				"DEFINITION",
				`${label}: explicit required: true conflicts with schema that accepts undefined. Remove the explicit required or change the schema.`,
			);
		}
		if (!explicitRequired && !inferredOptional) {
			throw new CrustError(
				"DEFINITION",
				`${label}: explicit required: false conflicts with schema that does not accept undefined. Remove the explicit required or make the schema optional.`,
			);
		}
		return explicitRequired;
	}

	return !inferredOptional;
}
