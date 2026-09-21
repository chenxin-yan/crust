import { describe, expect, it } from "bun:test";

import { config, deploy, finite, knownKeys, route } from "./contract.ts";
import { shuffled, stats } from "./support.ts";

describe("benchmark contract and summaries", () => {
	it("rejects empty text and nonfinite values instead of silently defaulting", () => {
		for (const value of ["", " ", "NaN", "Infinity", "-Infinity", "nope", undefined])
			expect(() => finite(value)).toThrow();
		expect(finite("2.5")).toBe(2.5);
		expect(() => deploy("api", "", "1", false, [])).toThrow();
		expect(() => deploy("api", "eu", "1", false, [""])).toThrow();
		expect(() => config("theme", "")).toThrow();
		expect(config("theme", undefined)).toEqual({ command: "config", key: "theme", value: null });
	});
	it("bare parser glue rejects unknown routes and options", () => {
		expect(route(["deploy", "api"])).toEqual({ command: "deploy", args: ["api"] });
		expect(() => route(["bogus"])).toThrow();
		expect(() => knownKeys({ _: [], region: "eu" }, "config")).toThrow();
	});
	it("reproducibly shuffles measurement order without losing or mutating entries", () => {
		const items = Array.from({ length: 12 }, (_, i) => i);
		const order = shuffled(items, 20260920);
		expect(order).toEqual(shuffled(items, 20260920));
		expect(order).not.toEqual(shuffled(items, 20260921));
		expect([...order].sort((a, b) => a - b)).toEqual(items);
		expect(items).toEqual(Array.from({ length: 12 }, (_, i) => i));
	});
	it("summarizes raw sorted samples without mutating them", () => {
		const samples = [5, 1, 3, 2, 4];
		expect(stats(samples)).toEqual({ median: 3, p05: 1.2, p95: 4.8, min: 1, max: 5 });
		expect(samples).toEqual([5, 1, 3, 2, 4]);
		expect(() => stats([])).toThrow();
		expect(() => stats([Infinity])).toThrow();
	});
});
