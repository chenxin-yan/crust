import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import {
	reapBoundedProcesses,
	runBoundedProcess,
} from "../packages/crust/tests/bounded-process.ts";
import {
	formatComparison,
	generateConsumerSource,
	parseExtendedDiagnostics,
	type TypePerfReport,
} from "./type-perf-report.ts";

const report = (small: number, large: number, stress: number): TypePerfReport => ({
	typescriptVersion: "7.0.2",
	fixtureApi: "fluent",
	instantiations: { 10: small, 100: large, 200: stress },
});

const repoRoot = resolve(import.meta.dirname, "..");
const script = join(repoRoot, "scripts/type-perf-report.ts");

// Below the 30s measurement test timeout; afterEach reaps shorter tests' children.
function measure(root: string, output: string) {
	return runBoundedProcess("bun", [script, "measure", output, root], {
		cwd: repoRoot,
		timeout: 25_000,
	});
}

afterEach(reapBoundedProcesses);

describe("type performance report", () => {
	it("requires only the instantiation count from extended diagnostics", () => {
		expect(parseExtendedDiagnostics("Instantiations: 282284")).toBe(282_284);
		expect(() => parseExtendedDiagnostics("Types: 93419")).toThrow("Missing instantiations");
	});

	it("generates the requested number of commands", () => {
		expect(generateConsumerSource(10).match(/const command\d+ = defineCommand/g)).toHaveLength(10);
	});

	it.each([10, 100, 200])("preserves the workload across API dialects at size %i", (size) => {
		const fluent = generateConsumerSource(size);
		const object = generateConsumerSource(size, "object");
		expect(object).toContain("uses: [context0]");
		expect(fluent).toContain("use: [context0]");
		expect(object).toContain('flags: [{ name: "extension-trace", type: "boolean" }]');
		expect(fluent).toContain('.flags({ name: "extension-trace", type: "boolean" })');
		const fluentCommand = fluent.match(/\t\.add\((defineCommand\("extension-command".+)\);/);
		const objectCommand = object.match(/\tcommands: \[(defineCommand\("extension-command".+)\],/);
		expect(fluentCommand?.[1]).toBeTruthy();
		expect(objectCommand?.[1]).toBe(fluentCommand?.[1]);
		const withoutExtension = (source: string) =>
			source.replace(/const extension = [\s\S]+?\n\n/, "").replaceAll("uses: [", "use: [");
		expect(withoutExtension(object)).toBe(withoutExtension(fluent));
	});

	it("measures all consumer sizes using the harness compiler, not the target tree's compiler", async () => {
		const root = mkdtempSync(join(tmpdir(), "crust-type-perf-test-"));
		try {
			mkdirSync(join(root, "packages"));
			symlinkSync(join(repoRoot, "packages/core"), join(root, "packages/core"), "dir");
			symlinkSync(join(repoRoot, "packages/utils"), join(root, "packages/utils"), "dir");
			const output = join(root, "report.json");
			const result = await measure(root, output);

			expect(result.stdout + result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			const measured = JSON.parse(readFileSync(output, "utf8"));
			expect(Object.keys(measured.instantiations)).toEqual(["10", "100", "200"]);
			expect(measured.instantiations[10]).toBeGreaterThan(0);
			expect(measured.instantiations[100]).toBeGreaterThan(measured.instantiations[10]);
			expect(measured.instantiations[200]).toBeGreaterThan(measured.instantiations[100]);
			expect(measured.typescriptVersion).toBeTruthy();
			expect(measured.fixtureApi).toBe("fluent");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	}, 30_000);

	it("fails measurement when a consumer cannot compile instead of publishing missing data", async () => {
		const root = mkdtempSync(join(tmpdir(), "crust-type-perf-failure-"));
		try {
			const core = join(root, "packages/core");
			mkdirSync(core, { recursive: true });
			symlinkSync(join(repoRoot, "packages/core/dist"), join(core, "dist"), "dir");
			writeFileSync(
				join(core, "package.json"),
				JSON.stringify({ name: "@crustjs/core", types: "index.d.ts" }),
			);
			writeFileSync(join(core, "index.d.ts"), "export {};\n");
			const output = join(root, "report.json");
			const result = await measure(root, output);

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("has no exported member");
			expect(() => readFileSync(output)).toThrow();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("labels comparisons across the extension API transition", () => {
		const base = { ...report(10_000, 50_000, 100_000), fixtureApi: "object" as const };
		expect(formatComparison(base, report(11_000, 60_000, 120_000))).toContain(
			"API transition (object → fluent): fixtures use equivalent workloads with each API's context and extension syntax, not identical source.",
		);
	});

	it("reports only per-fixture deltas and flags increases strictly above 10%", () => {
		const output = formatComparison(
			report(10_000, 50_000, 100_000),
			report(11_000, 60_000, 120_000),
		);
		expect(output).toContain("| 10 | 10,000 | 11,000 | +1,000 (+10.0%) |");
		expect(output).toContain("| 100 ⚠️ | 50,000 | 60,000 | +10,000 (+20.0%) |");
		expect(output).toContain("| 200 ⚠️ | 100,000 | 120,000 | +20,000 (+20.0%) |");
		expect(output).toContain("PR merge");
		expect(output).toContain("TypeScript 7.0.2");
		expect(output).not.toContain("Check time");
		expect(output).not.toContain("Editor latency");
		expect(output).not.toContain("scaling ratio");
		expect(output).not.toContain("API transition");
	});

	it("does not flag improved workloads when their ratio increases", () => {
		const output = formatComparison(
			report(20_000, 100_000, 200_000),
			report(10_000, 80_000, 180_000),
		);
		expect(output).toContain("| 10 | 20,000 | 10,000 | −10,000 (−50.0%) |");
		expect(output).toContain("| 100 | 100,000 | 80,000 | −20,000 (−20.0%) |");
		expect(output).toContain("| 200 | 200,000 | 180,000 | −20,000 (−10.0%) |");
		expect(output).not.toContain("| 100/10");
	});

	it("handles a zero baseline without an infinite percentage", () => {
		expect(formatComparison(report(0, 50_000, 100_000), report(100, 50_000, 100_000))).toContain(
			"| 10 ⚠️ | 0 | 100 | +100 (n/a) |",
		);
	});

	it("rejects comparisons made with different compiler versions", () => {
		const head = report(10_000, 50_000, 100_000);
		head.typescriptVersion = "7.1.0";
		expect(() => formatComparison(report(10_000, 50_000, 100_000), head)).toThrow(
			"TypeScript versions differ",
		);
	});
});
