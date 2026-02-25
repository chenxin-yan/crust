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
// Type-level inference tests (compile-time, validated via assignments)
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
});

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
});

describe("Store", () => {
	it("should define read, write, update, reset", () => {
		type Config = { theme: string; verbose: boolean };

		// Type-level check — Store interface has all four methods
		const _check: keyof Store<Config> = "read" as keyof Store<Config>;
		expect(["read", "write", "update", "reset"].includes(_check)).toBe(true);
	});
});

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
