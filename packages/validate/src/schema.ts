// ────────────────────────────────────────────────────────────────────────────
// arg() / flag() — Standard-Schema-first DSL with raw schema-backed parsing
// ────────────────────────────────────────────────────────────────────────────

import { CrustError } from "@crustjs/core";
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
 * Crust does not infer metadata from schemas. Omit `type` for raw schema-backed
 * parsing, or pass `type` as a legacy parser hint when you need parser coercion.
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
 * arg("port", z.coerce.number().int().min(1), { description: "Port to listen on" });
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
	options?: Omit<ArgOptions, "type" | "variadic"> & {
		variadic?: Variadic;
		type?: undefined;
	},
): ArgDef$<Name, S, Variadic, undefined>;
export function arg<
	Name extends string,
	S extends StandardSchema,
	const Variadic extends true | undefined = undefined,
	const Type extends NonNullable<ArgOptions["type"]> = NonNullable<
		ArgOptions["type"]
	>,
>(
	name: Name,
	schema: S,
	options: Omit<ArgOptions, "type" | "variadic"> & {
		variadic?: Variadic;
		type: Type;
	},
): ArgDef$<Name, S, Variadic, Type>;
export function arg<
	Name extends string,
	S extends StandardSchema,
	const Variadic extends true | undefined = undefined,
>(
	name: Name,
	schema: S,
	options?: ArgOptions & { variadic?: Variadic },
): ArgDef$<Name, S, Variadic, ArgOptions["type"]>;
export function arg<
	Name extends string,
	S extends StandardSchema,
	const Variadic extends true | undefined = undefined,
>(
	name: Name,
	schema: S,
	options?: ArgOptions & { variadic?: Variadic },
): unknown {
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

	validateArgArrayShape(label, variadic, false, "an array schema");

	const def = {
		name,
		...(options?.type !== undefined && { type: options.type }),
		...(options?.description !== undefined && {
			description: options.description,
		}),
		variadic: variadic as Variadic,
		...(options?.required && { required: true as const }),
		[VALIDATED_SCHEMA]: schema,
	};

	return def;
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
 * Crust does not infer metadata from schemas. Omit `type` for raw schema-backed
 * parsing, or pass `type` as a legacy parser hint when you need parser coercion.
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
 * flag(z.boolean().default(false), { short: "v", description: "Enable verbose logging" });
 * flag(z.enum(["json", "text"]).default("text"));
 * ```
 */
export function flag<
	S extends StandardSchema,
	const Short extends string | undefined = undefined,
	const Aliases extends readonly string[] | undefined = undefined,
	const Inherit extends true | undefined = undefined,
	const Multiple extends true | undefined = undefined,
>(
	schema: S,
	options?: Omit<
		FlagOptions,
		"short" | "aliases" | "inherit" | "type" | "multiple"
	> & {
		short?: Short;
		aliases?: Aliases;
		inherit?: Inherit;
		type?: undefined;
		multiple?: Multiple;
	},
): FlagDef$<S, Short, Aliases, Inherit, undefined, Multiple>;
export function flag<
	S extends StandardSchema,
	const Short extends string | undefined = undefined,
	const Aliases extends readonly string[] | undefined = undefined,
	const Inherit extends true | undefined = undefined,
	const Type extends NonNullable<FlagOptions["type"]> = NonNullable<
		FlagOptions["type"]
	>,
	const Multiple extends true | undefined = undefined,
>(
	schema: S,
	options: Omit<
		FlagOptions,
		"short" | "aliases" | "inherit" | "type" | "multiple"
	> & {
		short?: Short;
		aliases?: Aliases;
		inherit?: Inherit;
		type: Type;
		multiple?: Multiple;
	},
): FlagDef$<S, Short, Aliases, Inherit, Type, Multiple>;
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
): FlagDef$<
	S,
	Short,
	Aliases,
	Inherit,
	FlagOptions["type"],
	FlagOptions["multiple"]
>;
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
): unknown {
	if (!isStandardSchema(schema)) {
		throw new CrustError(
			"DEFINITION",
			`flag(): schema must be a Standard Schema v1 object (got ${typeof schema})`,
		);
	}

	const multiple = options?.multiple === true;

	const short: string | undefined = options?.short;
	const aliases: string[] | undefined = options?.aliases
		? [...options.aliases]
		: undefined;
	const inherit: true | undefined = options?.inherit ? true : undefined;

	const def = {
		...(options?.type !== undefined && { type: options.type }),
		...(multiple && { multiple: true as const }),
		short,
		aliases,
		inherit,
		...(options?.description !== undefined && {
			description: options.description,
		}),
		...(options?.required && { required: true as const }),
		[VALIDATED_SCHEMA]: schema,
	};

	return def;
}
