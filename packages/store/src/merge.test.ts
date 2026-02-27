import { describe, expect, it } from "bun:test";
import { applyDefaults } from "./merge.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test default objects
// ────────────────────────────────────────────────────────────────────────────

const BASIC_DEFAULTS = {
	theme: "light",
	verbose: false,
	retries: 3,
};

const NESTED_DEFAULTS = {
	ui: { theme: "light", fontSize: 14 },
	verbose: false,
};

const DEEPLY_NESTED_DEFAULTS = {
	ui: {
		theme: { name: "light", contrast: "normal" },
		layout: { sidebar: true, compact: false },
	},
	logging: { level: "info", file: "/tmp/app.log" },
};

const ARRAY_DEFAULTS = {
	tags: ["default"] as string[],
	count: 0,
};

const MIXED_DEFAULTS = {
	ui: { theme: "light", fontSize: 14 },
	tags: ["default"] as string[],
	verbose: false,
	nested: {
		items: [1, 2, 3] as number[],
		label: "test",
	},
};

// ────────────────────────────────────────────────────────────────────────────
// applyDefaults — Shallow behavior (existing contract)
// ────────────────────────────────────────────────────────────────────────────

describe("applyDefaults", () => {
	// ──────────────────────────────────────────────────────────────────────
	// No persisted data
	// ──────────────────────────────────────────────────────────────────────

	it("should return all defaults when persisted is undefined", () => {
		const result = applyDefaults(undefined, BASIC_DEFAULTS);

		expect(result).toEqual({
			theme: "light",
			verbose: false,
			retries: 3,
		});
	});

	it("should return nested defaults when persisted is undefined", () => {
		const result = applyDefaults(undefined, NESTED_DEFAULTS);

		expect(result.ui).toEqual({ theme: "light", fontSize: 14 });
		expect(result.verbose).toBe(false);
	});

	// ──────────────────────────────────────────────────────────────────────
	// Persisted data — full match
	// ──────────────────────────────────────────────────────────────────────

	it("should use persisted values when all keys are present", () => {
		const persisted = { theme: "dark", verbose: true, retries: 5 };
		const result = applyDefaults(persisted, BASIC_DEFAULTS);

		expect(result).toEqual({
			theme: "dark",
			verbose: true,
			retries: 5,
		});
	});

	// ──────────────────────────────────────────────────────────────────────
	// Persisted data — partial match
	// ──────────────────────────────────────────────────────────────────────

	it("should fill missing persisted keys from defaults", () => {
		const persisted = { theme: "dark" };
		const result = applyDefaults(persisted, BASIC_DEFAULTS);

		expect(result).toEqual({
			theme: "dark",
			verbose: false,
			retries: 3,
		});
	});

	// ──────────────────────────────────────────────────────────────────────
	// Unknown keys — pruneUnknown (default: true)
	// ──────────────────────────────────────────────────────────────────────

	it("should drop persisted keys not defined in defaults", () => {
		const persisted = {
			theme: "dark",
			verbose: true,
			retries: 5,
			unknown: "extra",
		};
		const result = applyDefaults(persisted, BASIC_DEFAULTS);

		expect(result).toEqual({
			theme: "dark",
			verbose: true,
			retries: 5,
		});
		expect("unknown" in result).toBe(false);
	});

	// ──────────────────────────────────────────────────────────────────────
	// Array fields
	// ──────────────────────────────────────────────────────────────────────

	it("should apply array defaults", () => {
		const result = applyDefaults(undefined, ARRAY_DEFAULTS);

		expect(result.tags).toEqual(["default"]);
		expect(result.count).toBe(0);
	});

	it("should use persisted array values", () => {
		const persisted = { tags: ["a", "b"], count: 42 };
		const result = applyDefaults(persisted, ARRAY_DEFAULTS);

		expect(result).toEqual({
			tags: ["a", "b"],
			count: 42,
		});
	});

	// ──────────────────────────────────────────────────────────────────────
	// Edge cases
	// ──────────────────────────────────────────────────────────────────────

	it("should handle empty defaults", () => {
		const result = applyDefaults({ extra: "value" }, {});
		expect(result).toEqual({});
	});

	it("should handle empty persisted object", () => {
		const result = applyDefaults({}, BASIC_DEFAULTS);

		expect(result).toEqual({
			theme: "light",
			verbose: false,
			retries: 3,
		});
	});

	it("should preserve null as a persisted value", () => {
		const persisted = { theme: null, verbose: false, retries: 3 };
		const result = applyDefaults(persisted, BASIC_DEFAULTS);

		expect(result.theme).toBeNull();
	});

	it("should preserve zero as a persisted value", () => {
		const persisted = { retries: 0 };
		const result = applyDefaults(persisted, BASIC_DEFAULTS);

		expect(result.retries).toBe(0);
	});

	it("should preserve empty string as a persisted value", () => {
		const persisted = { theme: "" };
		const result = applyDefaults(persisted, BASIC_DEFAULTS);

		expect(result.theme).toBe("");
	});

	it("should preserve false as a persisted value", () => {
		const persisted = { verbose: false };
		const result = applyDefaults(persisted, BASIC_DEFAULTS);

		expect(result.verbose).toBe(false);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Deep merge — nested object merging
// ────────────────────────────────────────────────────────────────────────────

describe("applyDefaults — deep merge", () => {
	it("should deep-merge nested objects, filling missing nested keys from defaults", () => {
		const persisted = { ui: { theme: "dark" } };
		const result = applyDefaults(persisted, NESTED_DEFAULTS);

		expect(result).toEqual({
			ui: { theme: "dark", fontSize: 14 },
			verbose: false,
		});
	});

	it("should deep-merge three levels deep", () => {
		const persisted = {
			ui: { theme: { name: "dark" }, layout: { compact: true } },
		};
		const result = applyDefaults(persisted, DEEPLY_NESTED_DEFAULTS);

		expect(result).toEqual({
			ui: {
				theme: { name: "dark", contrast: "normal" },
				layout: { sidebar: true, compact: true },
			},
			logging: { level: "info", file: "/tmp/app.log" },
		});
	});

	it("should use full persisted nested object when all nested keys are present", () => {
		const persisted = { ui: { theme: "dark", fontSize: 18 }, verbose: true };
		const result = applyDefaults(persisted, NESTED_DEFAULTS);

		expect(result).toEqual({
			ui: { theme: "dark", fontSize: 18 },
			verbose: true,
		});
	});

	it("should use full default nested object when nested key is missing from persisted", () => {
		const persisted = { verbose: true };
		const result = applyDefaults(persisted, NESTED_DEFAULTS);

		expect(result).toEqual({
			ui: { theme: "light", fontSize: 14 },
			verbose: true,
		});
	});

	it("should drop unknown nested keys when pruneUnknown is true (default)", () => {
		const persisted = {
			ui: { theme: "dark", fontSize: 14, unknown: "nested-extra" },
			verbose: true,
		};
		const result = applyDefaults(persisted, NESTED_DEFAULTS);

		expect(result).toEqual({
			ui: { theme: "dark", fontSize: 14 },
			verbose: true,
		});
		expect("unknown" in (result.ui as Record<string, unknown>)).toBe(false);
	});

	it("should handle persisted replacing a nested object with a primitive", () => {
		// Type mismatch: defaults has object, persisted has string
		const persisted = { ui: "collapsed", verbose: true };
		const result = applyDefaults(
			persisted,
			NESTED_DEFAULTS as Record<string, unknown>,
		);

		// Persisted value wins when types don't match
		expect(result).toEqual({ ui: "collapsed", verbose: true });
	});

	it("should handle persisted replacing a primitive with an object", () => {
		// Type mismatch: defaults has boolean, persisted has object
		const persisted = { verbose: { level: "debug" } };
		const result = applyDefaults(
			persisted,
			NESTED_DEFAULTS as Record<string, unknown>,
		);

		// Persisted value wins when types don't match
		expect(result).toEqual({
			ui: { theme: "light", fontSize: 14 },
			verbose: { level: "debug" },
		});
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Arrays replace wholesale
// ────────────────────────────────────────────────────────────────────────────

describe("applyDefaults — array replacement", () => {
	it("should replace arrays wholesale, not merge elements", () => {
		const persisted = { tags: ["a"], count: 1 };
		const result = applyDefaults(persisted, ARRAY_DEFAULTS);

		expect(result.tags).toEqual(["a"]);
	});

	it("should replace empty array wholesale", () => {
		const persisted = { tags: [], count: 0 };
		const result = applyDefaults(persisted, ARRAY_DEFAULTS);

		expect(result.tags).toEqual([]);
	});

	it("should replace nested arrays inside objects wholesale", () => {
		const persisted = { nested: { items: [99], label: "updated" } };
		const result = applyDefaults(persisted, MIXED_DEFAULTS);

		expect((result.nested as Record<string, unknown>).items).toEqual([99]);
		expect((result.nested as Record<string, unknown>).label).toBe("updated");
	});

	it("should not recurse into arrays when defaults has an array and persisted has an array", () => {
		const defaults = { data: [{ id: 1, name: "a" }] };
		const persisted = { data: [{ id: 2 }] };
		const result = applyDefaults(
			persisted,
			defaults as Record<string, unknown>,
		);

		// Array replaced wholesale — no element-level merge
		expect(result.data).toEqual([{ id: 2 }]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Immutability guarantees (deep clone)
// ────────────────────────────────────────────────────────────────────────────

describe("applyDefaults — immutability", () => {
	it("should deep-clone array defaults to prevent shared mutation", () => {
		const defaults = { tags: ["a", "b"] };

		const result1 = applyDefaults(undefined, defaults);
		const result2 = applyDefaults(undefined, defaults);

		(result1.tags as string[]).push("c");
		expect(result2.tags).toEqual(["a", "b"]);
		expect(defaults.tags).toEqual(["a", "b"]);
	});

	it("should deep-clone nested object defaults to prevent shared mutation", () => {
		const defaults = { ui: { theme: "light", inner: { x: 1 } } };

		const result1 = applyDefaults(undefined, defaults);
		const result2 = applyDefaults(undefined, defaults);

		(result1.ui as Record<string, unknown>).theme = "dark";
		(
			(result1.ui as Record<string, unknown>).inner as Record<string, unknown>
		).x = 999;

		expect((result2.ui as Record<string, unknown>).theme).toBe("light");
		expect(
			((result2.ui as Record<string, unknown>).inner as Record<string, unknown>)
				.x,
		).toBe(1);
		// Original defaults should also be unaffected
		expect(defaults.ui.theme).toBe("light");
		expect(defaults.ui.inner.x).toBe(1);
	});

	it("should clone persisted arrays to detach from parsed input", () => {
		const persisted = { tags: ["x", "y"], count: 0 };

		const result = applyDefaults(persisted, ARRAY_DEFAULTS);
		(result.tags as string[]).push("z");

		expect(persisted.tags).toEqual(["x", "y"]);
	});

	it("should clone persisted nested objects to detach from parsed input", () => {
		const persisted = { ui: { theme: "dark", fontSize: 18 }, verbose: true };

		const result = applyDefaults(persisted, NESTED_DEFAULTS);
		(result.ui as Record<string, unknown>).theme = "modified";

		expect(persisted.ui.theme).toBe("dark");
	});

	it("should deep-clone deeply nested default objects", () => {
		const result1 = applyDefaults(undefined, DEEPLY_NESTED_DEFAULTS);
		const result2 = applyDefaults(undefined, DEEPLY_NESTED_DEFAULTS);

		const theme1 = (result1.ui as Record<string, unknown>).theme as Record<
			string,
			unknown
		>;
		theme1.name = "custom";

		const theme2 = (result2.ui as Record<string, unknown>).theme as Record<
			string,
			unknown
		>;
		expect(theme2.name).toBe("light");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// pruneUnknown parameter
// ────────────────────────────────────────────────────────────────────────────

describe("applyDefaults — pruneUnknown", () => {
	it("should drop unknown top-level keys when pruneUnknown is true (default)", () => {
		const persisted = { theme: "dark", extra: "gone" };
		const result = applyDefaults(persisted, BASIC_DEFAULTS);

		expect("extra" in result).toBe(false);
		expect(result.theme).toBe("dark");
	});

	it("should drop unknown nested keys when pruneUnknown is true (default)", () => {
		const persisted = {
			ui: { theme: "dark", fontSize: 14, extra: "gone" },
			verbose: false,
		};
		const result = applyDefaults(persisted, NESTED_DEFAULTS);

		expect("extra" in (result.ui as Record<string, unknown>)).toBe(false);
	});

	it("should preserve unknown top-level keys when pruneUnknown is false", () => {
		const persisted = {
			theme: "dark",
			verbose: true,
			retries: 5,
			extra: "kept",
		};
		const result = applyDefaults(persisted, BASIC_DEFAULTS, false);

		expect(result as Record<string, unknown>).toEqual({
			theme: "dark",
			verbose: true,
			retries: 5,
			extra: "kept",
		});
	});

	it("should preserve unknown nested keys when pruneUnknown is false", () => {
		const persisted = {
			ui: { theme: "dark", fontSize: 14, accent: "blue" },
			verbose: true,
		};
		const result = applyDefaults(persisted, NESTED_DEFAULTS, false);

		expect(result as Record<string, unknown>).toEqual({
			ui: { theme: "dark", fontSize: 14, accent: "blue" },
			verbose: true,
		});
	});

	it("should preserve deeply nested unknown keys when pruneUnknown is false", () => {
		const persisted = {
			ui: {
				theme: { name: "dark", contrast: "high", custom: true },
				layout: { sidebar: false, compact: true, panels: 3 },
			},
			logging: { level: "debug", file: "/var/log/app.log" },
			extra: { foo: "bar" },
		};
		const result = applyDefaults(persisted, DEEPLY_NESTED_DEFAULTS, false);

		expect(result as Record<string, unknown>).toEqual({
			ui: {
				theme: { name: "dark", contrast: "high", custom: true },
				layout: { sidebar: false, compact: true, panels: 3 },
			},
			logging: { level: "debug", file: "/var/log/app.log" },
			extra: { foo: "bar" },
		});
	});

	it("should clone unknown preserved keys to prevent mutation", () => {
		const persisted = {
			theme: "dark",
			verbose: true,
			retries: 5,
			extra: { nested: "value" },
		};
		const result = applyDefaults(persisted, BASIC_DEFAULTS, false);

		(
			(result as Record<string, unknown>).extra as Record<string, unknown>
		).nested = "modified";
		expect((persisted.extra as Record<string, unknown>).nested).toBe("value");
	});

	it("should still fill missing defaults when pruneUnknown is false", () => {
		const persisted = { theme: "dark", extra: "kept" };
		const result = applyDefaults(persisted, BASIC_DEFAULTS, false);

		expect(result as Record<string, unknown>).toEqual({
			theme: "dark",
			verbose: false,
			retries: 3,
			extra: "kept",
		});
	});

	it("should handle pruneUnknown=false with no persisted data", () => {
		const result = applyDefaults(undefined, BASIC_DEFAULTS, false);

		expect(result).toEqual({
			theme: "light",
			verbose: false,
			retries: 3,
		});
	});

	it("should prune unknown keys at all nesting levels when pruneUnknown is true", () => {
		const persisted = {
			ui: {
				theme: { name: "dark", contrast: "high", rogue: 42 },
				layout: { sidebar: true, compact: false },
				extra: true,
			},
			logging: { level: "warn", file: "/tmp/a.log", extra: "nope" },
			rogue_top: "gone",
		};
		const result = applyDefaults(persisted, DEEPLY_NESTED_DEFAULTS, true);

		expect(result).toEqual({
			ui: {
				theme: { name: "dark", contrast: "high" },
				layout: { sidebar: true, compact: false },
			},
			logging: { level: "warn", file: "/tmp/a.log" },
		});
	});
});
