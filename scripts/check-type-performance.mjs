#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const coreDir = resolve(rootDir, "packages/core");
const baselinePath = "packages/core/tests/type-perf/baseline.json";
const command = ["bun", "run", "typecheck:perf:tsc"];
const reportedCommand =
	"tsc --noEmit --extendedDiagnostics --pretty false -p packages/core/tsconfig.type-perf.json";
const updateBaseline = process.argv.includes("--update-baseline");

function parseExtendedDiagnostics(output) {
	const metrics = new Map();
	for (const line of output.split(/\r?\n/)) {
		const match = line.match(/^([^:]+):\s+(.+)$/);
		if (!match) continue;
		const label = match[1]?.trim();
		const raw = match[2]?.trim();
		if (!label || !raw) continue;
		const value = Number(raw.replace(/,/g, "").replace(/[Ks]$/, ""));
		if (Number.isFinite(value)) {
			metrics.set(label, { raw, value });
		}
	}

	function required(label) {
		const metric = metrics.get(label);
		if (!metric) {
			throw new Error(`Missing "${label}" in tsc --extendedDiagnostics output.`);
		}
		return metric.value;
	}

	return {
		types: required("Types"),
		instantiations: required("Instantiations"),
		memoryUsedK: required("Memory used"),
		checkTimeSeconds: required("Check time"),
		totalTimeSeconds: required("Total time"),
	};
}

function readBaseline() {
	const absoluteBaselinePath = resolve(rootDir, baselinePath);
	if (!existsSync(absoluteBaselinePath)) {
		throw new Error(`Type performance baseline not found: ${baselinePath}`);
	}
	return JSON.parse(readFileSync(absoluteBaselinePath, "utf-8"));
}

function writeBaseline(metrics) {
	const absoluteBaselinePath = resolve(rootDir, baselinePath);
	mkdirSync(dirname(absoluteBaselinePath), { recursive: true });
	const baseline = {
		description:
			"Baseline for @crustjs/core type-check performance fixture. Time metrics are reported but not used for pass/fail because CI runners vary.",
		command: reportedCommand,
		thresholds: {
			types: 1.25,
			instantiations: 1.25,
		},
		metrics: {
			types: metrics.types,
			instantiations: metrics.instantiations,
		},
	};
	writeFileSync(absoluteBaselinePath, `${JSON.stringify(baseline, null, "\t")}\n`);
}

function compareMetric(name, current, baseline, ratio) {
	const limit = Math.ceil(baseline * ratio);
	return {
		name,
		current,
		baseline,
		limit,
		ok: current <= limit,
	};
}

const result = spawnSync(command[0], command.slice(1), {
	cwd: coreDir,
	encoding: "utf-8",
	stdio: ["ignore", "pipe", "pipe"],
});

const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
if (result.status !== 0) {
	process.stdout.write(output);
	process.exit(result.status ?? 1);
}

const metrics = parseExtendedDiagnostics(output);

if (updateBaseline) {
	writeBaseline(metrics);
	console.log(`Updated type performance baseline: ${baselinePath}`);
	console.log(`Types: ${metrics.types}`);
	console.log(`Instantiations: ${metrics.instantiations}`);
	console.log(`Check time: ${metrics.checkTimeSeconds}s`);
	console.log(`Total time: ${metrics.totalTimeSeconds}s`);
	process.exit(0);
}

const baseline = readBaseline();
const comparisons = [
	compareMetric("Types", metrics.types, baseline.metrics.types, baseline.thresholds.types),
	compareMetric(
		"Instantiations",
		metrics.instantiations,
		baseline.metrics.instantiations,
		baseline.thresholds.instantiations,
	),
];

console.log("Type-check performance diagnostics:");
for (const comparison of comparisons) {
	console.log(
		`  ${comparison.name}: ${comparison.current} (baseline ${comparison.baseline}, limit ${comparison.limit})`,
	);
}
console.log(`  Memory used: ${metrics.memoryUsedK}K`);
console.log(`  Check time: ${metrics.checkTimeSeconds}s`);
console.log(`  Total time: ${metrics.totalTimeSeconds}s`);

const failures = comparisons.filter((comparison) => !comparison.ok);
if (failures.length > 0) {
	console.error(
		`Type-check performance regression detected. Run "bun run typecheck:perf:update" only after reviewing the type-cost change.`,
	);
	process.exit(1);
}
