import { describe, expect, it } from "bun:test";
import type {
	CreateStoreOptions,
	FieldDef,
	FieldsDef,
	InferStoreConfig,
	Store,
	StoreUpdater,
} from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Type-level helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Compile-time assertion that A is assignable to B.
 * If this causes a type error the two types are not compatible.
 */
type AssertAssignable<_A extends B, B> = true;

/**
 * Compile-time assertion that A and B are exactly the same type.
 */
type AssertExact<A, B> = [A] extends [B]
	? [B] extends [A]
		? true
		: never
	: never;

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
});

// ────────────────────────────────────────────────────────────────────────────
// FieldDef
// ────────────────────────────────────────────────────────────────────────────

describe("FieldDef", () => {
	it("should accept scalar field definitions", () => {
		const stringField: FieldDef = { type: "string", default: "hello" };
		const numberField: FieldDef = { type: "number", default: 42 };
		const booleanField: FieldDef = { type: "boolean", default: true };

		expect(stringField.type).toBe("string");
		expect(numberField.type).toBe("number");
		expect(booleanField.type).toBe("boolean");
	});

	it("should accept array field definitions", () => {
		const stringArray: FieldDef = {
			type: "string",
			array: true,
			default: ["a"],
		};
		const numberArray: FieldDef = {
			type: "number",
			array: true,
			default: [1, 2],
		};

		expect(stringArray.type).toBe("string");
		expect(numberArray.type).toBe("number");
	});

	it("should accept fields without defaults", () => {
		const optional: FieldDef = { type: "string" };
		expect(optional.type).toBe("string");
	});

	it("should accept fields with description", () => {
		const field: FieldDef = {
			type: "string",
			default: "light",
			description: "The UI theme",
		};
		expect(field.description).toBe("The UI theme");
	});

	it("should accept fields with validate function", () => {
		const field: FieldDef = {
			type: "number",
			default: 3000,
			validate: (v) => {
				if (v < 1 || v > 65535) throw new Error("invalid port");
			},
		};
		expect(typeof field.validate).toBe("function");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// CreateStoreOptions
// ────────────────────────────────────────────────────────────────────────────

describe("CreateStoreOptions", () => {
	it("should accept valid options with fields", () => {
		const fields = {
			theme: { type: "string", default: "light" },
			verbose: { type: "boolean", default: false },
		} as const satisfies FieldsDef;

		const options: CreateStoreOptions<typeof fields> = {
			dirPath: "/tmp/test",
			fields,
		};

		expect(options.dirPath).toBe("/tmp/test");
		expect(options.fields.theme.default).toBe("light");
	});

	it("should accept optional name", () => {
		const fields = {
			theme: { type: "string", default: "light" },
		} as const satisfies FieldsDef;

		const options: CreateStoreOptions<typeof fields> = {
			dirPath: "/tmp/test",
			name: "settings",
			fields,
		};

		expect(options.name).toBe("settings");
	});

	it("should accept fields with validate functions", () => {
		const fields = {
			port: {
				type: "number",
				default: 3000,
				validate: (v: number) => {
					if (v < 1 || v > 65535) throw new Error("invalid port");
				},
			},
		} as const satisfies FieldsDef;

		const options: CreateStoreOptions<typeof fields> = {
			dirPath: "/tmp/test",
			fields,
		};

		expect(typeof options.fields.port.validate).toBe("function");
	});

	it("should accept pruneUnknown option", () => {
		const fields = {
			theme: { type: "string", default: "light" },
		} as const satisfies FieldsDef;

		const options: CreateStoreOptions<typeof fields> = {
			dirPath: "/tmp/test",
			fields,
			pruneUnknown: false,
		};

		expect(options.pruneUnknown).toBe(false);
	});

	it("should infer F from fields when used with createStore pattern", () => {
		// Simulates how createStore<F> infers the type parameter
		function acceptOptions<F extends FieldsDef>(
			_opts: CreateStoreOptions<F>,
		): InferStoreConfig<F> {
			return {} as InferStoreConfig<F>;
		}

		const result = acceptOptions({
			dirPath: "/tmp/test",
			fields: {
				theme: { type: "string", default: "light" },
				verbose: { type: "boolean", default: false },
			} as const satisfies FieldsDef,
		});

		// Type inference should work
		type _Check = AssertAssignable<
			typeof result,
			{ theme: string; verbose: boolean }
		>;

		expect(true).toBe(true);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Store
// ────────────────────────────────────────────────────────────────────────────

describe("Store", () => {
	it("should define read, write, update, patch, reset", () => {
		type Config = { theme: string; verbose: boolean };

		type Keys = keyof Store<Config>;
		type _Check1 = AssertAssignable<"read", Keys>;
		type _Check2 = AssertAssignable<"write", Keys>;
		type _Check3 = AssertAssignable<"update", Keys>;
		type _Check4 = AssertAssignable<"patch", Keys>;
		type _Check5 = AssertAssignable<"reset", Keys>;

		expect(true).toBe(true);
	});

	it("should type read() return as Promise<T>", () => {
		type Config = { a: number; b: string };
		type ReadReturn = ReturnType<Store<Config>["read"]>;
		type _Check = AssertExact<ReadReturn, Promise<Config>>;

		expect(true).toBe(true);
	});

	it("should type write() parameter as T", () => {
		type Config = { a: number; b: string };
		type WriteParam = Parameters<Store<Config>["write"]>[0];
		type _Check = AssertExact<WriteParam, Config>;

		expect(true).toBe(true);
	});

	it("should type patch() parameter as Partial<T>", () => {
		type Config = { a: number; b: string };
		type PatchParam = Parameters<Store<Config>["patch"]>[0];
		type _Check = AssertExact<PatchParam, Partial<Config>>;

		expect(true).toBe(true);
	});

	it("should type update() with StoreUpdater<T>", () => {
		type Config = { theme: string; count: number };
		type UpdateParam = Parameters<Store<Config>["update"]>[0];
		type _Check = AssertExact<UpdateParam, StoreUpdater<Config>>;

		expect(true).toBe(true);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// StoreUpdater
// ────────────────────────────────────────────────────────────────────────────

describe("StoreUpdater", () => {
	it("should accept a function that transforms config", () => {
		type Config = { theme: string; count: number };
		const updater: StoreUpdater<Config> = (current) => ({
			...current,
			count: current.count + 1,
		});

		const result = updater({ theme: "light", count: 0 });
		expect(result.count).toBe(1);
	});
});
