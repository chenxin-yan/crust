import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const fixtures = [
	{ name: "10", size: 10, wideAdd: false, wideContexts: false, wideExtensions: false },
	{ name: "100", size: 100, wideAdd: false, wideContexts: false, wideExtensions: false },
	{ name: "200", size: 200, wideAdd: false, wideContexts: false, wideExtensions: false },
	{ name: "400", size: 400, wideAdd: false, wideContexts: false, wideExtensions: false },
	// Core used to hit TS2589 at ~44 definitions in one `.add(...)` call.
	{ name: "50 in one .add()", size: 50, wideAdd: true, wideContexts: false, wideExtensions: false },
	// Core used to hit TS2589 at ~46 Contexts in one `.provide()`, `.extend()` or `.use()` call.
	{
		name: "60 Contexts in one call",
		size: 10,
		wideAdd: false,
		wideContexts: true,
		wideExtensions: false,
	},
	// Core used to hit TS2589 at ~45 Extensions in one `.extend()` call.
	{
		name: "60 Extensions in one call",
		size: 10,
		wideAdd: false,
		wideContexts: false,
		wideExtensions: true,
	},
] as const;
type FixtureName = (typeof fixtures)[number]["name"];
type FixtureApi = "context-config" | "fluent" | "record-flags";

export interface TypePerfReport {
	typescriptVersion: string;
	fixtureApi: FixtureApi;
	/** `error` is the first TypeScript error code of a fixture measured with `--allow-compile-errors`. */
	instantiations: Record<FixtureName, number | { error: string }>;
	/** Check time in seconds of each fixture that compiled. */
	checkSeconds: Partial<Record<FixtureName, number>>;
}

// A cost that grows quadratically with commands can keep instantiations flat (e.g. relating
// every inferred builder to a structural constraint), so the report also compares how check
// time scales. Absolute times vary by runner; the 400/200 ratio of one run mostly cancels that.
const scalingFixtures = ["200", "400"] as const satisfies readonly FixtureName[];
// Single-run ratios moved about ±3% locally (tsc 7.0.2). A quadratic builder regression moved
// the ratio from 2.3× to 3.1× (+34%) while instantiations stayed within 0.1%.
const scalingTolerance = 1.2;

export function parseExtendedDiagnostics(output: string): number {
	const value = output.match(/^Instantiations:\s+(\d+)$/m)?.[1];
	if (value === undefined)
		throw new Error("Missing instantiations in TypeScript extended diagnostics");
	return Number(value);
}

export function parseCheckSeconds(output: string): number {
	const value = output.match(/^Check time:\s+([\d.]+)s$/m)?.[1];
	if (value === undefined) throw new Error("Missing check time in TypeScript extended diagnostics");
	return Number(value);
}

function checkTimeScaling(report: TypePerfReport): number | undefined {
	const [small, large] = scalingFixtures.map((name) => report.checkSeconds[name]);
	return small && large ? large / small : undefined;
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
	const [baseScaling, headScaling] = [base, head].map(checkTimeScaling);
	const scalingWarn =
		baseScaling !== undefined &&
		headScaling !== undefined &&
		headScaling > baseScaling * scalingTolerance
			? " ⚠️"
			: "";
	const ratio = (value: number | undefined) =>
		value === undefined ? "n/a" : `${value.toFixed(2)}×`;
	return [
		"| Top-level commands | Base instantiations | PR merge instantiations | Δ |",
		"|---:|---:|---:|---:|",
		...fixtures.map(({ name }) => {
			const before = base.instantiations[name];
			const after = head.instantiations[name];
			if (typeof after !== "number") {
				throw new Error(`PR merge fixture ${name} failed to compile: ${after.error}`);
			}
			if (typeof before !== "number") {
				return `| ${name} | n/a (base failed: ${before.error}) | ${number.format(after)} | n/a |`;
			}
			const warn = after > before * 1.1 ? " ⚠️" : "";
			return `| ${name}${warn} | ${number.format(before)} | ${number.format(after)} | ${signed(after - before)} (${percentage(before, after)}) |`;
		}),
		"",
		`Check-time scaling (${scalingFixtures[1]} ÷ ${scalingFixtures[0]} commands)${scalingWarn}: base ${ratio(baseScaling)} · PR merge ${ratio(headScaling)}`,
		"",
		`TypeScript ${head.typescriptVersion} · \`--checkers 1\` · ⚠️ marks instantiation increases above the repository's advisory 10% threshold, or a check-time scaling ratio more than ${Math.round((scalingTolerance - 1) * 100)}% above base: type-check cost growing faster than the command count.`,
		...(base.fixtureApi === head.fixtureApi
			? []
			: [
					"",
					`API transition (${base.fixtureApi} → ${head.fixtureApi}): fixtures use equivalent workloads with each API's Context, Extension, and flag syntax, not identical source.`,
				]),
	].join("\n");
}

/**
 * Generate a deterministic downstream app with `size` top-level sibling commands.
 * Each command has three chained flags and two chained args. Context count is
 * max(3, ceil(size / 10)); every tenth command also owns one nested subcommand.
 * The app adds commands one `.add()` at a time, or all in one call when `wideAdd`
 * is set, then makes five literal typed `app.run(path, { args, flags })` calls
 * and one `app.at(path)` call. `wideContexts` adds 60 Contexts passed in one call each
 * to the app's `.provide()`, a command's `.use()`, and an Extension's `.provide()`
 * that a second app `.extend()`s. `wideExtensions` adds 60 Extensions, each with a flag,
 * a provided Context and a command, that another app passes to one `.extend()` call.
 * The context-config dialect supports comparisons across the fluent-Context API transition, and
 * the fluent dialect across the record-flags transition. The fluent and record-flags dialects
 * emit the same number of `.flags()` calls, so that transition row measures the flag form, not
 * call merging; context-config passes Context flags through its config object instead.
 */
export function generateConsumerSource(
	size: number,
	fixtureApi: FixtureApi = "record-flags",
	wideAdd = false,
	wideContexts = false,
	wideExtensions = false,
): string {
	if (!Number.isInteger(size) || size < 1) throw new Error("size must be a positive integer");
	const contextCount = Math.max(3, Math.ceil(size / 10));
	const records = fixtureApi === "record-flags";
	const flag = (name: string, fields: string) =>
		records ? `{ "${name}": { ${fields} } }` : `{ name: "${name}", ${fields} }`;
	const lines = [
		'import { Crust, defineCommand, defineContext, defineExtension, defineExtensionId, defineFlag } from "@crustjs/core";',
		"",
	];

	const context = (index: number, setup: string, use?: string) =>
		fixtureApi !== "context-config"
			? `defineContext("context-${index}").flags(${records ? `{ "context-${index}-token": contextFlag${index} }` : `contextFlag${index}`})${use ? `.use(${use})` : ""}.setup(${setup})`
			: `defineContext("context-${index}", { flags: [contextFlag${index}]${use ? `, use: [${use}]` : ""} }, ${setup})`;
	for (let index = 0; index < contextCount; index++) {
		lines.push(
			`const contextFlag${index} = defineFlag(${records ? "" : `"context-${index}-token", `}{ type: "string", aliases: ["ctx-${index}-token"] });`,
			`const context${index} = ${
				index === 0
					? context(index, `({ flags }) => ({ value: flags["context-${index}-token"] ?? "" })`)
					: context(
							index,
							`async ({ flags, ctx }) => ({ value: (await ctx["context-${index - 1}"]).value + (flags["context-${index}-token"] ?? "") })`,
							`context${index - 1}`,
						)
			};`,
		);
	}
	lines.push("");

	const valueContext = (name: string, value: number) =>
		fixtureApi !== "context-config"
			? `defineContext("${name}").setup(() => ${value})`
			: `defineContext("${name}", () => ${value})`;
	const wide = Array.from({ length: wideContexts ? 60 : 0 }, (_, index) => `wide${index}`);
	const wideInstances = wide.map((name) => `${name}()`).join(", ");
	if (wideContexts) {
		for (const [index, name] of wide.entries()) {
			lines.push(`const ${name} = ${valueContext(`wide-${index}`, index)};`);
		}
		lines.push(
			`const wideCommand = defineCommand("wide-command", (command) => command.use(${wide.join(", ")}).action(async ({ ctx }) => { void await ctx["wide-59"]; }));`,
			`const wideExtension = defineExtension(defineExtensionId("type-perf-wide-extension")).provide(${wideInstances});`,
			'export const wideApp = new Crust("type-perf-wide").extend(wideExtension).action(async ({ ctx }) => { void await ctx["wide-59"]; });',
			"",
		);
	}

	if (wideExtensions) {
		const extensions = Array.from({ length: 60 }, (_, index) => `wideExtension${index}`);
		for (const [index, name] of extensions.entries()) {
			lines.push(
				`const ${name} = defineExtension(defineExtensionId("type-perf-wide-extension-${index}")).flags(${flag(`wide-extension-${index}`, 'type: "boolean"')}).provide(${valueContext(`wide-extension-${index}`, index)}()).add(defineCommand("wide-extension-command-${index}", (command) => command));`,
			);
		}
		lines.push(
			`export const wideExtensionsApp = new Crust("type-perf-wide-extensions").extend(${extensions.join(", ")}).action(async ({ ctx, flags }) => { void flags["wide-extension-59"]; void await ctx["wide-extension-59"]; });`,
			"",
		);
	}

	for (let index = 0; index < size; index++) {
		const contextIndex = index % contextCount;
		lines.push(
			`const command${index} = defineCommand("command-${index}", { aliases: ["cmd-${index}", "c-${index}"] }, (command) =>`,
			"\tcommand",
			`\t\t.use(context${contextIndex})`,
			`\t\t.flags(${flag(`command-${index}-verbose`, `type: "boolean", short: "v", aliases: ["verbose-${index}"]`)})`,
			`\t\t.flags(${flag(`command-${index}-output`, `type: "string", short: "o", aliases: ["output-${index}"]`)})`,
			`\t\t.flags(${flag(`command-${index}-force`, `type: "boolean", short: "f", aliases: ["force-${index}"]`)})`,
			`\t\t.args({ name: "source-${index}", type: "string", required: true })`,
			`\t\t.args({ name: "destination-${index}", type: "string" })`,
		);
		if (index % 10 === 0) {
			lines.push(
				`\t\t.add(defineCommand("nested-${index}", { aliases: ["n-${index}"] }, (nested) =>`,
				`\t\t\tnested.use(context${contextIndex}).flags(${flag(`nested-${index}-mode`, `type: "string", short: "m", aliases: ["mode-${index}"]`)}).action(async ({ flags, ctx }) => { void flags["nested-${index}-mode"]; void await ctx["context-${contextIndex}"]; }),`,
				"\t\t))",
			);
		}
		lines.push(
			`\t\t.action(async ({ flags, args, ctx }) => { void flags["command-${index}-output"]; void args["source-${index}"]; void await ctx["context-${contextIndex}"]; }),`,
			");",
			"",
		);
	}

	const extensionCommand = `defineCommand("extension-command", { aliases: ["ext"] }, (command) => command.flags(${flag("extension-mode", 'type: "string"')}).action(() => ({ source: "extension" as const })))`;
	lines.push(
		'const extension = defineExtension(defineExtensionId("type-perf-extension"))',
		`\t.flags(${flag("extension-trace", 'type: "boolean"')})`,
		`\t.add(${extensionCommand});`,
	);
	lines.push(
		"",
		'export const app = new Crust("type-perf-consumer", { description: "Synthetic type-performance fixture" })',
		`\t.flags(${flag("root-verbose", 'type: "boolean", short: "v", aliases: ["verbose"]')})`,
		`\t.flags(${flag("root-config", 'type: "string", short: "c", aliases: ["config"]')})`,
		`\t.provide(${Array.from({ length: contextCount }, (_, index) => `context${index}()`).join(", ")})`,
		"\t.extend(extension)",
	);
	if (wideContexts) {
		lines.push(`\t.provide(${wideInstances})`, "\t.add(wideCommand)");
	}
	const commands = Array.from({ length: size }, (_, index) => `command${index}`);
	if (wideAdd) lines.push(`\t.add(${commands.join(", ")})`);
	else for (const command of commands) lines.push(`\t.add(${command})`);
	lines.push("\t.action(() => {});", "");
	for (let call = 0; call < 5; call++) {
		const index = Math.floor((call * size) / 5);
		lines.push(
			`void app.run(["command-${index}"], { args: { "source-${index}": "src" }, flags: { "command-${index}-force": true } });`,
		);
	}
	lines.push('void app.at(["cmd-0", "n-0"]);', "");
	return lines.join("\n");
}

export function generateConsumerFixture(
	outputDir: string,
	rootDir: string,
	size: number,
	fixtureApi: FixtureApi = "record-flags",
	wideAdd = false,
	wideContexts = false,
	wideExtensions = false,
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
	writeFileSync(
		join(fixtureDir, "consumer.ts"),
		generateConsumerSource(size, fixtureApi, wideAdd, wideContexts, wideExtensions),
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

function measure(outputPath: string, rootDir = ".", allowCompileErrors = false): void {
	const root = resolve(rootDir);
	// Probe the built target API before compilation, never retry a failed fixture.
	const fixtureApi = run(
		[
			process.execPath,
			"--eval",
			`import { Crust, defineContext } from ${JSON.stringify(join(root, "packages/core/dist/index.js"))};
let api = "context-config";
// The config-era defineContext(name) throws reading its missing config.
try { if (typeof defineContext("type-perf-probe").setup === "function") api = "fluent"; } catch {}
// A named-only .flags() reads the record as a definition without a name and throws.
if (api === "fluent") try { new Crust("type-perf-probe").flags({ p: { type: "boolean" } }); api = "record-flags"; } catch {}
console.log(api);`,
		],
		root,
	);
	if (fixtureApi !== "fluent" && fixtureApi !== "context-config" && fixtureApi !== "record-flags") {
		throw new Error(`Unexpected fixture API: ${fixtureApi}`);
	}
	// Both trees use the harness's compiler, even when their lockfiles differ.
	const tsc = resolve(import.meta.dir, "../node_modules/.bin/tsc");
	const version = run([tsc, "--version"], root).replace(/^Version\s+/, "");
	// SAFETY: the loop assigns every fixture or throws
	const instantiations = {} as TypePerfReport["instantiations"];
	const checkSeconds: TypePerfReport["checkSeconds"] = {};
	const fixtureRoot = mkdtempSync(join(tmpdir(), "crust-type-perf-"));
	try {
		for (const [
			index,
			{ name, size, wideAdd, wideContexts, wideExtensions },
		] of fixtures.entries()) {
			const fixtureDir = join(fixtureRoot, String(index));
			generateConsumerFixture(
				fixtureDir,
				root,
				size,
				fixtureApi,
				wideAdd,
				wideContexts,
				wideExtensions,
			);
			let diagnostics: string;
			try {
				diagnostics = run(
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
			} catch (error) {
				// A failing PR merge invalidates the comparison; an older base may predate a fixed limit.
				const code = allowCompileErrors ? String(error).match(/error (TS\d+):/)?.[1] : undefined;
				if (code === undefined) throw error;
				instantiations[name] = { error: code };
				continue;
			}
			instantiations[name] = parseExtendedDiagnostics(diagnostics);
			checkSeconds[name] = parseCheckSeconds(diagnostics);
		}
	} finally {
		rmSync(fixtureRoot, { recursive: true, force: true });
	}
	const report: TypePerfReport = {
		typescriptVersion: version,
		fixtureApi,
		instantiations,
		checkSeconds,
	};
	mkdirSync(dirname(resolve(outputPath)), { recursive: true });
	writeFileSync(resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`);
}

if (import.meta.main) {
	const [mode, ...args] = process.argv.slice(2);
	try {
		const allowCompileErrors = args.includes("--allow-compile-errors");
		const positional = args.filter((arg) => arg !== "--allow-compile-errors");
		if (mode === "measure" && positional[0]) {
			measure(positional[0], positional[1], allowCompileErrors);
		} else if (mode === "compare" && args.length === 2) {
			const reports = args.map((path) => parseTypePerfReport(readFileSync(path, "utf8")));
			const base = reports[0];
			const head = reports[1];
			if (!base || !head) throw new Error("compare requires base and head reports");
			console.log(formatComparison(base, head));
		} else {
			throw new Error(
				"usage: bun scripts/type-perf-report.ts measure <output.json> [rootDir] [--allow-compile-errors] | compare <base.json> <head.json>",
			);
		}
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	}
}
