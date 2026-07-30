// ────────────────────────────────────────────────────────────────────────────
// field() — Standard-Schema-first store-field factory
// ────────────────────────────────────────────────────────────────────────────
//
// Builds a `FieldDef` from any Standard Schema v1 object. Crust stores raw
// values, then lets the schema validate and transform them. Metadata such as
// `type`, `default`, `array`, and `description` is supplied explicitly through
// options when needed.

import type { BaseValueType } from "@crustjs/utils/primitive";
import {
	type InferOutput,
	isStandardSchema,
	normalizeStandardIssues,
	type StandardSchema,
} from "@crustjs/utils/schema";

import { CrustStoreError } from "./errors.ts";
import type { FIELD_SCHEMA_OUTPUT } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// FieldOptions — explicit Crust metadata
// ────────────────────────────────────────────────────────────────────────────

/**
 * Optional Crust metadata for the `FieldDef` shape produced by {@link field}.
 *
 * Every key is optional. Crust does not infer metadata from schemas; schemas
 * validate and transform actual runtime values, including missing values passed
 * as `undefined`.
 *
 * No `validate` key — validation flows exclusively through the schema.
 * If extra checks are needed, refine the schema with `.refine(...)`
 * (Zod), `Schema.filter(...)` (Effect), etc.
 *
 * @typeParam T - The schema's output value type. Used to type-tighten the
 *               `default` key when the user wants a non-`undefined` field.
 */
export interface FieldOptions<T = unknown> {
	type?: BaseValueType;
	description?: string;
	/**
	 * Crust metadata default for this field when the persisted state does not
	 * contain a value for it. Schema defaults should usually live in the schema;
	 * missing persisted values are validated as `undefined`, so `.default()` works
	 * naturally at read time.
	 */
	default?: T;
	/** Mark this field as an array (collects values into an array). */
	array?: true;
}

// ────────────────────────────────────────────────────────────────────────────
// Schema → field validate adapter
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build the per-field async validate function from a Standard Schema.
 *
 * On success returns `{ value: result.value }` so the store can persist
 * schema-transformed values (e.g. `z.string().transform(s => s.trim())`).
 * On issues, throws an `Error` whose message contains the schema's
 * normalized issues. The store treats `{ value }` returns as
 * "persist on write/update/patch, discard on read" — see
 * `FieldDef.validate` in `./types.ts`.
 */
function makeValidator<S extends StandardSchema>(
	schema: S,
): (value: unknown) => Promise<{ value: unknown }> {
	return async (value: unknown) => {
		const result = await schema["~standard"].validate(value);
		if (result.issues) {
			const normalized = normalizeStandardIssues(result.issues);
			const messages = normalized.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message));
			throw new Error(messages.join("; "));
		}
		return { value: result.value };
	};
}

// ────────────────────────────────────────────────────────────────────────────
// FieldDef shape inference (TS narrowing)
// ────────────────────────────────────────────────────────────────────────────

type RawSchemaFieldDef<Out> = {
	readonly type?: never;
	readonly array?: never;
	readonly description?: string;
	readonly validate: (value: unknown) => Promise<{ value: unknown }>;
	readonly validateMissing: true;
	readonly [FIELD_SCHEMA_OUTPUT]?: Out;
};

type SchemaFieldDefWithOptions<
	Out,
	Type extends FieldOptions["type"],
	Array extends true | undefined,
	D = never,
> = Omit<RawSchemaFieldDef<Out>, "type" | "array"> &
	(Type extends NonNullable<FieldOptions["type"]>
		? { readonly type: Type }
		: { readonly type?: never }) &
	(Array extends true ? { readonly array: true } : { readonly array?: never }) &
	([D] extends [never] ? unknown : { readonly default: D });

/**
 * `FieldDef` inferred from a Standard Schema, with no narrowed default.
 *
 * Standard Schema v1 has no spec-portable type-level access to defaults, so
 * schema `.default()` does not narrow the inferred TypeScript type. Pass
 * `field(schema, { default: x })` explicitly to narrow.
 */
type SchemaFieldDef<S extends StandardSchema> = RawSchemaFieldDef<InferOutput<S>>;

// ────────────────────────────────────────────────────────────────────────────
// field() — overloads
// ────────────────────────────────────────────────────────────────────────────

/**
 * Define a `@crustjs/store` field from any Standard Schema v1.
 *
 * Returns a value that satisfies store's `FieldDef` discriminated union.
 * Crust stores raw values and lets the schema validate and transform them on
 * read/write; missing persisted values flow through the schema as `undefined`,
 * so `.optional()` and `.default()` behave naturally.
 *
 * The returned `validate` is an async function that throws an `Error` with
 * the schema's normalized issue messages on failure (matches store's
 * `FieldDef.validate` contract).
 *
 * **Type-level defaults**: Standard Schema v1 has no spec-portable type-level
 * access to defaults. For tight typing of default-bearing fields, pass
 * `default` via `opts`:
 *
 * ```ts
 * field(z.string().default("x"))         // value materializes on read; state: string | undefined
 * field(z.string(), { default: "x" })    // Crust-level default; state: string
 * ```
 *
 * @param schema - Any Standard Schema v1 object (Zod schemas natively;
 *                 Effect schemas wrapped via `Schema.standardSchemaV1`;
 *                 Valibot/ArkType/Sury/etc. as-is)
 * @param opts - Optional Crust-level metadata
 * @throws {CrustStoreError} With code `"DEFINITION"` when the input is not
 *         a Standard Schema v1 object.
 *
 * @example Zod
 * ```ts
 * import { z } from "zod";
 * import { createStore, configDir, field } from "@crustjs/store";
 *
 * const store = createStore({
 *   dirPath: configDir("my-cli"),
 *   fields: {
 *     theme: field(z.enum(["light", "dark"]).default("light")),
 *     verbose: field(z.boolean().default(false)),
 *     tags: field(z.array(z.string()).default([])),
 *   },
 * });
 * ```
 *
 * @example Effect
 * ```ts
 * import * as Schema from "effect/Schema";
 * import { createStore, configDir, field } from "@crustjs/store";
 *
 * const store = createStore({
 *   dirPath: configDir("my-cli"),
 *   fields: {
 *     theme: field(Schema.standardSchemaV1(Schema.Literal("light", "dark"))),
 *   },
 * });
 * ```
 */
export function field<S extends StandardSchema>(schema: S): SchemaFieldDef<S>;
export function field<
	S extends StandardSchema,
	D extends InferOutput<S>,
	const Type extends FieldOptions<InferOutput<S>>["type"] = undefined,
	const Array extends true | undefined = undefined,
>(
	schema: S,
	opts: FieldOptions<InferOutput<S>> & {
		default: D;
		type?: Type;
		array?: Array;
	},
): SchemaFieldDefWithOptions<InferOutput<S>, Type, Array, D>;
export function field<
	S extends StandardSchema,
	const Type extends FieldOptions<InferOutput<S>>["type"] = undefined,
	const Array extends true | undefined = undefined,
>(
	schema: S,
	opts: FieldOptions<InferOutput<S>> & { type?: Type; array?: Array },
): SchemaFieldDefWithOptions<InferOutput<S>, Type, Array>;
export function field<S extends StandardSchema>(
	schema: S,
	opts?: FieldOptions<InferOutput<S>>,
): unknown {
	if (!isStandardSchema(schema)) {
		throw new CrustStoreError(
			"DEFINITION",
			`field(): argument must be a Standard Schema v1 object (got ${typeof schema})`,
			{},
		);
	}

	const validate = makeValidator(schema);

	const def: Record<string, unknown> = {
		validate,
		validateMissing: true,
	};
	if (opts?.type !== undefined) {
		def.type = opts.type;
	}
	if (opts?.array === true) {
		def.array = true;
	}
	if (opts?.description !== undefined) {
		def.description = opts.description;
	}
	if (opts && "default" in opts) {
		def.default = opts.default;
	}

	return def as unknown;
}
