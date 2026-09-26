import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const scalingSizes = [10, 100, 200] as const;
type FixtureApi = "object" | "fluent";

export interface TypePerfReport {
	typescriptVersion: string;
	fixtureApi: FixtureApi;
	instantiations: Record<(typeof scalingSizes)[number], number>;
}

export function parseExtendedDiagnostics(output: string): number {
	const value = output.match(/^Instantiations:\s+(\d+)$/m)?.[1];
	if (value === undefined)
		throw new Error("Missing instantiations in TypeScript extended diagnostics");
	return Number(value);
}

const number = new Intl.NumberFormat("en-US");
const signed = (value: number) =>
	`${value > 0 ? "+" : value < 0 ? "−" : "±"}${number.format(Math.abs(value))}`;
const percentage = (base: number, head: number) =>
	base === 0
		? "n/a"
		: `${head > base ? "+" : head < base ? "−" : "±"}${Math.abs(((head - base) / base) * 100).toFixed(1)}%`;

export function formatComparison(base: TypePerfReport, head: TypePerfReport): string {
	if (base.typescriptVersion !== head.typescriptVersion) {
		throw new Error(
			`TypeScript versions differ: ${base.typescriptVersion} → ${head.typescriptVersion}`,
		);
	}
	return [
		"| Top-level commands | Base instantiations | PR merge instantiations | Δ |",
		"|---:|---:|---:|---:|",
		...scalingSizes.map((size) => {
			const before = base.instantiations[size];
			const after = head.instantiations[size];
			const warn = after > before * 1.1 ? " ⚠️" : "";
			return `| ${size}${warn} | ${number.format(before)} | ${number.format(after)} | ${signed(after - before)} (${percentage(before, after)}) |`;
		}),
		"",
		`TypeScript ${head.typescriptVersion} · \`--checkers 1\` · ⚠️ marks increases above the repository's advisory 10% threshold.`,
		...(base.fixtureApi === head.fixtureApi
			? []
			: [
					"",
					`API transition (${base.fixtureApi} → ${head.fixtureApi}): fixtures use equivalent workloads with each API's context and extension syntax, not identical source.`,
				]),
	].join("\n");
}

/**
 * Generate a deterministic downstream app with `size` top-level sibling commands.
 * Each command has three chained flags and two chained args. Context count is
 * max(3, ceil(size / 10)); every tenth command also owns one nested subcommand.
 * The object dialect supports comparisons across the fluent-extension API transition.
 */
export function generateConsumerSource(size: number, fixtureApi: FixtureApi = "fluent"): string {
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
				`const context${index} = defineContext("context-${index}", { flags: [contextFlag${index}], ${fixtureApi === "fluent" ? "use" : "uses"}: [context${index - 1}] }, async ({ flags, ctx }) => ({ value: (await ctx["context-${index - 1}"]).value + (flags["context-${index}-token"] ?? "") }));`,
			);
		}
	}
	lines.push("");

	for (let index = 0; index < size; index++) {
		const contextIndex = index % contextCount;
		lines.push(
			`const command${index} = defineCommand("command-${index}", { aliases: ["cmd-${index}", "c-${index}"] }, (command) =>`,
			"\tcommand",
			`\t\t.use(context${contextIndex})`,
			`\t\t.flags({ name: "command-${index}-verbose", type: "boolean", short: "v", aliases: ["verbose-${index}"] })`,
			`\t\t.flags({ name: "command-${index}-output", type: "string", short: "o", aliases: ["output-${index}"] })`,
			`\t\t.flags({ name: "command-${index}-force", type: "boolean", short: "f", aliases: ["force-${index}"] })`,
			`\t\t.args({ name: "source-${index}", type: "string", required: true })`,
			`\t\t.args({ name: "destination-${index}", type: "string" })`,
		);
		if (index % 10 === 0) {
			lines.push(
				`\t\t.add(defineCommand("nested-${index}", { aliases: ["n-${index}"] }, (nested) =>`,
				`\t\t\tnested.use(context${contextIndex}).flags({ name: "nested-${index}-mode", type: "string", short: "m", aliases: ["mode-${index}"] }).action(async ({ flags, ctx }) => { void flags["nested-${index}-mode"]; void await ctx["context-${contextIndex}"]; }),`,
				"\t\t))",
			);
		}
		lines.push(
			`\t\t.action(async ({ flags, args, ctx }) => { void flags["command-${index}-output"]; void args["source-${index}"]; void await ctx["context-${contextIndex}"]; }),`,
			");",
			"",
		);
	}

	const extensionCommand =
		'defineCommand("extension-command", { aliases: ["ext"] }, (command) => command.flags({ name: "extension-mode", type: "string" }).action(() => ({ source: "extension" as const })))';
	if (fixtureApi === "fluent") {
		lines.push(
			'const extension = defineExtension(defineExtensionId("type-perf-extension"))',
			'\t.flags({ name: "extension-trace", type: "boolean" })',
			`\t.add(${extensionCommand});`,
		);
	} else {
		lines.push(
			'const extension = defineExtension(defineExtensionId("type-perf-extension"), {',
			'\tflags: [{ name: "extension-trace", type: "boolean" }],',
			`\tcommands: [${extensionCommand}],`,
			"});",
		);
	}
	lines.push(
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
	rootDir: string,
	size: number,
	fixtureApi: FixtureApi = "fluent",
): void {
	const fixtureDir = resolve(outputDir);
	const root = resolve(rootDir);
	mkdirSync(join(fixtureDir, "node_modules/@crustjs"), { recursive: true });
	// core's declarations import @crustjs/utils/*; without it they degrade to `any`.
	for (const name of ["core", "utils"]) {
		symlinkSync(
			join(root, "packages", name),
			join(fixtureDir, `node_modules/@crustjs/${name}`),
			"dir",
		);
	}
	writeFileSync(join(fixtureDir, "consumer.ts"), generateConsumerSource(size, fixtureApi));
	writeFileSync(
		join(fixtureDir, "tsconfig.json"),
		`${JSON.stringify(
			{
				compilerOptions: {
					module: "esnext",
					moduleResolution: "bundler",
					target: "esnext",
					strict: true,
					types: [],
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

function parseTypePerfReport(content: string): TypePerfReport {
	// SAFETY: self-produced by measure()
	return JSON.parse(content) as TypePerfReport;
}

function measure(outputPath: string, rootDir = "."): void {
	const root = resolve(rootDir);
	// Probe the built target API before compilation, never retry a failed fixture.
	const fixtureApi = run(
		[
			process.execPath,
			"--eval",
			`import { defineExtension, defineExtensionId } from ${JSON.stringify(join(root, "packages/core/dist/index.js"))};
console.log(typeof defineExtension(defineExtensionId("type-perf-probe")).flags === "function" ? "fluent" : "object");`,
		],
		root,
	);
	if (fixtureApi !== "fluent" && fixtureApi !== "object") {
		throw new Error(`Unexpected fixture API: ${fixtureApi}`);
	}
	// Both trees use the harness's compiler, even when their lockfiles differ.
	const tsc = resolve(import.meta.dir, "../node_modules/.bin/tsc");
	const version = run([tsc, "--version"], root).replace(/^Version\s+/, "");
	const instantiations: TypePerfReport["instantiations"] = { 10: 0, 100: 0, 200: 0 };
	const fixtureRoot = mkdtempSync(join(tmpdir(), "crust-type-perf-"));
	try {
		for (const size of scalingSizes) {
			const fixtureDir = join(fixtureRoot, String(size));
			generateConsumerFixture(fixtureDir, root, size, fixtureApi);
			const diagnostics = run(
				[
					tsc,
					"--noEmit",
					"--incremental",
					"false",
					"--checkers",
					"1",
					"--extendedDiagnostics",
					"-p",
					fixtureDir,
				],
				root,
			);
			// Failure on either tree invalidates the comparison, including API incompatibility.
			instantiations[size] = parseExtendedDiagnostics(diagnostics);
		}
	} finally {
		rmSync(fixtureRoot, { recursive: true, force: true });
	}
	const report: TypePerfReport = { typescriptVersion: version, fixtureApi, instantiations };
	mkdirSync(dirname(resolve(outputPath)), { recursive: true });
	writeFileSync(resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`);
}

if (import.meta.main) {
	const [mode, ...args] = process.argv.slice(2);
	try {
		if (mode === "measure" && args[0]) {
			measure(args[0], args[1]);
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
