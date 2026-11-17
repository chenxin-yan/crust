#!/usr/bin/env node
// Start-up of a CLI built from an OpenAPI spec with `defineApi()`, on the artifacts `crust build`
// ships: a Bun and a Node package, a Bun executable and a Node single executable application, each
// built with the default options for this machine's target. A CLI without the API is the baseline.
//
//   pnpm run build:pkgs
//   node scripts/bench-openapi-startup.mjs [--runs 10] [--out <dir>] <name>=<spec.json> ...
//
// Needs bun, hyperfine, and a Node that `crust build` accepts for executables. For each spec it
// times root `--help`, a generated command's `--help` and a run of it against a local server, and
// `api --list`; the command is the first GET without arguments, in a group when there is one.
// Writes hyperfine's JSON per artifact and prints the medians. Not a CI gate: run it on a quiet
// machine, and on the baseline revision with the same arguments to compare.
import { spawn, spawnSync } from "node:child_process";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { loadavg, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const repo = resolve(import.meta.dirname, "..");
const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: { runs: { type: "string", default: "10" }, out: { type: "string" } },
});
if (positionals.length === 0) {
	console.error(
		"usage: node scripts/bench-openapi-startup.mjs [--runs 10] [--out <dir>] <name>=<spec.json> ...",
	);
	process.exit(2);
}
const out = resolve(values.out ?? mkdtempSync(join(tmpdir(), "crust-openapi-bench-")));
const { defineApi } = await import(join(repo, "packages/openapi/dist/index.js"));

/** Runs a command to completion, failing loudly. */
function run(command, args, cwd) {
	const result = spawnSync(command, args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (result.status !== 0)
		throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr}${result.stdout}`);
	return result.stdout;
}

/** The generated command to time: the first GET without arguments, preferably in a group. */
function pickCommand(specFile) {
	const spec = JSON.parse(readFileSync(specFile, "utf8"));
	const { commands } = defineApi({ spec, baseUrl: "http://127.0.0.1" }).manifest();
	const gets = commands.filter((command) => command.method === "GET" && command.args.length === 0);
	const picked = gets.find((command) => command.command.includes(" ")) ?? gets[0];
	if (picked === undefined) throw new Error(`${specFile} has no GET operation without arguments`);
	return picked.command.split(" ");
}

/** A CLI app below `dir`, built for each artifact type; returns how to start each. */
function buildApp(dir, specFile) {
	mkdirSync(join(dir, "src"), { recursive: true });
	mkdirSync(join(dir, "node_modules", "@crustjs"), { recursive: true });
	for (const name of ["core", "extensions", "openapi"]) {
		symlinkSync(join(repo, "packages", name), join(dir, "node_modules", "@crustjs", name), "dir");
	}
	const api = specFile !== undefined;
	if (api) cpSync(specFile, join(dir, "src", "spec.json"));
	writeFileSync(
		join(dir, "src", "cli.ts"),
		[
			'import { Crust } from "@crustjs/core";',
			'import { help } from "@crustjs/extensions";',
			...(api
				? [
						'import { defineApi } from "@crustjs/openapi";',
						'const acme = defineApi({ spec: new URL("./spec.json", import.meta.url), baseUrl: process.env.BENCH_BASE_URL ?? "http://127.0.0.1:9" });',
						'await new Crust("bench").extend(help(), acme.extension).add(...acme.commands).execute();',
					]
				: ['await new Crust("bench").extend(help()).execute();']),
		].join("\n"),
	);
	const artifacts = {};
	for (const runtime of ["bun", "node"]) {
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({
				name: "bench",
				version: "0.0.0",
				type: "module",
				bin: { bench: "src/cli.ts" },
				crust: { runtime, artifact: "package" },
				dependencies: { "@crustjs/core": "*", "@crustjs/extensions": "*", "@crustjs/openapi": "*" },
			}),
		);
		for (const artifact of ["package", "binary"]) {
			run(
				"bun",
				[
					join(repo, "packages/crust/src/cli.ts"),
					"build",
					"--artifact",
					artifact,
					...(artifact === "binary" ? ["--target", "host"] : []),
				],
				dir,
			);
			const staged = join(dir, `${runtime}-${artifact}`);
			cpSync(join(dir, ".crust"), staged, { recursive: true });
			if (artifact === "package") {
				artifacts[`${runtime} package`] = [runtime, join(staged, "root", "bin", "bench.js")];
			} else {
				const platform = readdirSync(staged).find(
					(entry) => entry !== "root" && entry !== "artifacts" && !entry.includes("."),
				);
				const bin = join(staged, platform, "bin");
				const executable = readdirSync(bin).find((entry) => entry.startsWith("bench"));
				artifacts[`${runtime} executable`] = [join(bin, executable)];
			}
		}
	}
	return artifacts;
}

const server = createServer((request, response) => {
	response.setHeader("content-type", "application/json");
	response.end("[]");
}).listen(0, "127.0.0.1");
await new Promise((done) => server.once("listening", done));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

const apps = [
	["base", undefined],
	...positionals.map((entry) => {
		const at = entry.indexOf("=");
		return [entry.slice(0, at), resolve(entry.slice(at + 1))];
	}),
];
const cases = [];
for (const [name, specFile] of apps) {
	const artifacts = buildApp(join(out, name), specFile);
	const leaf = specFile === undefined ? undefined : pickCommand(specFile);
	for (const [artifact, start] of Object.entries(artifacts)) {
		const timed = [
			["--help"],
			...(leaf === undefined ? [] : [[...leaf, "--help"], leaf, ["api", "--list"]]),
		];
		for (const args of timed)
			cases.push({
				name,
				artifact,
				command: [...start, ...args].map((part) => JSON.stringify(part)).join(" "),
				label: args.join(" "),
			});
	}
}

const revision = run("git", ["rev-parse", "HEAD"], repo).trim();
const loadBefore = loadavg();
const results = join(out, "results.json");
const hyperfine = spawn(
	"hyperfine",
	[
		"-N",
		"--warmup",
		"2",
		"--runs",
		values.runs,
		"--export-json",
		results,
		...cases.map(({ command }) => command),
	],
	{ env: { ...process.env, BENCH_BASE_URL: baseUrl }, stdio: ["ignore", "ignore", "inherit"] },
);
const [status] = await new Promise((done) => hyperfine.once("exit", (...exit) => done(exit)));
server.close();
if (status !== 0) process.exit(1);

const medians = JSON.parse(readFileSync(results, "utf8")).results.map((result) =>
	Math.round((result.summary?.time_wall_clock?.median ?? result.median) * 1000),
);
console.log(
	`revision ${revision}; ${values.runs} runs after 2 warmups (hyperfine -N); load ${loadBefore.map((load) => load.toFixed(2)).join(" ")} before, ${loadavg()
		.map((load) => load.toFixed(2))
		.join(" ")} after`,
);
console.log("| app | artifact | command | median ms |\n| --- | --- | --- | --- |");
for (const [index, { name, artifact, label }] of cases.entries()) {
	console.log(`| ${name} | ${artifact} | \`${label}\` | ${medians[index]} |`);
}
console.log(`\nJSON: ${results}`);
