import { describe, expect, it } from "bun:test";
import { deepMerge } from "./merge.ts";

// ────────────────────────────────────────────────────────────────────────────
// deepMerge — Unit tests
// ────────────────────────────────────────────────────────────────────────────

describe("deepMerge", () => {
	// ── Basic merge behavior ──────────────────────────────────────────────

	it("fills missing keys from defaults", () => {
		const defaults = { a: 1, b: 2, c: 3 };
		const persisted = { a: 10 };
		const result = deepMerge(defaults, persisted);
		expect(result).toEqual({ a: 10, b: 2, c: 3 });
	});

	it("returns persisted as-is when all keys are present", () => {
		const defaults = { a: 1, b: 2 };
		const persisted = { a: 10, b: 20 };
		const result = deepMerge(defaults, persisted);
		expect(result).toEqual({ a: 10, b: 20 });
	});

	it("returns defaults when persisted is an empty object", () => {
		const defaults = { a: 1, b: 2 };
		const result = deepMerge(defaults, {});
		expect(result).toEqual({ a: 1, b: 2 });
	});

	it("includes persisted keys not present in defaults", () => {
		const defaults = { a: 1 } as Record<string, unknown>;
		const persisted = { a: 10, extra: "new" };
		const result = deepMerge(defaults, persisted);
		expect(result).toEqual({ a: 10, extra: "new" });
	});

	// ── Nested object merging ─────────────────────────────────────────────

	it("recursively merges nested plain objects", () => {
		const defaults = { ui: { theme: "light", fontSize: 14 }, verbose: false };
		const persisted = { ui: { theme: "dark" } };
		const result = deepMerge(defaults, persisted);
		expect(result).toEqual({
			ui: { theme: "dark", fontSize: 14 },
			verbose: false,
		});
	});

	it("handles deeply nested structures", () => {
		const defaults = {
			level1: {
				level2: {
					level3: { a: 1, b: 2 },
				},
			},
		};
		const persisted = {
			level1: {
				level2: {
					level3: { a: 100 },
				},
			},
		};
		const result = deepMerge(defaults, persisted);
		expect(result).toEqual({
			level1: {
				level2: {
					level3: { a: 100, b: 2 },
				},
			},
		});
	});

	it("merges nested object while adding new nested keys from persisted", () => {
		const defaults = { db: { host: "localhost" } } as Record<string, unknown>;
		const persisted = { db: { host: "remote", port: 5432 } };
		const result = deepMerge(defaults, persisted);
		expect(result).toEqual({ db: { host: "remote", port: 5432 } });
	});

	// ── Array behavior (replace, not merge) ──────────────────────────────

	it("replaces arrays entirely from persisted", () => {
		const defaults = { tags: ["a", "b", "c"] };
		const persisted = { tags: ["x"] };
		const result = deepMerge(defaults, persisted);
		expect(result).toEqual({ tags: ["x"] });
	});

	it("replaces default array with empty persisted array", () => {
		const defaults = { items: [1, 2, 3] };
		const persisted = { items: [] as number[] };
		const result = deepMerge(defaults, persisted);
		expect(result).toEqual({ items: [] });
	});

	it("uses default array when key is missing from persisted", () => {
		const defaults = { tags: ["a", "b"] };
		const persisted = {};
		const result = deepMerge(defaults, persisted);
		expect(result).toEqual({ tags: ["a", "b"] });
	});

	// ── Null handling ────────────────────────────────────────────────────

	it("treats null in persisted as an explicit value replacing the default", () => {
		const defaults = { name: "default" } as Record<string, unknown>;
		const persisted = { name: null };
		const result = deepMerge(defaults, persisted);
		expect(result).toEqual({ name: null });
	});

	it("treats null in persisted replacing a nested object default", () => {
		const defaults = { db: { host: "localhost", port: 3000 } } as Record<
			string,
			unknown
		>;
		const persisted = { db: null };
		const result = deepMerge(defaults, persisted);
		expect(result).toEqual({ db: null });
	});

	// ── Primitive persisted values ────────────────────────────────────────

	it("returns persisted when it is a non-object primitive (string)", () => {
		const result = deepMerge({ a: 1 } as unknown, "hello");
		expect(result).toBe("hello");
	});

	it("returns persisted when it is a non-object primitive (number)", () => {
		const result = deepMerge({ a: 1 } as unknown, 42);
		expect(result).toBe(42);
	});

	it("returns persisted when it is a non-object primitive (boolean)", () => {
		const result = deepMerge({ a: 1 } as unknown, true);
		expect(result).toBe(true);
	});

	it("returns persisted when it is null", () => {
		const result = deepMerge({ a: 1 } as unknown, null);
		expect(result).toBeNull();
	});

	// ── Non-plain-object defaults ─────────────────────────────────────────

	it("returns persisted when defaults is a primitive", () => {
		const result = deepMerge(42 as unknown, { a: 1 });
		expect(result).toEqual({ a: 1 });
	});

	it("returns persisted when defaults is an array", () => {
		const result = deepMerge([1, 2, 3] as unknown, { a: 1 });
		expect(result).toEqual({ a: 1 });
	});

	// ── Type replacement at boundaries ────────────────────────────────────

	it("replaces object default with primitive persisted value at same key", () => {
		const defaults = { setting: { nested: true } } as Record<string, unknown>;
		const persisted = { setting: "flat" };
		const result = deepMerge(defaults, persisted);
		expect(result).toEqual({ setting: "flat" });
	});

	it("replaces primitive default with object persisted value at same key", () => {
		const defaults = { setting: "flat" } as Record<string, unknown>;
		const persisted = { setting: { nested: true } };
		const result = deepMerge(defaults, persisted);
		expect(result).toEqual({ setting: { nested: true } });
	});

	// ── Immutability ─────────────────────────────────────────────────────

	it("does not mutate the defaults object", () => {
		const defaults = { a: 1, b: { c: 2 } };
		const defaultsCopy = JSON.parse(JSON.stringify(defaults));
		const persisted = { a: 10, b: { c: 20 } };
		deepMerge(defaults, persisted);
		expect(defaults).toEqual(defaultsCopy);
	});

	it("does not mutate the persisted object", () => {
		const defaults = { a: 1, b: { c: 2 } };
		const persisted = { a: 10 };
		const persistedCopy = JSON.parse(JSON.stringify(persisted));
		deepMerge(defaults, persisted);
		expect(persisted).toEqual(persistedCopy);
	});

	// ── Edge cases ───────────────────────────────────────────────────────

	it("handles Object.create(null) as a plain object", () => {
		const defaults = { a: 1 };
		const persisted = Object.create(null) as Record<string, unknown>;
		persisted.a = 10;
		const result = deepMerge(defaults, persisted);
		expect(result).toEqual({ a: 10 });
	});

	it("does not merge class instances — treats them as non-plain objects", () => {
		class Config {
			value = 42;
		}
		const defaults = { config: { value: 1 } } as Record<string, unknown>;
		const persisted = { config: new Config() };
		const result = deepMerge(defaults, persisted);
		// Class instance replaces default, not deep-merged
		expect((result as { config: Config }).config).toBeInstanceOf(Config);
		expect((result as { config: Config }).config.value).toBe(42);
	});

	it("handles undefined persisted value — replaces default with undefined", () => {
		const defaults = { a: 1, b: 2 } as Record<string, unknown>;
		const persisted = { a: undefined };
		const result = deepMerge(defaults, persisted);
		expect(result).toEqual({ a: undefined, b: 2 });
	});
});
