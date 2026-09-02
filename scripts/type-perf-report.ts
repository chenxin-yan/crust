import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
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
	// null = the LSP session failed (rendered as "n/a").
	editor: EditorLatencyMetrics | null;
}

const metricPatterns = {
	instantiations: /^Instantiations:\s+(\d+)$/m,
	types: /^Types:\s+(\d+)$/m,
	checkTimeSeconds: /^Check time:\s+([\d.]+)s$/m,
} as const;

function parseMetric(output: string, name: keyof typeof metricPatterns): number {
	const value = output.match(metricPatterns[name])?.[1];
	if (value === undefined) throw new Error(`Missing ${name} in TypeScript extended diagnostics`);
	return Number(value);
}

export function parseExtendedDiagnostics(
	output: string,
	typescriptVersion: string,
): TypePerfMetrics {
	return {
		typescriptVersion,
		instantiations: parseMetric(output, "instantiations"),
		types: parseMetric(output, "types"),
		checkTimeSeconds: parseMetric(output, "checkTimeSeconds"),
	};
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

const editorLatencyLabels = [
	["coldCompletionMs", "Cold first completion"],
	["completionMs", "Completion (warm, median)"],
	["hoverMs", "Hover (warm, median)"],
	["editCompletionMs", "Completion after edit (median)"],
] as const satisfies ReadonlyArray<readonly [keyof EditorLatencyMetrics, string]>;

function editorLatencyRows(
	base: EditorLatencyMetrics | null,
	head: EditorLatencyMetrics | null,
): string[] {
	return editorLatencyLabels.map(
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
		// One side can be n/a on its own — an API-breaking PR compiles head's fixture
		// only against head's dist, and head's absolute ratio is still informative.
		`| 100/10 scaling ratio${ratioWarning} | ${baseRatio === null ? "n/a" : `${baseRatio.toFixed(2)}×`} | ${headRatio === null ? "n/a" : `${headRatio.toFixed(2)}×`} | ${baseRatio !== null && headRatio !== null ? delta(baseRatio, headRatio, 2) : "n/a"} |`,
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
 * Whether a core package's built declarations expose the chainable builder
 * `.use()`. The head copy of this script measures both trees (type-perf.yml:
 * "Head's script measures both trees"), so the fixture must speak the API of
 * the dist it compiles against: `.use()` chains on trees that ship it, the
 * removed `uses:` config on older base revisions.
 */
export function distSupportsBuilderUse(corePackageDir: string): boolean {
	const distDir = join(corePackageDir, "dist");
	return readdirSync(distDir).some(
		(file) =>
			file.endsWith(".d.ts") &&
			/\buse<[\s\S]{0,200}?\)\s*:\s*CommandDefinitionBuilder</.test(
				readFileSync(join(distDir, file), "utf8"),
			),
	);
}

/**
 * Generate a deterministic downstream app with `size` top-level sibling commands.
 * Each command has three chained flags and two chained args. Context count is
 * max(3, ceil(size / 10)); every tenth command also owns one nested subcommand.
 */
export function generateConsumerSource(size: number, builderUse = true): string {
	if (!Number.isInteger(size) || size < 1) throw new Error("size must be a positive integer");
	const contextCount = Math.max(3, Math.ceil(size / 10));
	const lines = [
		'import { Crust, defineCommand, defineContext, defineExtension, defineExtensionId, defineFlag } from "@crustjs/core";',
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
				`const context${index} = defineContext("context-${index}", { flags: [contextFlag${index}], uses: [context${index - 1}] }, async ({ flags, ctx }) => ({ value: (await ctx["context-${index - 1}"]).value + (flags["context-${index}-token"] ?? "") }));`,
			);
		}
	}
	lines.push("");

	for (let index = 0; index < size; index++) {
		const contextIndex = index % contextCount;
		const commandConfig = builderUse
			? `{ aliases: ["cmd-${index}", "c-${index}"] }`
			: `{ aliases: ["cmd-${index}", "c-${index}"], uses: [context${contextIndex}] }`;
		lines.push(
			`const command${index} = defineCommand("command-${index}", ${commandConfig}, (command) =>`,
			`\tcommand`,
			...(builderUse ? [`\t\t.use(context${contextIndex})`] : []),
			`\t\t.flags({ name: "command-${index}-verbose", type: "boolean", short: "v", aliases: ["verbose-${index}"] })`,
			`\t\t.flags({ name: "command-${index}-output", type: "string", short: "o", aliases: ["output-${index}"] })`,
			`\t\t.flags({ name: "command-${index}-force", type: "boolean", short: "f", aliases: ["force-${index}"] })`,
			`\t\t.args({ name: "source-${index}", type: "string", required: true })`,
			`\t\t.args({ name: "destination-${index}", type: "string" })`,
		);
		if (index % 10 === 0) {
			const nestedConfig = builderUse
				? `{ aliases: ["n-${index}"] }`
				: `{ aliases: ["n-${index}"], uses: [context${contextIndex}] }`;
			const nestedUse = builderUse ? `.use(context${contextIndex})` : "";
			lines.push(
				`\t\t.add(defineCommand("nested-${index}", ${nestedConfig}, (nested) =>`,
				`\t\t\tnested${nestedUse}.flags({ name: "nested-${index}-mode", type: "string", short: "m", aliases: ["mode-${index}"] }).action(async ({ flags, ctx }) => { void flags["nested-${index}-mode"]; void await ctx["context-${contextIndex}"]; }),`,
				"\t\t))",
			);
		}
		lines.push(
			`\t\t.action(async ({ flags, args, ctx }) => { void flags["command-${index}-output"]; void args["source-${index}"]; void await ctx["context-${contextIndex}"]; }),`,
			");",
			"",
		);
	}

	lines.push(
		'const extension = defineExtension(defineExtensionId("type-perf-extension"), {',
		'\tflags: [{ name: "extension-trace", type: "boolean" }],',
		'\tcommands: [defineCommand("extension-command", { aliases: ["ext"] }, (command) => command.flags({ name: "extension-mode", type: "string" }).action(() => ({ source: "extension" as const })))],',
		"});",
		"",
		'export const app = new Crust("type-perf-consumer", { description: "Synthetic type-performance fixture" })',
		'\t.flags({ name: "root-verbose", type: "boolean", short: "v", aliases: ["verbose"] })',
		'\t.flags({ name: "root-config", type: "string", short: "c", aliases: ["config"] })',
		`\t.provide(${Array.from({ length: contextCount }, (_, index) => `context${index}()`).join(", ")})`,
		"\t.extend(extension)",
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
	writeFileSync(
		join(fixtureDir, "consumer.ts"),
		generateConsumerSource(size, distSupportsBuilderUse(packageDir)),
	);
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

function isTypePerfMetrics<Value>(value: Value): value is Value & TypePerfMetrics {
	return (
		typeof value === "object" &&
		value !== null &&
		"typescriptVersion" in value &&
		typeof value.typescriptVersion === "string" &&
		"instantiations" in value &&
		typeof value.instantiations === "number" &&
		"types" in value &&
		typeof value.types === "number" &&
		"checkTimeSeconds" in value &&
		typeof value.checkTimeSeconds === "number"
	);
}

function isEditorLatencyMetrics<Value>(value: Value): value is Value & EditorLatencyMetrics {
	return (
		typeof value === "object" &&
		value !== null &&
		"coldCompletionMs" in value &&
		typeof value.coldCompletionMs === "number" &&
		"completionMs" in value &&
		typeof value.completionMs === "number" &&
		"hoverMs" in value &&
		typeof value.hoverMs === "number" &&
		"editCompletionMs" in value &&
		typeof value.editCompletionMs === "number"
	);
}

function isTypePerfReport<Value>(value: Value): value is Value & TypePerfReport {
	if (!isTypePerfMetrics(value) || !("scaling" in value) || !("editor" in value)) return false;
	const scaling = value.scaling;
	return (
		typeof scaling === "object" &&
		scaling !== null &&
		"10" in scaling &&
		(scaling[10] === null || isTypePerfMetrics(scaling[10])) &&
		"50" in scaling &&
		(scaling[50] === null || isTypePerfMetrics(scaling[50])) &&
		"100" in scaling &&
		(scaling[100] === null || isTypePerfMetrics(scaling[100])) &&
		(value.editor === null || isEditorLatencyMetrics(value.editor))
	);
}

function parseTypePerfReport(content: string): TypePerfReport {
	const parsed: unknown = JSON.parse(content);
	if (!isTypePerfReport(parsed)) throw new Error("Invalid type-performance report JSON");
	return parsed;
}

async function measure(outputPath: string, rootDir = "."): Promise<void> {
	const root = resolve(rootDir);
	const tsc = join(root, "node_modules/.bin/tsc");
	const version = run([tsc, "--version"], root).replace(/^Version\s+/, "");
	const diagnostics = run(
		[tsc, "--noEmit", "--incremental", "false", "--extendedDiagnostics", "-p", "packages/core"],
		root,
	);
	const metrics = parseExtendedDiagnostics(diagnostics, version);
	const scaling: TypePerfReport["scaling"] = { 10: null, 50: null, 100: null };
	let editor: EditorLatencyMetrics | null = null;
	const fixtureRoot = mkdtempSync(join(tmpdir(), "crust-type-perf-"));
	try {
		for (const size of scalingSizes) {
			const fixtureDir = join(fixtureRoot, String(size));
			try {
				// Inside the catch so fixture *generation* failures (e.g. missing dist
				// during the .use() probe) follow the same n/a policy as compile failures.
				generateConsumerFixture(fixtureDir, join(root, "packages/core"), size);
				const fixtureDiagnostics = run(
					[tsc, "--noEmit", "--incremental", "false", "--extendedDiagnostics", "-p", fixtureDir],
					root,
				);
				scaling[size] = parseExtendedDiagnostics(fixtureDiagnostics, version);
			} catch (error) {
				// Fixture compile failure: expected when the PR changed the public API, so
				// head's generated fixture can't compile against base dist. Report "n/a"
				// rather than failing a report-only job.
				console.error(`scaling fixture (size ${size}) failed:\n${error}`);
			}
		}
		try {
			const editorFixtureDir = join(fixtureRoot, "editor");
			generateConsumerFixture(editorFixtureDir, join(root, "packages/core"), 50);
			editor = await measureEditorLatency(editorFixtureDir, tsc);
		} catch (error) {
			// Same policy as scaling fixtures: a report-only job never fails on a
			// fixture/LSP problem, it reports "n/a".
			console.error(`editor latency measurement failed:\n${error}`);
		}
	} finally {
		rmSync(fixtureRoot, { recursive: true, force: true });
	}
	const report: TypePerfReport = { ...metrics, scaling, editor };
	mkdirSync(dirname(resolve(outputPath)), { recursive: true });
	writeFileSync(resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`);
}

if (import.meta.main) {
	const [mode, ...args] = process.argv.slice(2);
	try {
		if (mode === "measure" && args[0]) {
			await measure(args[0], args[1]);
		} else if (mode === "compare" && args.length === 2) {
			const reports = args.map((path) => parseTypePerfReport(readFileSync(path, "utf8")));
			const base = reports[0];
			const head = reports[1];
			if (!base || !head) throw new Error("compare requires base and head reports");
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
