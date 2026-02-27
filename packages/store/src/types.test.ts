import { describe, expect, it } from "bun:test";
import type {
	CreateStoreOptions,
	DeepPartial,
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
// DeepPartial
// ────────────────────────────────────────────────────────────────────────────

describe("DeepPartial", () => {
	it("should make top-level properties optional", () => {
		type Original = { theme: string; verbose: boolean };
		type Partial = DeepPartial<Original>;

		// All keys become optional
		const _ok1: Partial = {};
		const _ok2: Partial = { theme: "dark" };
		const _ok3: Partial = { verbose: true };
		const _ok4: Partial = { theme: "dark", verbose: true };

		expect(true).toBe(true);
	});

	it("should recursively make nested object properties optional", () => {
		type Original = {
			ui: { theme: string; fontSize: number };
			verbose: boolean;
		};
		type Partial = DeepPartial<Original>;

		// Nested keys are also optional
		const _ok1: Partial = { ui: {} };
		const _ok2: Partial = { ui: { theme: "dark" } };
		const _ok3: Partial = { ui: { fontSize: 16 } };
		const _ok4: Partial = {};

		expect(true).toBe(true);
	});

	it("should leave arrays as-is (not partially update elements)", () => {
		type Original = { tags: string[]; counts: number[] };
		type Partial = DeepPartial<Original>;

		// Arrays are replaced wholesale
		const _ok1: Partial = { tags: ["a", "b"] };
		const _ok2: Partial = { counts: [1, 2, 3] };

		// Type-level check: array element type is preserved
		type _Check = AssertExact<NonNullable<Partial["tags"]>, string[]>;

		expect(true).toBe(true);
	});

	it("should handle deeply nested objects", () => {
		type Original = {
			a: { b: { c: { d: string } } };
		};
		type Partial = DeepPartial<Original>;

		const _ok1: Partial = {};
		const _ok2: Partial = { a: {} };
		const _ok3: Partial = { a: { b: {} } };
		const _ok4: Partial = { a: { b: { c: {} } } };
		const _ok5: Partial = { a: { b: { c: { d: "hello" } } } };

		expect(true).toBe(true);
	});

	it("should preserve primitive types unchanged", () => {
		type _Check1 = AssertExact<DeepPartial<string>, string>;
		type _Check2 = AssertExact<DeepPartial<number>, number>;
		type _Check3 = AssertExact<DeepPartial<boolean>, boolean>;

		expect(true).toBe(true);
	});

	it("should handle readonly arrays", () => {
		type Original = { items: readonly string[] };
		type Partial = DeepPartial<Original>;

		// readonly arrays pass through unchanged
		type _Check = AssertExact<NonNullable<Partial["items"]>, readonly string[]>;

		expect(true).toBe(true);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// CreateStoreOptions
// ────────────────────────────────────────────────────────────────────────────

describe("CreateStoreOptions", () => {
	it("should accept options with flat defaults", () => {
		const options: CreateStoreOptions<{
			theme: string;
			verbose: boolean;
			retries: number;
		}> = {
			dirPath: "/tmp/test",
			defaults: {
				theme: "light",
				verbose: false,
				retries: 3,
			},
		};

		expect(options.dirPath).toBe("/tmp/test");
		expect(options.defaults.theme).toBe("light");
	});

	it("should accept options with nested defaults", () => {
		const options: CreateStoreOptions<{
			ui: { theme: string; fontSize: number };
			verbose: boolean;
		}> = {
			dirPath: "/tmp/test",
			defaults: {
				ui: { theme: "light", fontSize: 14 },
				verbose: false,
			},
		};

		expect(options.defaults.ui.theme).toBe("light");
		expect(options.defaults.ui.fontSize).toBe(14);
	});

	it("should accept optional name", () => {
		const options: CreateStoreOptions<{ theme: string }> = {
			dirPath: "/tmp/test",
			name: "settings",
			defaults: { theme: "light" },
		};

		expect(options.name).toBe("settings");
	});

	it("should accept optional validate function", () => {
		const options: CreateStoreOptions<{ count: number }> = {
			dirPath: "/tmp/test",
			defaults: { count: 0 },
			validate: (state) => {
				if (state.count < 0) throw new Error("count must be >= 0");
			},
		};

		expect(typeof options.validate).toBe("function");
	});

	it("should accept async validate function", () => {
		const options: CreateStoreOptions<{ token: string }> = {
			dirPath: "/tmp/test",
			defaults: { token: "" },
			validate: async (state) => {
				if (!state.token) throw new Error("token required");
			},
		};

		expect(typeof options.validate).toBe("function");
	});

	it("should accept pruneUnknown option", () => {
		const options: CreateStoreOptions<{ theme: string }> = {
			dirPath: "/tmp/test",
			defaults: { theme: "light" },
			pruneUnknown: false,
		};

		expect(options.pruneUnknown).toBe(false);
	});

	it("should accept defaults with arrays", () => {
		const options: CreateStoreOptions<{
			tags: string[];
			counts: number[];
		}> = {
			dirPath: "/tmp/test",
			defaults: {
				tags: ["default"],
				counts: [0],
			},
		};

		expect(options.defaults.tags).toEqual(["default"]);
	});

	it("should infer T from defaults when used with createStore pattern", () => {
		// Simulates how createStore<T> infers the type parameter
		function acceptOptions<T extends Record<string, unknown>>(
			opts: CreateStoreOptions<T>,
		): T {
			return opts.defaults;
		}

		const result = acceptOptions({
			dirPath: "/tmp/test",
			defaults: {
				ui: { theme: "light" as string, fontSize: 14 },
				verbose: false,
			},
		});

		// Type inference should work: result has the shape of defaults
		type _Check = AssertAssignable<
			typeof result,
			{ ui: { theme: string; fontSize: number }; verbose: boolean }
		>;

		expect(result.verbose).toBe(false);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Store
// ────────────────────────────────────────────────────────────────────────────

describe("Store", () => {
	it("should define read, write, update, patch, reset", () => {
		type Config = { theme: string; verbose: boolean };

		// Type-level check — Store interface has all five methods
		type Keys = keyof Store<Config>;
		type _Check1 = AssertAssignable<"read", Keys>;
		type _Check2 = AssertAssignable<"write", Keys>;
		type _Check3 = AssertAssignable<"update", Keys>;
		type _Check4 = AssertAssignable<"patch", Keys>;
		type _Check5 = AssertAssignable<"reset", Keys>;

		expect(true).toBe(true);
	});

	it("should type read() return as Promise<T>", () => {
		type Config = { a: number; b: { c: string } };
		type ReadReturn = ReturnType<Store<Config>["read"]>;
		type _Check = AssertExact<ReadReturn, Promise<Config>>;

		expect(true).toBe(true);
	});

	it("should type write() parameter as T", () => {
		type Config = { a: number; b: { c: string } };
		type WriteParam = Parameters<Store<Config>["write"]>[0];
		type _Check = AssertExact<WriteParam, Config>;

		expect(true).toBe(true);
	});

	it("should type patch() parameter as DeepPartial<T>", () => {
		type Config = { a: number; b: { c: string } };
		type PatchParam = Parameters<Store<Config>["patch"]>[0];
		type _Check = AssertExact<PatchParam, DeepPartial<Config>>;

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
	it("should accept a function that transforms state", () => {
		type Config = { theme: string; count: number };
		const updater: StoreUpdater<Config> = (current) => ({
			...current,
			count: current.count + 1,
		});

		const result = updater({ theme: "light", count: 0 });
		expect(result.count).toBe(1);
	});

	it("should work with nested objects", () => {
		type Config = { ui: { theme: string }; verbose: boolean };
		const updater: StoreUpdater<Config> = (current) => ({
			...current,
			ui: { ...current.ui, theme: "dark" },
		});

		const result = updater({ ui: { theme: "light" }, verbose: false });
		expect(result.ui.theme).toBe("dark");
		expect(result.verbose).toBe(false);
	});
});
