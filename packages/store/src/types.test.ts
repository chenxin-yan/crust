import { describe, expect, it } from "bun:test";

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

describe("InferStoreConfig", () => {
	it("should infer types from field definitions with defaults", () => {
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
		const config: Config = {
			theme: "dark",
			verbose: true,
			retries: 5,
		};

		expect(config.theme).toBe("dark");
		expect(config.verbose).toBe(true);
		expect(config.retries).toBe(5);
	});

	it("should infer optional fields as T | undefined", () => {
		type Fields = {
			readonly theme: { readonly type: "string"; readonly default: "light" };
			readonly token: { readonly type: "string" };
		};
		type Config = InferStoreConfig<Fields>;

		// token has no default → string | undefined
		const config: Config = {
			theme: "light",
			token: undefined,
		};

		expect(config.theme).toBe("light");
		expect(config.token).toBeUndefined();
	});

	it("should infer array fields", () => {
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
		const config: Config = {
			tags: ["a", "b"],
			ids: undefined,
		};

		expect(config.tags).toEqual(["a", "b"]);
		expect(config.ids).toBeUndefined();
	});

	it("uses the exact Standard Schema output type", () => {
		const fields = {
			withDefault: { schema: z.string().default("x") },
			optional: { schema: z.string().optional() },
			required: { schema: z.string() },
		} as const satisfies FieldsDef;

		type Config = InferStoreConfig<typeof fields>;
		type _WithDefault = Expect<Equal<Config["withDefault"], string>>;
		type _Optional = Expect<Equal<Config["optional"], string | undefined>>;
		type _Required = Expect<Equal<Config["required"], string>>;
	});

	it("schema branch wins over tooling metadata in inference", () => {
		const fields = {
			tags: { schema: z.array(z.number()), type: "string", array: true },
		} as const satisfies FieldsDef;

		type Config = InferStoreConfig<typeof fields>;
		type _SchemaWins = Expect<Equal<Config["tags"], number[]>>;
	});
});

// ────────────────────────────────────────────────────────────────────────────
// FieldDef
// ────────────────────────────────────────────────────────────────────────────

describe("FieldDef", () => {
	it("rejects mixing schema with core value options", () => {
		const fields: FieldsDef = {
			// @ts-expect-error — schema exclusively owns defaults
			withDefault: { schema: z.string(), default: "x" },
			// @ts-expect-error — schema exclusively owns validation
			withValidate: { schema: z.string(), validate: () => {} },
		};
		expect(fields).toBeDefined();
	});
});

// ────────────────────────────────────────────────────────────────────────────
// CreateStoreOptions
// ────────────────────────────────────────────────────────────────────────────

describe("CreateStoreOptions", () => {
	it("should require a store name", () => {
		const fields = {
			theme: { type: "string", default: "light" },
		} as const satisfies FieldsDef;

		// @ts-expect-error — stores must have an explicit name
		const options: CreateStoreOptions<typeof fields> = {
			dirPath: "/tmp/test",
			fields,
		};

		expect(options).toBeDefined();
	});
});
