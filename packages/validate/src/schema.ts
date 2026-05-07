// ────────────────────────────────────────────────────────────────────────────
// arg() / flag() — Standard-Schema-first DSL with vendor-dispatch introspection
// ────────────────────────────────────────────────────────────────────────────

import { CrustError } from "@crustjs/core";
import { inferOptions } from "./introspect/registry.ts";
import {
	type ArgDef$,
	type ArgOptions,
	type FlagDef$,
	type FlagOptions,
	VALIDATED_SCHEMA,
} from "./schema-types.ts";
import type { StandardSchema } from "./types.ts";
import { isStandardSchema } from "./validate.ts";

// ────────────────────────────────────────────────────────────────────────────
// Internal — variadic/array-shape consistency check
// ────────────────────────────────────────────────────────────────────────────

function validateArgArrayShape(
	label: string,
	variadic: true | undefined,
	multiple: boolean,
	hint: string,
): void {
	if (variadic && multiple) {
		throw new CrustError(
			"DEFINITION",
			`${label}: variadic args must use a scalar schema; do not wrap the schema in ${hint}`,
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
// arg()
// ────────────────────────────────────────────────────────────────────────────

/**
 * Define a named positional argument from any Standard Schema v1.
 *
 * Returns a core `ArgDef` enriched with hidden schema metadata (via the
 * `[VALIDATED_SCHEMA]` symbol) for runtime validation by `commandValidator`.
 *
 * CLI metadata (`type`, `required`, `description`) is automatically inferred
 * for Zod and Effect schemas. For other Standard Schema libraries (Valibot,
 * ArkType, Sury, etc.), supply `type:` (and optionally `required:`,
 * `description:`) via `options`.
 *
 * **Variadic args**: when `{ variadic: true }` is set, the inferred TypeScript
 * type is always `T[]` — a possibly-empty array, never `T[] | undefined`. The
 * `required` option only controls whether validation fails on an empty array;
 * it does not change the runtime shape or the inferred type.
 *
 * **Effect users**: wrap your raw Effect schema with
 * `Schema.standardSchemaV1(...)` before passing it here.
 *
 * @param name - Positional arg name used in parser output and help text
 * @param schema - Any Standard Schema v1 object (Zod schemas natively;
 *                 Effect schemas wrapped via `Schema.standardSchemaV1`;
 *                 Valibot/ArkType/Sury/etc. as-is)
 * @param options - Optional CLI metadata
 *
 * @example Zod
 * ```ts
 * import { z } from "zod";
 * import { arg } from "@crustjs/validate";
 *
 * arg("port", z.number().int().min(1).describe("Port to listen on"));
 * arg("files", z.string(), { variadic: true });
 * ```
 *
 * @example Effect
 * ```ts
 * import * as Schema from "effect/Schema";
 * import { arg } from "@crustjs/validate";
 *
 * arg("port", Schema.standardSchemaV1(Schema.Number));
 * ```
 */
export function arg<
	Name extends string,
	S extends StandardSchema,
	const Variadic extends true | undefined = undefined,
>(
	name: Name,
	schema: S,
	options?: ArgOptions & { variadic?: Variadic },
): ArgDef$<Name, S, Variadic> {
	if (!name.trim()) {
		throw new CrustError(
			"DEFINITION",
			"arg(): name is required and must be a non-empty string",
		);
	}
	if (!isStandardSchema(schema)) {
		throw new CrustError(
			"DEFINITION",
			`arg("${name}"): schema must be a Standard Schema v1 object (got ${typeof schema})`,
		);
	}

	const label = `arg "${name}"`;
	const variadic = options?.variadic;

	const inferred = inferOptions(schema, "arg", label);

	const resolvedType = options?.type ?? inferred.type;
	if (!resolvedType) {
		const vendor = schema["~standard"].vendor;
		throw new CrustError(
			"DEFINITION",
			`${label}: unable to infer CLI type from schema (vendor: "${vendor}"). Pass an explicit { type: "string" | "number" | "boolean" } in options. If this is an Effect schema, wrap it with Schema.standardSchemaV1(...) before passing it here.`,
		);
	}

	const inferredMultiple = inferred.multiple === true;
	validateArgArrayShape(label, variadic, inferredMultiple, "an array schema");

	const description = options?.description ?? inferred.description;

	const inferredOptional = inferred.optional === true;
	const required =
		options?.required !== undefined ? options.required : !inferredOptional;

	const def = {
		name,
		type: resolvedType,
		...(description !== undefined && { description }),
		variadic: variadic as Variadic,
		...(required && { required: true as const }),
		[VALIDATED_SCHEMA]: schema,
	};

	return def as ArgDef$<Name, S, Variadic>;
}

// ────────────────────────────────────────────────────────────────────────────
// flag()
// ────────────────────────────────────────────────────────────────────────────

/**
 * Define a named flag from any Standard Schema v1.
 *
 * Returns a core `FlagDef` enriched with hidden schema metadata for runtime
 * validation by `commandValidator`.
 *
 * CLI metadata is automatically inferred for Zod and Effect schemas; supply
 * `type:` explicitly for other Standard Schema vendors.
 *
 * **Effect users**: wrap your schema with `Schema.standardSchemaV1(...)`
 * before passing it here.
 *
 * @param schema - Any Standard Schema v1 object
 * @param options - Optional flag metadata
 *
 * @example
 * ```ts
 * import { z } from "zod";
 * import { flag } from "@crustjs/validate";
 *
 * flag(z.boolean().default(false).describe("Enable verbose logging"), { short: "v" });
 * flag(z.enum(["json", "text"]).default("text"));
 * ```
 */
export function flag<
	S extends StandardSchema,
	const Short extends string | undefined = undefined,
	const Aliases extends readonly string[] | undefined = undefined,
	const Inherit extends true | undefined = undefined,
>(
	schema: S,
	options?: FlagOptions & {
		short?: Short;
		aliases?: Aliases;
		inherit?: Inherit;
	},
): FlagDef$<S, Short, Aliases, Inherit> {
	if (!isStandardSchema(schema)) {
		throw new CrustError(
			"DEFINITION",
			`flag(): schema must be a Standard Schema v1 object (got ${typeof schema})`,
		);
	}

	const schemaVendor = schema["~standard"]?.vendor ?? "unknown";
	const label = `flag (vendor: "${schemaVendor}")`;
	const inferred = inferOptions(schema, "flag", label);

	const resolvedType = options?.type ?? inferred.type;
	if (!resolvedType) {
		throw new CrustError(
			"DEFINITION",
			`${label}: unable to infer CLI type from schema. Pass an explicit { type: "string" | "number" | "boolean" } in options. If this is an Effect schema, wrap it with Schema.standardSchemaV1(...) before passing it here.`,
		);
	}

	const multiple = options?.multiple === true || inferred.multiple === true;

	const description = options?.description ?? inferred.description;

	const inferredOptional = inferred.optional === true;
	const resolvedRequired =
		options?.required !== undefined ? options.required : !inferredOptional;

	const short: string | undefined = options?.short;
	const aliases: string[] | undefined = options?.aliases
		? [...options.aliases]
		: undefined;
	const inherit: true | undefined = options?.inherit ? true : undefined;

	const def = {
		type: resolvedType,
		...(multiple && { multiple: true as const }),
		short,
		aliases,
		inherit,
		...(description !== undefined && { description }),
		...(resolvedRequired && { required: true as const }),
		[VALIDATED_SCHEMA]: schema,
	};

	return def as FlagDef$<S, Short, Aliases, Inherit>;
}
