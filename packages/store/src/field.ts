// ────────────────────────────────────────────────────────────────────────────
// field() — Standard-Schema-first store-field factory
// ────────────────────────────────────────────────────────────────────────────
//
// Builds a `FieldDef` from any Standard Schema v1 object. Crust stores raw
// values, then lets the schema validate and transform them. Metadata such as
// `type`, `default`, `array`, and `description` is supplied explicitly through
// options when needed.

import {
	type InferOutput,
	isStandardSchema,
	normalizeStandardIssues,
	type StandardSchema,
} from "@crustjs/utils/schema";
import { CrustStoreError } from "./errors.ts";

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
	type?: "string" | "number" | "boolean";
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
			const messages = normalized.map((i) =>
				i.path ? `${i.path}: ${i.message}` : i.message,
			);
			throw new Error(messages.join("; "));
		}
		return { value: result.value };
	};
}

// ────────────────────────────────────────────────────────────────────────────
// FieldDef shape inference (TS narrowing)
// ────────────────────────────────────────────────────────────────────────────

type ValueType = "string" | "number" | "boolean";

type StripUndefined<T> = Exclude<T, undefined>;

type PrimitiveToValueType<T> = [T] extends [string]
	? "string"
	: [T] extends [number]
		? "number"
		: [T] extends [boolean]
			? "boolean"
			: ValueType;

/**
 * Resolve the runtime CLI value-type from a Standard Schema's output type.
 *
 * Array schemas are detected via `IsArrayOutput`; their element type drives
 * the value-type literal so `field(z.array(z.string()))` resolves to
 * `{ type: "string"; array: true }`.
 */
type IsArrayOutput<S> =
	S extends StandardSchema<infer _I, infer Out>
		? StripUndefined<Out> extends readonly unknown[]
			? true
			: false
		: false;

type ArrayElementOutput<S> =
	S extends StandardSchema<infer _I, infer Out>
		? StripUndefined<Out> extends readonly (infer E)[]
			? E
			: never
		: never;

type ResolveScalarType<S> =
	S extends StandardSchema<infer _I, infer Out>
		? PrimitiveToValueType<StripUndefined<Out>>
		: ValueType;

/** A scalar `FieldDef` with no narrowed default. */
type ScalarFieldDef<T extends ValueType> = {
	readonly type: T;
	readonly description?: string;
	readonly validate: (value: unknown) => Promise<{ value: unknown }>;
};

/** A scalar `FieldDef` with a narrowed default. */
type ScalarFieldDefWithDefault<T extends ValueType, D> = {
	readonly type: T;
	readonly description?: string;
	readonly default: D;
	readonly validate: (value: unknown) => Promise<{ value: unknown }>;
};

/** An array `FieldDef` with no narrowed default. */
type ArrayFieldDef<T extends ValueType> = {
	readonly type: T;
	readonly array: true;
	readonly description?: string;
	readonly validate: (value: unknown) => Promise<{ value: unknown }>;
};

/** An array `FieldDef` with a narrowed default. */
type ArrayFieldDefWithDefault<T extends ValueType, D> = {
	readonly type: T;
	readonly array: true;
	readonly description?: string;
	readonly default: D;
	readonly validate: (value: unknown) => Promise<{ value: unknown }>;
};

/**
 * `FieldDef` inferred from a Standard Schema, with no narrowed default.
 *
 * Schema-derived defaults are populated at runtime but do NOT narrow the
 * TypeScript type — Standard Schema v1 has no spec-portable type-level
 * access to defaults. Pass `field(schema, { default: x })` explicitly to
 * narrow.
 */
type SchemaFieldDef<S extends StandardSchema> =
	IsArrayOutput<S> extends true
		? ArrayFieldDef<PrimitiveToValueType<StripUndefined<ArrayElementOutput<S>>>>
		: ScalarFieldDef<ResolveScalarType<S>>;

/**
 * `FieldDef` inferred from a Standard Schema, with the explicit `opts.default`
 * narrowed into the type.
 */
type SchemaFieldDefWithDefault<S extends StandardSchema, D> =
	IsArrayOutput<S> extends true
		? ArrayFieldDefWithDefault<
				PrimitiveToValueType<StripUndefined<ArrayElementOutput<S>>>,
				D
			>
		: ScalarFieldDefWithDefault<ResolveScalarType<S>, D>;

// ────────────────────────────────────────────────────────────────────────────
// field() — overloads
// ────────────────────────────────────────────────────────────────────────────

/**
 * Define a `@crustjs/store` field from any Standard Schema v1.
 *
 * Returns a value that satisfies store's `FieldDef` discriminated union.
 * Auto-derives `type`, `array`, `description`, and `default` from the
 * schema (Zod and Effect natively; Valibot/ArkType via the
 * `validate(undefined)` fallback for defaults). Pass `opts` to override
 * any key explicitly — explicit values win silently.
 *
 * The returned `validate` is an async function that throws an `Error` with
 * the schema's normalized issue messages on failure (matches store's
 * `FieldDef.validate` contract).
 *
 * **Type-level defaults**: schema-derived defaults populate at runtime but
 * do NOT narrow the inferred config type. For tight typing of
 * default-bearing fields, pass `default` via `opts`:
 *
 * ```ts
 * field(z.string().default("x"))                       // state: string | undefined
 * field(z.string(), { default: "x" })                  // state: string
 * ```
 *
 * @param schema - Any Standard Schema v1 object (Zod schemas natively;
 *                 Effect schemas wrapped via `Schema.standardSchemaV1`;
 *                 Valibot/ArkType/Sury/etc. as-is)
 * @param opts - Optional store-field metadata; explicit keys override
 *                   the introspected values silently
 * @throws {CrustStoreError} With code `"DEFINITION"` when the input is not
 *         a Standard Schema, or when the runtime CLI type cannot be inferred
 *         and `opts.type` was not supplied.
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
export function field<S extends StandardSchema, D extends InferOutput<S>>(
	schema: S,
	opts: FieldOptions<InferOutput<S>> & { default: D },
): SchemaFieldDefWithDefault<S, D>;
export function field<S extends StandardSchema>(
	schema: S,
	opts: FieldOptions<InferOutput<S>>,
): SchemaFieldDef<S>;
export function field<S extends StandardSchema>(
	schema: S,
	opts?: FieldOptions<InferOutput<S>>,
): SchemaFieldDef<S> {
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

	return def as unknown as SchemaFieldDef<S>;
}
