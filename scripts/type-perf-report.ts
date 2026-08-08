import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface TypePerfMetrics {
	typescriptVersion: string;
	instantiations: number;
	types: number;
	symbols: number;
	memoryUsedKb: number;
	checkTimeSeconds: number;
	totalTimeSeconds: number;
}

export const scalingSizes = [10, 50, 100] as const;
export type ScalingSize = (typeof scalingSizes)[number];

export interface TypePerfReport extends TypePerfMetrics {
	scaling: Record<ScalingSize, TypePerfMetrics>;
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

export function formatComparison(base: TypePerfReport, head: TypePerfReport): string {
	const warns = {
		instantiations: head.instantiations > base.instantiations * 1.1 ? " ⚠️" : "",
		types: head.types > base.types * 1.1 ? " ⚠️" : "",
	};
	const baseRatio = base.scaling[100].instantiations / base.scaling[10].instantiations;
	const headRatio = head.scaling[100].instantiations / head.scaling[10].instantiations;
	const ratioWarning = headRatio > baseRatio * 1.1 ? " ⚠️" : "";
	return [
		"| Metric | Base | Head | Δ |",
		"|---|---:|---:|---:|",
		`| Instantiations${warns.instantiations} | ${number.format(base.instantiations)} | ${number.format(head.instantiations)} | ${delta(base.instantiations, head.instantiations)} |`,
		`| Types${warns.types} | ${number.format(base.types)} | ${number.format(head.types)} | ${delta(base.types, head.types)} |`,
		`| Check time (informational — noisy on shared runners) | ${base.checkTimeSeconds.toFixed(3)}s | ${head.checkTimeSeconds.toFixed(3)}s | ${delta(base.checkTimeSeconds, head.checkTimeSeconds, 3)} |`,
		"",
		`TypeScript ${head.typescriptVersion} · \`packages/core/tsconfig.json\` · ⚠️ marks compiler-work increases above 10%.`,
		"",
		"### Consumer scaling (synthetic app vs dist)",
		"",
		"| Commands | Base instantiations | Head instantiations | Δ |",
		"|---:|---:|---:|---:|",
		...scalingSizes.map(
			(size) =>
				`| ${size} | ${number.format(base.scaling[size].instantiations)} | ${number.format(head.scaling[size].instantiations)} | ${delta(base.scaling[size].instantiations, head.scaling[size].instantiations)} |`,
		),
		`| 100/10 scaling ratio${ratioWarning} | ${baseRatio.toFixed(2)}× | ${headRatio.toFixed(2)}× | ${delta(baseRatio, headRatio, 2)} |`,
		"",
		"Fixtures consume built `@crustjs/core` declarations. The ratio highlights superlinear growth; ⚠️ appears when it worsens by more than 10%.",
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
				},
				include: ["consumer.ts"],
			},
			null,
			2,
		)}\n`,
	);
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
	const tsc = join(root, "node_modules/.bin/tsc");
	const version = run([tsc, "--version"], root).replace(/^Version\s+/, "");
	const diagnostics = run(
		[tsc, "--noEmit", "--incremental", "false", "--extendedDiagnostics", "-p", "packages/core"],
		root,
	);
	const report = parseExtendedDiagnostics(diagnostics, version) as TypePerfReport;
	const fixtureRoot = mkdtempSync(join(tmpdir(), "crust-type-perf-"));
	try {
		report.scaling = {} as Record<ScalingSize, TypePerfMetrics>;
		for (const size of scalingSizes) {
			const fixtureDir = join(fixtureRoot, String(size));
			generateConsumerFixture(fixtureDir, join(root, "packages/core"), size);
			const fixtureDiagnostics = run(
				[tsc, "--noEmit", "--incremental", "false", "--extendedDiagnostics", "-p", fixtureDir],
				root,
			);
			report.scaling[size] = parseExtendedDiagnostics(fixtureDiagnostics, version);
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
			measure(args[0], args[1]);
		} else if (mode === "generate" && args[0] && args[1]) {
			const root = resolve(args[2] ?? ".");
			generateConsumerFixture(args[1], join(root, "packages/core"), Number(args[0]));
		} else if (mode === "compare" && args.length === 2) {
			const [base, head] = args.map((path) => JSON.parse(readFileSync(path, "utf8")));
			console.log(formatComparison(base, head));
		} else {
			throw new Error(
				"usage: bun scripts/type-perf-report.ts measure <output.json> [rootDir] | generate <size> <outputDir> [rootDir] | compare <base.json> <head.json>",
			);
		}
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	}
}
