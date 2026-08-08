import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
	formatComparison,
	generateConsumerFixture,
	generateConsumerSource,
	parseExtendedDiagnostics,
	type TypePerfMetrics,
	type TypePerfReport,
} from "./type-perf-report.ts";

const diagnostics = `Symbols:         221923
Types:            93419
Instantiations:  282284
Memory used:    142714K
Check time:      0.322s
Total time:      0.376s`;

const metrics = (instantiations: number): TypePerfMetrics => ({
	typescriptVersion: "7.0.2",
	instantiations,
	types: 50_000,
	symbols: 80_000,
	memoryUsedKb: 120_000,
	checkTimeSeconds: 0.3,
	totalTimeSeconds: 0.4,
});

const report = (instantiations: number, scaling: [number, number, number]): TypePerfReport => ({
	...metrics(instantiations),
	scaling: {
		10: metrics(scaling[0]),
		50: metrics(scaling[1]),
		100: metrics(scaling[2]),
	},
});

const repoRoot = resolve(import.meta.dir, "..");
const corePackage = join(repoRoot, "packages/core");
const tsc = join(repoRoot, "node_modules/.bin/tsc");
let fixtureDir: string;

beforeAll(() => {
	const build = Bun.spawnSync(["bun", "run", "build"], {
		cwd: corePackage,
		stdout: "pipe",
		stderr: "pipe",
	});
	if (build.exitCode !== 0) {
		throw new Error(`core build failed:\n${build.stdout.toString()}${build.stderr.toString()}`);
	}
	fixtureDir = mkdtempSync(join(tmpdir(), "crust-type-perf-test-"));
});

afterAll(() => rmSync(fixtureDir, { recursive: true, force: true }));

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

	it("generates deterministic scaling fixtures", () => {
		expect(generateConsumerSource(10)).toBe(generateConsumerSource(10));
		expect(generateConsumerSource(10)).toContain(".flags(");
		expect(generateConsumerSource(10)).toContain(".provide(context0(), context1(), context2())");
		expect(generateConsumerSource(10).match(/const command\d+ = defineCommand/g)).toHaveLength(10);
	});

	it("compiles the size-10 consumer fixture against built dist declarations", () => {
		const consumerDir = join(fixtureDir, "consumer-10");
		generateConsumerFixture(consumerDir, corePackage, 10);
		const result = Bun.spawnSync([tsc, "--noEmit", "--incremental", "false", "-p", consumerDir], {
			cwd: repoRoot,
			stdout: "pipe",
			stderr: "pipe",
		});

		expect(result.stdout.toString() + result.stderr.toString()).toBe("");
		expect(result.exitCode).toBe(0);
	});

	it("formats core and consumer scaling deltas and warns on ratio regressions", () => {
		const base = report(100_000, [10_000, 25_000, 50_000]);
		const head = report(112_000, [10_000, 27_000, 60_000]);
		head.types = 55_000;
		head.checkTimeSeconds = 0.33;
		const output = formatComparison(base, head);

		expect(output).toContain("| Instantiations ⚠️ | 100,000 | 112,000 | +12,000 (+12.0%) |");
		expect(output).toContain("| Types | 50,000 | 55,000 | +5,000 (+10.0%) |");
		expect(output).toContain("Check time (informational — noisy on shared runners)");
		expect(output).toContain("### Consumer scaling (synthetic app vs dist)");
		expect(output).toContain("| 50 | 25,000 | 27,000 | +2,000 (+8.0%) |");
		expect(output).toContain("| 100/10 scaling ratio ⚠️ | 5.00× | 6.00× | +1.00 (+20.0%) |");
		expect(output).toContain("TypeScript 7.0.2 · `packages/core/tsconfig.json`");
	});
});
