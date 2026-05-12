// ────────────────────────────────────────────────────────────────────────────
// field() — Standard-Schema-first store-field factory
// ────────────────────────────────────────────────────────────────────────────
//
// Builds a `FieldDef` from any Standard Schema v1 object. Introspection
// (via `@crustjs/schema-utils`) auto-derives `type` / `default` / `array` /
// `description`; the optional second argument overrides silently. Returns
// a value that satisfies store's discriminated `FieldDef` union.

import {
	extractDefault,
	type InferOutput,
	inferOptions,
	isStandardSchema,
	normalizeStandardIssues,
	type StandardSchema,
} from "@crustjs/schema-utils";
import { CrustStoreError } from "./errors.ts";

// ────────────────────────────────────────────────────────────────────────────
// FieldOptions — explicit overrides for the introspected values
// ────────────────────────────────────────────────────────────────────────────

/**
 * Optional overrides for the introspected `FieldDef` shape produced by
 * {@link field}.
 *
 * Every key is optional. When automatic introspection covers a field
 * (`type`, `description`, `default`, `array`), explicit values override
 * the introspection silently. For schemas with unknown vendors (e.g.
 * Valibot, ArkType), `type` MUST be supplied explicitly because no
 * inference is available.
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
	 * Default value for this field when the persisted state does not contain
	 * a value for it. Passing `default` explicitly here narrows the inferred
	 * config type from `T | undefined` to `T`. Schema-derived defaults
	 * (e.g. `z.string().default("x")`) populate the runtime default but do
	 * NOT narrow the TypeScript type — pass it explicitly here for tight
	 * typing.
	 */
	default?: T;
	/** Mark this field as an array (collects values into an array). */
	array?: true;
}

// ────────────────────────────────────────────────────────────────────────────
// Schema → field validate adapter
// ────────────────────────────────────────────────────────────────────────────

/** Build the per-field async validate function from a Standard Schema. */
function makeValidator<S extends StandardSchema>(
	schema: S,
): (value: unknown) => Promise<void> {
	return async (value: unknown) => {
		const result = await schema["~standard"].validate(value);
		if (result.issues) {
			const normalized = normalizeStandardIssues(result.issues);
			const messages = normalized.map((i) =>
				i.path ? `${i.path}: ${i.message}` : i.message,
			);
			throw new Error(messages.join("; "));
		}
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
	readonly validate: (value: unknown) => Promise<void>;
};

/** A scalar `FieldDef` with a narrowed default. */
type ScalarFieldDefWithDefault<T extends ValueType, D> = {
	readonly type: T;
	readonly description?: string;
	readonly default: D;
	readonly validate: (value: unknown) => Promise<void>;
};

/** An array `FieldDef` with no narrowed default. */
type ArrayFieldDef<T extends ValueType> = {
	readonly type: T;
	readonly array: true;
	readonly description?: string;
	readonly validate: (value: unknown) => Promise<void>;
};

/** An array `FieldDef` with a narrowed default. */
type ArrayFieldDefWithDefault<T extends ValueType, D> = {
	readonly type: T;
	readonly array: true;
	readonly description?: string;
	readonly default: D;
	readonly validate: (value: unknown) => Promise<void>;
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

	const schemaVendor = schema["~standard"]?.vendor ?? "unknown";
	const label = `field (vendor: "${schemaVendor}")`;

	const inferred = inferOptions(schema, "field", label);

	const resolvedType = opts?.type ?? inferred.type;
	if (!resolvedType) {
		throw new CrustStoreError(
			"DEFINITION",
			`${label}: unable to infer field type from schema. Pass an explicit { type: "string" | "number" | "boolean" } in options. If this is an Effect schema, wrap it with Schema.standardSchemaV1(...) before passing it here.`,
			{ vendor: schemaVendor },
		);
	}

	const isArray = opts?.array === true || inferred.multiple === true;

	// Resolve description: explicit opts wins; otherwise inferred.
	const description = opts?.description ?? inferred.description;

	// Resolve default: explicit opts wins; otherwise sync vendor-aware
	// extraction with `validate(undefined)` fallback. Falsy defaults are
	// preserved — `"default" in opts` is the sole sentinel for "caller
	// explicitly set a default", so `{ default: undefined }` is honored
	// (matching the `D extends InferOutput<S>` overload contract).
	const resolvedDefault =
		opts && "default" in opts
			? ({ ok: true, value: opts.default } as const)
			: extractDefault(schema);

	const validate = makeValidator(schema);

	const def: Record<string, unknown> = {
		type: resolvedType,
		validate,
	};
	if (isArray) {
		def.array = true;
	}
	if (description !== undefined) {
		def.description = description;
	}
	if (resolvedDefault.ok) {
		def.default = resolvedDefault.value;
	}

	return def as unknown as SchemaFieldDef<S>;
}
