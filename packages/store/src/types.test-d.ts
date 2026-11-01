// Compile-time contracts, enforced by check:types (not vp test).

import type { StandardSchema } from "@crustjs/utils/schema";
import { z } from "zod";

import type { CreateStoreOptions, FieldsDef, InferStoreConfig } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Type-level helpers
// ────────────────────────────────────────────────────────────────────────────

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

// ────────────────────────────────────────────────────────────────────────────
// InferStoreConfig
// ────────────────────────────────────────────────────────────────────────────

{
	// InferStoreConfig
	{
		// should infer types from field definitions with defaults
		type Fields = {
			readonly theme: { readonly type: "string"; readonly default: "light" };
			readonly verbose: {
				readonly type: "boolean";
				readonly default: false;
			};
			readonly retries: { readonly type: "number"; readonly default: 3 };
		};
		type Config = InferStoreConfig<Fields>;

		// Fields with defaults resolve to their primitive type (guaranteed)
		type _Theme = Expect<Equal<Config["theme"], string>>;
		type _Verbose = Expect<Equal<Config["verbose"], boolean>>;
		type _Retries = Expect<Equal<Config["retries"], number>>;
	}

	{
		// should infer optional fields as T | undefined
		type Fields = {
			readonly theme: { readonly type: "string"; readonly default: "light" };
			readonly token: { readonly type: "string" };
		};
		type Config = InferStoreConfig<Fields>;

		// token has no default → string | undefined
		type _Token = Expect<Equal<Config["token"], string | undefined>>;
	}

	{
		// should infer array fields
		type Fields = {
			readonly tags: {
				readonly type: "string";
				readonly array: true;
				readonly default: readonly string[];
			};
			readonly ids: { readonly type: "number"; readonly array: true };
		};
		type Config = InferStoreConfig<Fields>;

		// tags has array default → string[] (guaranteed)
		// ids has no default → number[] | undefined
		type _Tags = Expect<Equal<Config["tags"], string[]>>;
		type _Ids = Expect<Equal<Config["ids"], number[] | undefined>>;
	}

	{
		// uses the exact Standard Schema output type
		const fields = {
			withDefault: { schema: z.string().default("x") },
			optional: { schema: z.string().optional() },
			required: { schema: z.string() },
		} as const satisfies FieldsDef;

		type Config = InferStoreConfig<typeof fields>;
		type _WithDefault = Expect<Equal<Config["withDefault"], string>>;
		type _Optional = Expect<Equal<Config["optional"], string | undefined>>;
		type _Required = Expect<Equal<Config["required"], string>>;
	}
}

// ────────────────────────────────────────────────────────────────────────────
// FieldDef
// ────────────────────────────────────────────────────────────────────────────

{
	// FieldDef
	{
		// accepts schemas that output structurally JSON-compatible named interfaces
		interface Payload {
			name: string;
			nested: { enabled: boolean };
		}
		const schema = {} as StandardSchema<unknown, Payload>;
		const fields = { payload: { schema } } as const satisfies FieldsDef;
		const _options: CreateStoreOptions<typeof fields> = {
			dirPath: "/tmp",
			name: "named-json",
			fields,
		};

		const dateSchema = {} as StandardSchema<unknown, { createdAt: Date }>;
		const invalidFields = { payload: { schema: dateSchema } } as const satisfies FieldsDef;
		const invalidOptions: CreateStoreOptions<typeof invalidFields> = {
			dirPath: "/tmp",
			name: "non-json",
			// @ts-expect-error -- schema outputs remain recursively constrained to JSON data
			fields: invalidFields,
		};
		void invalidOptions;

		// The rejection names the problem instead of collapsing to `never`.
		type _Brand = Expect<
			Equal<
				CreateStoreOptions<typeof invalidFields>["fields"]["payload"]["FIX_JSON_OUTPUT"],
				"store schema output must be JSON-compatible data (no Date, Map, bigint, or functions)"
			>
		>;
	}

	{
		// infers schema output from validate() when the optional `types` member is omitted
		const omitted = {
			"~standard": {
				version: 1 as const,
				vendor: "d",
				validate: (value: unknown) => ({ value: Number(value) }),
			},
		};
		const asyncWithFailure = {
			"~standard": {
				version: 1 as const,
				vendor: "d",
				validate: async (value: unknown) =>
					typeof value === "string" ? { value } : { issues: [{ message: "expected string" }] },
			},
		};
		// explicit phantom types win over the validate() return type
		const annotated: {
			readonly "~standard": {
				readonly version: 1;
				readonly vendor: string;
				readonly validate: (value: unknown) => { value: string };
				readonly types?: { readonly input: unknown; readonly output: "a" | "b" };
			};
		} = {
			"~standard": { version: 1, vendor: "d", validate: (value) => ({ value: String(value) }) },
		};
		const fields = {
			omitted: { schema: omitted },
			asyncWithFailure: { schema: asyncWithFailure },
			annotated: { schema: annotated },
			// phantom precedence holds per member of a schema union
			mixed: { schema: Math.random() < 0.5 ? annotated : omitted },
		} satisfies FieldsDef;
		type Config = InferStoreConfig<typeof fields>;
		type _Omitted = Expect<Equal<Config["omitted"], number>>;
		type _AsyncWithFailure = Expect<Equal<Config["asyncWithFailure"], string>>;
		type _Annotated = Expect<Equal<Config["annotated"], "a" | "b">>;
		type _Mixed = Expect<Equal<Config["mixed"], "a" | "b" | number>>;
	}

	{
		// Undefined phantom types fall back to validate(), including in schema unions.
		const requiredUndefined = {
			"~standard": {
				version: 1 as const,
				vendor: "d",
				types: undefined,
				validate: (_value: unknown) => ({ value: new Date() }),
			},
		};
		const optionalUndefined: {
			"~standard": {
				version: 1;
				vendor: string;
				types?: undefined;
				validate: (value: unknown) => Promise<{ value: Date }>;
			};
		} = {
			"~standard": {
				version: 1,
				vendor: "d",
				validate: async (_value) => ({ value: new Date() }),
			},
		};
		const numberSchema = {
			"~standard": {
				version: 1 as const,
				vendor: "d",
				validate: (value: unknown) => ({ value: Number(value) }),
			},
		};
		const fields = {
			requiredUndefined: { schema: requiredUndefined },
			optionalUndefined: { schema: optionalUndefined },
			mixedRequired: { schema: Math.random() < 0.5 ? requiredUndefined : numberSchema },
			mixedOptional: { schema: Math.random() < 0.5 ? optionalUndefined : numberSchema },
		} satisfies FieldsDef;
		type Config = InferStoreConfig<typeof fields>;
		type _RequiredUndefined = Expect<Equal<Config["requiredUndefined"], Date>>;
		type _OptionalUndefined = Expect<Equal<Config["optionalUndefined"], Date>>;
		type _MixedRequired = Expect<Equal<Config["mixedRequired"], Date | number>>;
		type _MixedOptional = Expect<Equal<Config["mixedOptional"], Date | number>>;
		const _options: CreateStoreOptions<typeof fields> = {
			dirPath: "/tmp",
			name: "undefined-phantom",
			fields: {
				// @ts-expect-error -- Date outputs require the JSON compatibility brand
				requiredUndefined: fields.requiredUndefined,
				// @ts-expect-error -- optional undefined phantom types also fall back
				optionalUndefined: fields.optionalUndefined,
				// @ts-expect-error -- unions must retain their non-JSON output member
				mixedRequired: fields.mixedRequired,
				// @ts-expect-error -- optional undefined phantom types also retain union members
				mixedOptional: fields.mixedOptional,
			},
		};
	}

	{
		// rejects mixing schema with core value options
		const _fields: FieldsDef = {
			// @ts-expect-error — schema exclusively owns defaults
			withDefault: { schema: z.string(), default: "x" },
			// @ts-expect-error — schema exclusively owns validation
			withValidate: { schema: z.string(), validate: () => {} },
		};
	}
}
