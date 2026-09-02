import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
	distSupportsBuilderUse,
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
	checkTimeSeconds: 0.3,
});

const report = (instantiations: number, scaling: [number, number, number]): TypePerfReport => ({
	...metrics(instantiations),
	scaling: {
		10: metrics(scaling[0]),
		50: metrics(scaling[1]),
		100: metrics(scaling[2]),
	},
	editor: null,
});

const repoRoot = resolve(import.meta.dir, "..");
const corePackage = join(repoRoot, "packages/core");
const tsc = join(repoRoot, "node_modules/.bin/tsc");

describe("type performance report", () => {
	it("parses every required extended-diagnostics metric", () => {
		expect(parseExtendedDiagnostics(diagnostics, "7.0.2")).toEqual({
			typescriptVersion: "7.0.2",
			instantiations: 282_284,
			types: 93_419,
			checkTimeSeconds: 0.322,
		});
	});

	it("fails when a required metric is absent", () => {
		expect(() => parseExtendedDiagnostics(diagnostics.replace(/^Types:.*$/m, ""), "7.0.2")).toThrow(
			"Missing types",
		);
	});

	it("generates deterministic scaling fixtures", () => {
		expect(generateConsumerSource(10)).toBe(generateConsumerSource(10));
		expect(generateConsumerSource(10)).toContain(".flags(");
		expect(generateConsumerSource(10)).toContain(".extend(extension)");
		expect(generateConsumerSource(10).match(/const command\d+ = defineCommand/g)).toHaveLength(10);
	});

	it("emits the pre-.use() config API for base trees that predate builder .use()", () => {
		const source = generateConsumerSource(10, false);
		expect(source).toContain("uses: [context");
		expect(source).not.toContain(".use(");
	});

	it("compiles the size-10 consumer fixture against built dist declarations", () => {
		const build = Bun.spawnSync(["bun", "run", "build"], {
			cwd: corePackage,
			stdout: "pipe",
			stderr: "pipe",
		});
		if (build.exitCode !== 0) {
			throw new Error(`core build failed:\n${build.stdout.toString()}${build.stderr.toString()}`);
		}
		const fixtureDir = mkdtempSync(join(tmpdir(), "crust-type-perf-test-"));
		try {
			// This repo's dist is a head tree: the probe must pick the .use() fixture.
			expect(distSupportsBuilderUse(corePackage)).toBe(true);
			const consumerDir = join(fixtureDir, "consumer-10");
			generateConsumerFixture(consumerDir, corePackage, 10);
			const result = Bun.spawnSync([tsc, "--noEmit", "--incremental", "false", "-p", consumerDir], {
				cwd: repoRoot,
				stdout: "pipe",
				stderr: "pipe",
			});

			expect(result.stdout.toString() + result.stderr.toString()).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			rmSync(fixtureDir, { recursive: true, force: true });
		}
	});

	it("formats core and consumer scaling deltas and warns on regressions", () => {
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
		expect(output).toContain("| 100 ⚠️ | 50,000 | 60,000 | +10,000 (+20.0%) |");
		expect(output).toContain("| 100/10 scaling ratio ⚠️ | 5.00× | 6.00× | +1.00 (+20.0%) |");
		expect(output).toContain("TypeScript 7.0.2 · ⚠️ marks compiler-work increases above 10%.");
	});

	it("renders editor latency rows, with n/a when measurement failed", () => {
		const base = report(100_000, [10_000, 25_000, 50_000]);
		const head = report(100_000, [10_000, 25_000, 50_000]);
		head.editor = {
			coldCompletionMs: 51.2,
			completionMs: 0.6,
			hoverMs: 0.7,
			editCompletionMs: 13.5,
		};
		const output = formatComparison(base, head);

		expect(output).toContain("### Editor latency");
		expect(output).toContain("| Cold first completion | n/a | 51.2ms |");
		expect(output).toContain("| Completion (warm, median) | n/a | 0.6ms |");
		expect(output).toContain("| Completion after edit (median) | n/a | 13.5ms |");
	});

	it("renders n/a when a base scaling fixture failed to compile", () => {
		const base = report(100_000, [10_000, 25_000, 50_000]);
		base.scaling[100] = null;
		const head = report(100_000, [10_000, 25_000, 50_000]);
		const output = formatComparison(base, head);

		expect(output).toContain("| 100 | n/a | 50,000 | n/a |");
		expect(output).toContain("| 100/10 scaling ratio | n/a | 5.00× | n/a |");
	});

	it("handles a zero base and flags a TypeScript version mismatch", () => {
		const base = report(0, [10_000, 25_000, 50_000]);
		const head = report(100, [10_000, 25_000, 50_000]);
		head.typescriptVersion = "7.1.0";
		const output = formatComparison(base, head);

		expect(output).toContain("| Instantiations ⚠️ | 0 | 100 | +100 (n/a) |");
		expect(output).toContain(
			"⚠️ TypeScript version differs (base 7.0.2 → head 7.1.0) — deltas include compiler changes, not just this PR.",
		);
	});
});
