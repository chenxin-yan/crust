// Compile-time contracts, enforced by check:types (not bun test).

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

// ────────────────────────────────────────────────────────────────────────────
// CreateStoreOptions
// ────────────────────────────────────────────────────────────────────────────

{
	// CreateStoreOptions
	{
		// should require a store name
		const fields = {
			theme: { type: "string", default: "light" },
		} as const satisfies FieldsDef;

		// @ts-expect-error — stores must have an explicit name
		const _options: CreateStoreOptions<typeof fields> = {
			dirPath: "/tmp/test",
			fields,
		};
	}
}
