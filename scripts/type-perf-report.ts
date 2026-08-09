import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { type EditorLatencyMetrics, measureEditorLatency } from "./editor-latency.ts";

export interface TypePerfMetrics {
	typescriptVersion: string;
	instantiations: number;
	types: number;
	checkTimeSeconds: number;
}

export const scalingSizes = [10, 50, 100] as const;
export type ScalingSize = (typeof scalingSizes)[number];

// null scaling entry = the generated fixture failed to compile against this tree's
// dist (e.g. the PR changed the public API); rendered as "n/a" instead of failing.
export interface TypePerfReport extends TypePerfMetrics {
	scaling: Record<ScalingSize, TypePerfMetrics | null>;
	// Optional so reports written by older script revisions still compare;
	// null = the LSP session failed (rendered as "n/a").
	editor?: EditorLatencyMetrics | null;
}

const metricPatterns = {
	instantiations: /^Instantiations:\s+(\d+)$/m,
	types: /^Types:\s+(\d+)$/m,
	checkTimeSeconds: /^Check time:\s+([\d.]+)s$/m,
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

const editorLatencyLabels: Record<keyof EditorLatencyMetrics, string> = {
	coldCompletionMs: "Cold first completion",
	completionMs: "Completion (warm, median)",
	hoverMs: "Hover (warm, median)",
	editCompletionMs: "Completion after edit (median)",
};

function editorLatencyRows(
	base: EditorLatencyMetrics | null | undefined,
	head: EditorLatencyMetrics | null | undefined,
): string[] {
	return (Object.entries(editorLatencyLabels) as [keyof EditorLatencyMetrics, string][]).map(
		([key, label]) =>
			`| ${label} | ${base ? `${base[key].toFixed(1)}ms` : "n/a"} | ${head ? `${head[key].toFixed(1)}ms` : "n/a"} |`,
	);
}

export function formatComparison(base: TypePerfReport, head: TypePerfReport): string {
	const warns = {
		instantiations: head.instantiations > base.instantiations * 1.1 ? " ⚠️" : "",
		types: head.types > base.types * 1.1 ? " ⚠️" : "",
	};
	const ratio = (report: TypePerfReport) =>
		report.scaling[10] && report.scaling[100]
			? report.scaling[100].instantiations / report.scaling[10].instantiations
			: null;
	const baseRatio = ratio(base);
	const headRatio = ratio(head);
	const ratioWarning =
		baseRatio !== null && headRatio !== null && headRatio > baseRatio * 1.1 ? " ⚠️" : "";
	const footer =
		base.typescriptVersion === head.typescriptVersion
			? `TypeScript ${head.typescriptVersion} · ⚠️ marks compiler-work increases above 10%.`
			: `⚠️ TypeScript version differs (base ${base.typescriptVersion} → head ${head.typescriptVersion}) — deltas include compiler changes, not just this PR.`;
	return [
		"| Metric | Base | Head | Δ |",
		"|---|---:|---:|---:|",
		`| Instantiations${warns.instantiations} | ${number.format(base.instantiations)} | ${number.format(head.instantiations)} | ${delta(base.instantiations, head.instantiations)} |`,
		`| Types${warns.types} | ${number.format(base.types)} | ${number.format(head.types)} | ${delta(base.types, head.types)} |`,
		`| Check time (informational — noisy on shared runners) | ${base.checkTimeSeconds.toFixed(3)}s | ${head.checkTimeSeconds.toFixed(3)}s | ${delta(base.checkTimeSeconds, head.checkTimeSeconds, 3)} |`,
		"",
		"### Consumer scaling (synthetic app vs dist)",
		"",
		"| Commands | Base instantiations | Head instantiations | Δ |",
		"|---:|---:|---:|---:|",
		...scalingSizes.map((size) => {
			const baseMetrics = base.scaling[size];
			const headMetrics = head.scaling[size];
			if (!baseMetrics || !headMetrics) {
				return `| ${size} | ${baseMetrics ? number.format(baseMetrics.instantiations) : "n/a"} | ${headMetrics ? number.format(headMetrics.instantiations) : "n/a"} | n/a |`;
			}
			const warn = headMetrics.instantiations > baseMetrics.instantiations * 1.1 ? " ⚠️" : "";
			return `| ${size}${warn} | ${number.format(baseMetrics.instantiations)} | ${number.format(headMetrics.instantiations)} | ${delta(baseMetrics.instantiations, headMetrics.instantiations)} |`;
		}),
		baseRatio !== null && headRatio !== null
			? `| 100/10 scaling ratio${ratioWarning} | ${baseRatio.toFixed(2)}× | ${headRatio.toFixed(2)}× | ${delta(baseRatio, headRatio, 2)} |`
			: "| 100/10 scaling ratio | n/a | n/a | n/a |",
		"",
		"### Editor latency (informational — LSP round-trips on the 50-command fixture, wall time)",
		"",
		"| Request | Base | Head |",
		"|---|---:|---:|",
		...editorLatencyRows(base.editor, head.editor),
		"",
		footer,
	].join("\n");
}

/**
 * Generate a deterministic downstream app with `size` top-level sibling commands.
 * Each command has three chained flags and two chained args. Context count is
 * max(3, ceil(size / 10)); every tenth command also owns one nested subcommand.
 */
export function generateConsumerSource(size: number): string {
	if (!Number.isInteger(size) || size < 1) throw new Error("size must be a positive integer");
	const contextCount = Math.max(3, Math.ceil(size / 10));
	const lines = [
		'import { Crust, defineCommand, defineContext, defineFlag } from "@crustjs/core";',
		"",
	];

	for (let index = 0; index < contextCount; index++) {
		lines.push(
			`const contextFlag${index} = defineFlag("context-${index}-token", { type: "string", aliases: ["ctx-${index}-token"] });`,
		);
		if (index === 0) {
			lines.push(
				`const context${index} = defineContext("context-${index}", { flags: [contextFlag${index}] }, ({ flags }) => ({ value: flags["context-${index}-token"] ?? "" }));`,
			);
		} else {
			lines.push(
				`const context${index} = defineContext("context-${index}", { flags: [contextFlag${index}], requires: [context${index - 1}] }, ({ flags, ctx }) => ({ value: ctx["context-${index - 1}"].value + (flags["context-${index}-token"] ?? "") }));`,
			);
		}
	}
	lines.push("");

	for (let index = 0; index < size; index++) {
		const contextIndex = index % contextCount;
		lines.push(
			`const command${index} = defineCommand("command-${index}", { aliases: ["cmd-${index}", "c-${index}"], requires: [context${contextIndex}] }, (command) =>`,
			"\tcommand",
			`\t\t.flags({ name: "command-${index}-verbose", type: "boolean", short: "v", aliases: ["verbose-${index}"] })`,
			`\t\t.flags({ name: "command-${index}-output", type: "string", short: "o", aliases: ["output-${index}"] })`,
			`\t\t.flags({ name: "command-${index}-force", type: "boolean", short: "f", aliases: ["force-${index}"] })`,
			`\t\t.args({ name: "source-${index}", type: "string", required: true })`,
			`\t\t.args({ name: "destination-${index}", type: "string" })`,
		);
		if (index % 10 === 0) {
			lines.push(
				`\t\t.add(defineCommand("nested-${index}", { aliases: ["n-${index}"], requires: [context${contextIndex}] }, (nested) =>`,
				`\t\t\tnested.flags({ name: "nested-${index}-mode", type: "string", short: "m", aliases: ["mode-${index}"] }).action(({ flags, ctx }) => { void flags["nested-${index}-mode"]; void ctx["context-${contextIndex}"]; }),`,
				"\t\t))",
			);
		}
		lines.push(
			`\t\t.action(({ flags, args, ctx }) => { void flags["command-${index}-output"]; void args["source-${index}"]; void ctx["context-${contextIndex}"]; }),`,
			");",
			"",
		);
	}

	lines.push(
		'export const app = new Crust("type-perf-consumer", { description: "Synthetic type-performance fixture" })',
		'\t.flags({ name: "root-verbose", type: "boolean", short: "v", aliases: ["verbose"] })',
		'\t.flags({ name: "root-config", type: "string", short: "c", aliases: ["config"] })',
		`\t.provide(${Array.from({ length: contextCount }, (_, index) => `context${index}()`).join(", ")})`,
	);
	for (let index = 0; index < size; index++) lines.push(`\t.add(command${index})`);
	lines.push("\t.action(() => {});", "");
	return lines.join("\n");
}

export function generateConsumerFixture(
	outputDir: string,
	corePackageDir: string,
	size: number,
): void {
	const fixtureDir = resolve(outputDir);
	const packageDir = resolve(corePackageDir);
	mkdirSync(join(fixtureDir, "node_modules/@crustjs"), { recursive: true });
	symlinkSync(packageDir, join(fixtureDir, "node_modules/@crustjs/core"), "dir");
	writeFileSync(join(fixtureDir, "consumer.ts"), generateConsumerSource(size));
	writeFileSync(
		join(fixtureDir, "tsconfig.json"),
		`${JSON.stringify(
			{
				compilerOptions: {
					module: "esnext",
					moduleResolution: "bundler",
					target: "esnext",
					strict: true,
					noEmit: true,
					skipLibCheck: true,
				},
				include: ["consumer.ts"],
			},
			null,
			2,
		)}\n`,
	);
}

function run(command: string[], cwd: string): string {
	const result = Bun.spawnSync(command, {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	if (result.exitCode !== 0) {
		throw new Error(
			`Command failed (${command.join(" ")}):\n${result.stdout.toString()}${result.stderr.toString()}`,
		);
	}
	return result.stdout.toString().trim();
}

async function measure(outputPath: string, rootDir = "."): Promise<void> {
	const root = resolve(rootDir);
	const tsc = join(root, "node_modules/.bin/tsc");
	const version = run([tsc, "--version"], root).replace(/^Version\s+/, "");
	const diagnostics = run(
		[tsc, "--noEmit", "--incremental", "false", "--extendedDiagnostics", "-p", "packages/core"],
		root,
	);
	const report = parseExtendedDiagnostics(diagnostics, version) as TypePerfReport;
	const fixtureRoot = mkdtempSync(join(tmpdir(), "crust-type-perf-"));
	try {
		report.scaling = {} as Record<ScalingSize, TypePerfMetrics | null>;
		for (const size of scalingSizes) {
			const fixtureDir = join(fixtureRoot, String(size));
			generateConsumerFixture(fixtureDir, join(root, "packages/core"), size);
			try {
				const fixtureDiagnostics = run(
					[tsc, "--noEmit", "--incremental", "false", "--extendedDiagnostics", "-p", fixtureDir],
					root,
				);
				report.scaling[size] = parseExtendedDiagnostics(fixtureDiagnostics, version);
			} catch (error) {
				// Fixture compile failure: expected when the PR changed the public API, so
				// head's generated fixture can't compile against base dist. Report "n/a"
				// rather than failing a report-only job.
				console.error(`scaling fixture (size ${size}) failed:\n${error}`);
				report.scaling[size] = null;
			}
		}
		try {
			const editorFixtureDir = join(fixtureRoot, "editor");
			generateConsumerFixture(editorFixtureDir, join(root, "packages/core"), 50);
			report.editor = await measureEditorLatency(editorFixtureDir, tsc);
		} catch (error) {
			// Same policy as scaling fixtures: a report-only job never fails on a
			// fixture/LSP problem, it reports "n/a".
			console.error(`editor latency measurement failed:\n${error}`);
			report.editor = null;
		}
	} finally {
		rmSync(fixtureRoot, { recursive: true, force: true });
	}
	mkdirSync(dirname(resolve(outputPath)), { recursive: true });
	writeFileSync(resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`);
}

if (import.meta.main) {
	const [mode, ...args] = process.argv.slice(2);
	try {
		if (mode === "measure" && args[0]) {
			await measure(args[0], args[1]);
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
