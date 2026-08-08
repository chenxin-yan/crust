import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export interface TypePerfMetrics {
	typescriptVersion: string;
	instantiations: number;
	types: number;
	symbols: number;
	memoryUsedKb: number;
	checkTimeSeconds: number;
	totalTimeSeconds: number;
}

const metricPatterns = {
	instantiations: /^Instantiations:\s+(\d+)$/m,
	types: /^Types:\s+(\d+)$/m,
	symbols: /^Symbols:\s+(\d+)$/m,
	memoryUsedKb: /^Memory used:\s+(\d+)K$/m,
	checkTimeSeconds: /^Check time:\s+([\d.]+)s$/m,
	totalTimeSeconds: /^Total time:\s+([\d.]+)s$/m,
} as const;

export function parseExtendedDiagnostics(
	output: string,
	typescriptVersion: string,
): TypePerfMetrics {
	const parsed: Record<string, number | string> = { typescriptVersion };
	for (const [name, pattern] of Object.entries(metricPatterns)) {
		const match = output.match(pattern);
		if (!match) throw new Error(`Missing ${name} in TypeScript extended diagnostics`);
		parsed[name] = Number(match[1]);
	}
	return parsed as unknown as TypePerfMetrics;
}

const number = new Intl.NumberFormat("en-US");
const signed = (value: number, digits = 0) =>
	`${value > 0 ? "+" : value < 0 ? "−" : "±"}${digits === 0 ? number.format(Math.abs(value)) : Math.abs(value).toFixed(digits)}`;
const percentage = (base: number, head: number) =>
	base === 0
		? "n/a"
		: `${head > base ? "+" : head < base ? "−" : "±"}${Math.abs(((head - base) / base) * 100).toFixed(1)}%`;
const delta = (base: number, head: number, digits = 0) =>
	`${signed(head - base, digits)} (${percentage(base, head)})`;

export function formatComparison(base: TypePerfMetrics, head: TypePerfMetrics): string {
	const warns = {
		instantiations: head.instantiations > base.instantiations * 1.1 ? " ⚠️" : "",
		types: head.types > base.types * 1.1 ? " ⚠️" : "",
	};
	return [
		"| Metric | Base | Head | Δ |",
		"|---|---:|---:|---:|",
		`| Instantiations${warns.instantiations} | ${number.format(base.instantiations)} | ${number.format(head.instantiations)} | ${delta(base.instantiations, head.instantiations)} |`,
		`| Types${warns.types} | ${number.format(base.types)} | ${number.format(head.types)} | ${delta(base.types, head.types)} |`,
		`| Check time (informational — noisy on shared runners) | ${base.checkTimeSeconds.toFixed(3)}s | ${head.checkTimeSeconds.toFixed(3)}s | ${delta(base.checkTimeSeconds, head.checkTimeSeconds, 3)} |`,
		"",
		`TypeScript ${head.typescriptVersion} · \`packages/core/tsconfig.json\` · ⚠️ marks compiler-work increases above 10%.`,
	].join("\n");
}

function run(command: string[], cwd: string): string {
	const result = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0) {
		throw new Error(
			`Command failed (${command.join(" ")}):\n${result.stdout.toString()}${result.stderr.toString()}`,
		);
	}
	return result.stdout.toString().trim();
}

function measure(outputPath: string, rootDir = "."): void {
	const root = resolve(rootDir);
	const diagnostics = run(
		[
			"bunx",
			"tsc",
			"--noEmit",
			"--incremental",
			"false",
			"--extendedDiagnostics",
			"-p",
			"packages/core",
		],
		root,
	);
	const version = run(["bunx", "tsc", "--version"], root).replace(/^Version\s+/, "");
	writeFileSync(
		resolve(outputPath),
		`${JSON.stringify(parseExtendedDiagnostics(diagnostics, version), null, 2)}\n`,
	);
}

if (import.meta.main) {
	const [mode, ...args] = process.argv.slice(2);
	try {
		if (mode === "measure" && args[0]) {
			measure(args[0], args[1]);
		} else if (mode === "compare" && args.length === 2) {
			const [base, head] = args.map((path) => JSON.parse(readFileSync(path, "utf8")));
			console.log(formatComparison(base, head));
		} else {
			throw new Error(
				"usage: bun scripts/type-perf-report.ts measure <output.json> [rootDir] | compare <base.json> <head.json>",
			);
		}
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	}
}
