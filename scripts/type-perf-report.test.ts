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
	parseCheckSeconds,
	parseExtendedDiagnostics,
	type TypePerfReport,
} from "./type-perf-report.ts";

type Measured = TypePerfReport["instantiations"]["10"];
const report = (
	small: Measured,
	large: Measured,
	stress: Measured,
	wide: Measured = 1_000,
	contexts: Measured = 1_000,
	extensions: Measured = 1_000,
	[check200, check400] = [1, 2],
): TypePerfReport => ({
	typescriptVersion: "7.0.2",
	fixtureApi: "fluent",
	instantiations: {
		10: small,
		100: large,
		200: stress,
		400: typeof stress === "number" ? stress * 2 : stress,
		"50 in one .add()": wide,
		"60 Contexts in one call": contexts,
		"60 Extensions in one call": extensions,
	},
	checkSeconds: { 200: check200, 400: check400 },
});

const repoRoot = resolve(import.meta.dirname, "..");
const script = join(repoRoot, "scripts/type-perf-report.ts");

// Below the 60s measurement test timeout; afterEach reaps shorter tests' children.
function measure(root: string, output: string, ...flags: string[]) {
	return runBoundedProcess("bun", [script, "measure", output, root, ...flags], {
		cwd: repoRoot,
		timeout: 55_000,
	});
}

afterEach(reapBoundedProcesses);

describe("type performance report", () => {
	it("reads the instantiation count and check time from extended diagnostics", () => {
		expect(parseExtendedDiagnostics("Instantiations: 282284")).toBe(282_284);
		expect(() => parseExtendedDiagnostics("Types: 93419")).toThrow("Missing instantiations");
		expect(parseCheckSeconds("Check time:       1.647s")).toBe(1.647);
		expect(() => parseCheckSeconds("Bind time: 0.1s")).toThrow("Missing check time");
	});

	it.each([10])("preserves the workload across API dialects at size %i", (size) => {
		const fluent = generateConsumerSource(size);
		const config = generateConsumerSource(size, "context-config");
		expect(config).toContain(
			'defineContext("context-1", { flags: [contextFlag1], use: [context0] }, async',
		);
		expect(fluent).toContain(
			'defineContext("context-1").flags(contextFlag1).use(context0).setup(async',
		);
		expect(fluent).not.toMatch(/defineContext\("[^"]+", /);
		const withoutContexts = (source: string) =>
			source.replace(/^const (context|wide)\d+ = .+$/gm, "");
		expect(withoutContexts(config)).toBe(withoutContexts(fluent));

		const wideFluent = generateConsumerSource(size, "fluent", false, true);
		const wideConfig = generateConsumerSource(size, "context-config", false, true);
		expect(wideConfig).toContain('const wide59 = defineContext("wide-59", () => 59);');
		expect(wideFluent).toContain('const wide59 = defineContext("wide-59").setup(() => 59);');
		expect(withoutContexts(wideConfig)).toBe(withoutContexts(wideFluent));

		const extensionsFluent = generateConsumerSource(size, "fluent", false, false, true);
		const extensionsConfig = generateConsumerSource(size, "context-config", false, false, true);
		expect(extensionsConfig).toContain('.provide(defineContext("wide-extension-59", () => 59)())');
		expect(extensionsFluent).toContain(
			'.provide(defineContext("wide-extension-59").setup(() => 59)())',
		);
		const withoutInlineContexts = (source: string) =>
			withoutContexts(source).replace(
				/defineContext\("([^"]+)"(?:\)\.setup\(|, )\(\) => (\d+)\)/g,
				"context($1, $2)",
			);
		expect(withoutInlineContexts(extensionsConfig)).toBe(withoutInlineContexts(extensionsFluent));
	});

	it("exercises typed run()/at() and adds commands one call at a time unless wide", () => {
		const chained = generateConsumerSource(10);
		expect(chained.match(/^void app\.run\(\[/gm)).toHaveLength(5);
		expect(chained).toContain(
			'void app.run(["command-8"], { args: { "source-8": "src" }, flags: { "command-8-force": true } });',
		);
		expect(chained).toContain('void app.at(["cmd-0", "n-0"]);');
		expect(chained).toContain("\t.add(command0)\n\t.add(command1)\n");

		const wide = generateConsumerSource(50, "fluent", true);
		const commands = Array.from({ length: 50 }, (_, index) => `command${index}`).join(", ");
		expect(wide).toContain(`\t.add(${commands})\n`);
		expect(wide).not.toContain("\t.add(command0)\n");
	});

	it("passes 60 Contexts in one call to .provide(), a command's .use(), and an extended Extension", () => {
		expect(generateConsumerSource(10)).not.toContain("wide");
		const source = generateConsumerSource(10, "fluent", false, true);
		const factories = Array.from({ length: 60 }, (_, index) => `wide${index}`);
		const instances = factories.map((factory) => `${factory}()`).join(", ");
		expect(source).toContain(`command.use(${factories.join(", ")})`);
		expect(source).toContain(`.provide(${instances});\n`);
		expect(source).toContain(`\t.provide(${instances})\n\t.add(wideCommand)\n`);
		expect(source).toContain('new Crust("type-perf-wide").extend(wideExtension)');
	});

	it("passes 60 Extensions with flags, Contexts and commands to one .extend() call", () => {
		expect(generateConsumerSource(10)).not.toContain("wideExtension");
		const source = generateConsumerSource(10, "fluent", false, false, true);
		const extensions = Array.from({ length: 60 }, (_, index) => `wideExtension${index}`);
		expect(source).toContain(
			`new Crust("type-perf-wide-extensions").extend(${extensions.join(", ")})`,
		);
		expect(source).toContain(
			'const wideExtension59 = defineExtension(defineExtensionId("type-perf-wide-extension-59")).flags({ name: "wide-extension-59", type: "boolean" }).provide(defineContext("wide-extension-59").setup(() => 59)()).add(defineCommand("wide-extension-command-59", (command) => command));',
		);
		expect(source).not.toContain("wide59");
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
			expect(Object.keys(measured.instantiations)).toEqual([
				"10",
				"100",
				"200",
				"400",
				"50 in one .add()",
				"60 Contexts in one call",
				"60 Extensions in one call",
			]);
			expect(measured.instantiations[10]).toBeGreaterThan(0);
			expect(measured.instantiations["50 in one .add()"]).toBeGreaterThan(0);
			expect(measured.instantiations["60 Contexts in one call"]).toBeGreaterThan(
				measured.instantiations[10],
			);
			expect(measured.instantiations["60 Extensions in one call"]).toBeGreaterThan(
				measured.instantiations[10],
			);
			expect(measured.instantiations[100]).toBeGreaterThan(measured.instantiations[10]);
			expect(measured.instantiations[200]).toBeGreaterThan(measured.instantiations[100]);
			expect(measured.instantiations[400]).toBeGreaterThan(measured.instantiations[200]);
			expect(Object.keys(measured.checkSeconds)).toEqual(Object.keys(measured.instantiations));
			expect(measured.checkSeconds[400]).toBeGreaterThan(0);
			expect(measured.typescriptVersion).toBeTruthy();
			expect(measured.fixtureApi).toBe("fluent");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	}, 60_000);

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

			const tolerated = await measure(root, output, "--allow-compile-errors");
			expect(tolerated.stdout + tolerated.stderr).toBe("");
			expect(tolerated.exitCode).toBe(0);
			expect(JSON.parse(readFileSync(output, "utf8")).instantiations).toEqual({
				10: { error: "TS2305" },
				100: { error: "TS2305" },
				200: { error: "TS2305" },
				400: { error: "TS2305" },
				"50 in one .add()": { error: "TS2305" },
				"60 Contexts in one call": { error: "TS2305" },
				"60 Extensions in one call": { error: "TS2305" },
			});
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	}, 60_000);

	it("reports base compile errors as n/a and rejects a failing PR merge", () => {
		const output = formatComparison(
			report(
				10_000,
				50_000,
				{ error: "TS2590" },
				{ error: "TS2589" },
				{ error: "TS2589" },
				{ error: "TS2589" },
			),
			report(11_000, 60_000, 120_000, 2_000, 3_000, 4_000),
		);
		expect(output).toContain(
			"| 60 Contexts in one call | n/a (base failed: TS2589) | 3,000 | n/a |",
		);
		expect(output).toContain(
			"| 60 Extensions in one call | n/a (base failed: TS2589) | 4,000 | n/a |",
		);
		expect(output).toContain("| 200 | n/a (base failed: TS2590) | 120,000 | n/a |");
		expect(output).toContain("| 50 in one .add() | n/a (base failed: TS2589) | 2,000 | n/a |");
		expect(output).toContain("| 10 | 10,000 | 11,000 | +1,000 (+10.0%) |");
		expect(() =>
			formatComparison(
				report(10_000, 50_000, 100_000),
				report(10_000, 50_000, 100_000, { error: "TS2589" }),
			),
		).toThrow("PR merge fixture 50 in one .add() failed to compile: TS2589");
	});

	it("labels comparisons across the Context API transition", () => {
		const base = { ...report(10_000, 50_000, 100_000), fixtureApi: "context-config" as const };
		expect(formatComparison(base, report(11_000, 60_000, 120_000))).toContain(
			"API transition (context-config → fluent): fixtures use equivalent workloads with each API's context and extension syntax, not identical source.",
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
		expect(output).not.toContain("Editor latency");
		expect(output).not.toContain("API transition");
	});

	it("flags check-time scaling only when it grows more than 20% above base", () => {
		const base = report(10_000, 50_000, 100_000, 1_000, 1_000, 1_000, [1, 2.3]);
		expect(
			formatComparison(base, report(10_000, 50_000, 100_000, 1_000, 1_000, 1_000, [2, 5.5])),
		).toContain("Check-time scaling (400 ÷ 200 commands): base 2.30× · PR merge 2.75×");
		expect(
			formatComparison(base, report(10_000, 50_000, 100_000, 1_000, 1_000, 1_000, [1, 3.1])),
		).toContain("Check-time scaling (400 ÷ 200 commands) ⚠️: base 2.30× · PR merge 3.10×");
		const failedBase = report(10_000, 50_000, { error: "TS2590" });
		failedBase.checkSeconds = {};
		expect(formatComparison(failedBase, report(10_000, 50_000, 100_000))).toContain(
			"Check-time scaling (400 ÷ 200 commands): base n/a · PR merge 2.00×",
		);
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
