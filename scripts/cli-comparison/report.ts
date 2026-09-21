import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { here, stats } from "./support.ts";

const file = resolve(here, process.argv[2] ?? "results/full.json");
const data = JSON.parse(readFileSync(file, "utf8"));
const lines = [
	`# CLI comparison${data.metadata.quick ? " — SMOKE ONLY (not performance evidence)" : ""}`,
	"",
	`Generated from \`${file}\`; ${data.metadata.at}.`,
	`Bun ${data.metadata.runtimeVersions.bun}, Node ${data.metadata.runtimeVersions.node}; ${data.metadata.os.platform}/${data.metadata.os.arch}.`,
	`Crust local revision: \`${data.build.local.revision}\` (harness checkout \`${data.metadata.gitRevision}\`). Fingerprint: \`${data.metadata.sourceHash}\`.`,
	"",
	"Portable Node-target ESM bundles, identical settings for all rows and both runtimes. Raw/gzip bytes include adapters and dependencies; builtin implementation cost lives in the runtime. All measured bundles passed the bounded contract on BOTH runtimes outside node_modules.",
	"",
	"## Fixture bundle bytes",
	"",
	"| Library | Version | Kind | Minified B | gzip-9 B |",
	"|---|---|---|---:|---:|",
];
for (const lib of data.libraries) {
	const row = data.build.rows.find((r: { id: string }) => r.id === lib.id);
	lines.push(
		`| ${lib.id} | ${data.build.versions[lib.package] ?? "runtime builtin"} | ${lib.kind} | ${row.bytes} | ${row.gzipBytes} |`,
	);
}
for (const runtime of ["bun", "node"]) {
	lines.push(
		"",
		`## ${runtime}: warm invocation and OS-cache-warm startup`,
		"",
		"Median [p05–p95]. Warm includes fresh schema, parse/route/validate/dispatch, common await and JSON consumption; NOT pure tokenizer speed. Startup includes stdout and process overhead. No empty-process subtraction.",
		`Warm percentiles describe batch-average per-call times, not individual invocation latency: ${data.metadata.settings.warmRounds * data.metadata.settings.batches} batches of ${data.metadata.settings.callsPerBatch} calls. Startup: ${data.metadata.settings.startupSamples} samples.`,
		"",
		"| Library | Adapter | Warm µs/call | Startup ms |",
		"|---|---|---:|---:|",
	);
	const format = (s: { median: number; p05: number; p95: number }, divisor = 1) =>
		`${(s.median / divisor).toFixed(2)} [${(s.p05 / divisor).toFixed(2)}–${(s.p95 / divisor).toFixed(2)}]`;
	for (const lib of data.libraries) {
		const row = data.summary.find(
			(r: { id: string; runtime: string }) => r.id === lib.id && r.runtime === runtime,
		);
		lines.push(
			`| ${lib.id} | ${lib.async ? "async" : "sync"} | ${format(row.warmNs, 1000)} | ${format(row.startupMs)} |`,
		);
	}
	const baseline = data.startup.find(
		(r: { id: string; runtime: string }) => r.runtime === runtime && r.id === "empty-process",
	);
	lines.push(`| empty process | — | — | ${format(stats(baseline.samplesMs))} |`);
}
lines.push(
	"",
	"## Not measured (N/A, no ranking penalty)",
	"",
	"| Candidate | Version | Why this fixture is unsupported/excluded |",
	"|---|---|---|",
);
for (const row of data.exclusions) lines.push(`| ${row.id} | ${row.version} | ${row.reason} |`);
lines.push(
	"",
	"## Interpretation",
	"",
	"One tiny two-command workload; not a feature, help, completion, plugin, memory, security or large-tree comparison. Libraries and bare parsers provide different features. Samples are serial, reproducibly shuffled (seed recorded in raw metadata), machine-specific, and not statistical significance claims. See README.md/research.md for contract, source citations, lifecycle, limitations and reproduction. Raw JSON retains every sample, ordering, configuration, versions, source/bundle hashes and conformance evidence.",
);
console.log(lines.join("\n"));
