import { describe, expect, it } from "bun:test";

import {
	formatComparison,
	parseExtendedDiagnostics,
	type TypePerfMetrics,
} from "./type-perf-report.ts";

const diagnostics = `Symbols:         221923
Types:            93419
Instantiations:  282284
Memory used:    142714K
Check time:      0.322s
Total time:      0.376s`;

const base: TypePerfMetrics = {
	typescriptVersion: "7.0.2",
	instantiations: 100_000,
	types: 50_000,
	symbols: 80_000,
	memoryUsedKb: 120_000,
	checkTimeSeconds: 0.3,
	totalTimeSeconds: 0.4,
};

describe("type performance report", () => {
	it("parses every required extended-diagnostics metric", () => {
		expect(parseExtendedDiagnostics(diagnostics, "7.0.2")).toEqual({
			typescriptVersion: "7.0.2",
			instantiations: 282_284,
			types: 93_419,
			symbols: 221_923,
			memoryUsedKb: 142_714,
			checkTimeSeconds: 0.322,
			totalTimeSeconds: 0.376,
		});
	});

	it("fails when a required metric is absent", () => {
		expect(() =>
			parseExtendedDiagnostics(diagnostics.replace(/^Symbols:.*$/m, ""), "7.0.2"),
		).toThrow("Missing symbols");
	});

	it("formats base-to-head deltas and warns above ten percent", () => {
		const report = formatComparison(base, {
			...base,
			instantiations: 112_000,
			types: 55_000,
			checkTimeSeconds: 0.33,
		});

		expect(report).toContain("| Instantiations ⚠️ | 100,000 | 112,000 | +12,000 (+12.0%) |");
		expect(report).toContain("| Types | 50,000 | 55,000 | +5,000 (+10.0%) |");
		expect(report).toContain("Check time (informational — noisy on shared runners)");
		expect(report).toContain("TypeScript 7.0.2 · `packages/core/tsconfig.json`");
	});
});
