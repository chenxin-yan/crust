import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { which } from "@crustjs/utils/process";
import { describe, expect, it } from "vite-plus/test";

// Every `.extend()` order of {noColor, help, version, didYouMean, a flag handler, a setup,
// a preRun gate, a postRun wrap} must produce the same bytes and exit code. The fixture
// runs all 40320 orders of one argv in a single Bun process; TTY cases run under `script`
// so color detection sees a terminal (stdout and stderr then share the PTY).

const fixture = resolve(import.meta.dirname, "lifecycle-permutations-fixture.ts");
const bun = which("bun")!;
// util-linux `script` syntax; BSD/macOS `script` takes different arguments.
const script = process.platform === "linux" ? which("script") : undefined;

interface Run {
	readonly order: string;
	readonly output: string;
}

/** Split one stream on the fixture's per-order markers. */
function splitRuns(stream: string): Run[] {
	const runs: Run[] = [];
	const pattern = /@@\d+ ([^@]+)@@\r?\n/g;
	let previous: { order: string; start: number } | undefined;
	for (const match of stream.matchAll(pattern)) {
		if (previous)
			runs.push({ order: previous.order, output: stream.slice(previous.start, match.index) });
		previous = { order: match[1]!, start: match.index + match[0].length };
	}
	if (previous) runs.push({ order: previous.order, output: stream.slice(previous.start) });
	return runs;
}

function distinct(runs: readonly Run[]): Map<string, string[]> {
	const outputs = new Map<string, string[]>();
	for (const { order, output } of runs) {
		const orders = outputs.get(output) ?? [];
		orders.push(order);
		outputs.set(output, orders);
	}
	return outputs;
}

/** Each distinct output with one example order and how many orders produced it. */
function summarize(outputs: Map<string, string[]>) {
	return [...outputs].map(([output, orders]) => ({
		output,
		count: orders.length,
		example: orders[0],
	}));
}

function runPiped(argv: readonly string[]) {
	const result = spawnSync(bun, [fixture, JSON.stringify(argv)], {
		encoding: "utf8",
		timeout: 120_000,
		maxBuffer: 256 * 1024 * 1024,
		env: { ...process.env, NO_COLOR: undefined, FORCE_COLOR: undefined },
	});
	expect(result.status, result.stderr).toBe(0);
	return [splitRuns(result.stdout), splitRuns(result.stderr)] as const;
}

function runTty(argv: readonly string[]) {
	const command = [bun, fixture, JSON.stringify(argv)]
		.map((part) => `'${part.replaceAll("'", "'\\''")}'`)
		.join(" ");
	const result = spawnSync(script!, ["-qec", command, "/dev/null"], {
		encoding: "utf8",
		timeout: 120_000,
		maxBuffer: 256 * 1024 * 1024,
		env: { ...process.env, NO_COLOR: undefined, FORCE_COLOR: undefined, TERM: "xterm-256color" },
	});
	expect(result.status, result.stderr).toBe(0);
	// Both streams share the PTY, so each order's marker appears twice: keep every other split.
	return splitRuns(result.stdout).filter((_, index) => index % 2 === 1);
}

const ORDERS = 40320; // 8!
const oneOutput = { output: expect.any(String), count: ORDERS, example: expect.any(String) };

// `gate`: whether the preRun gate runs, which it must exactly when the Command Action runs.
const pipedCases: readonly { argv: readonly string[]; gate: boolean }[] = [
	{ argv: ["--help", "--version"], gate: false },
	{ argv: ["--version", "--help"], gate: false },
	{ argv: ["deploy", "--preview", "--help"], gate: false },
	{ argv: ["deploy", "--help", "--preview"], gate: false },
	{ argv: ["deploy", "--preview"], gate: false },
	{ argv: ["--color", "--help"], gate: false },
	{ argv: ["db", "migrat"], gate: false },
	{ argv: ["db"], gate: false },
	{ argv: ["deploy"], gate: true },
	{ argv: [], gate: true },
];

const ttyCases: readonly (readonly string[])[] = [
	["--help", "--no-color"],
	["--no-color", "--help"],
	["--help"],
];

describe("Extension lifecycle is independent of .extend() order", () => {
	it.each(pipedCases)(
		"piped $argv",
		({ argv, gate }) => {
			const [stdout, stderr] = runPiped(argv);
			expect(stdout).toHaveLength(ORDERS);
			expect(stderr).toHaveLength(ORDERS);
			expect(summarize(distinct(stdout))).toEqual([oneOutput]);
			expect(summarize(distinct(stderr))).toEqual([oneOutput]);
			expect(stderr[0]!.output.includes("[gate] checked")).toBe(gate);
		},
		120_000,
	);

	it.skipIf(!script).each(ttyCases.map((argv) => ({ argv })))(
		"TTY $argv",
		({ argv }) => {
			const runs = runTty(argv);
			expect(runs).toHaveLength(ORDERS);
			expect(summarize(distinct(runs))).toEqual([oneOutput]);
		},
		120_000,
	);
});
