#!/usr/bin/env node
// Start-up of a CLI that uses @crustjs/config, on the package `crust build` ships for Bun and for
// Node, against the same CLI without it, and with a Context written by hand that owns the same flag
// and reads no file: what any Context with a flag costs. A command that does not read the config
// must not pay for loading the store: only `show`, which reads the config, loads it.
//
//   pnpm run build:pkgs
//   node scripts/bench-config-startup.mjs [--runs 80] [--out <dir>]
//
// Needs bun and hyperfine. Times each command of both apps twice, the second time in the reverse
// order, so a drift during the run shows. Prints hyperfine's means and the bundle sizes, and
// writes hyperfine's JSON to the output directory. Not a CI gate: run it on a quiet machine.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { loadavg, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";

const repo = resolve(import.meta.dirname, "..");
const { values } = parseArgs({
	options: { runs: { type: "string", default: "80" }, out: { type: "string" } },
});
const out = resolve(values.out ?? mkdtempSync(join(tmpdir(), "crust-config-bench-")));

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

// The same two commands; `show` reads `org` from its flag, or from the config when there is one.
const SOURCES = {
	without: `import { Crust } from "@crustjs/core";
import { help, version } from "@crustjs/extensions";
await new Crust("bench", { version: "1.0.0" })
	.extend(help(), version())
	.command("ping", (command) => command.action(({ stdout }) => stdout("pong")))
	.command("show", (command) =>
		command
			.flags({ org: { type: "string", env: { name: "BENCH_ORG" } } })
			.action(({ flags, stdout }) => stdout(\`org=\${flags.org}\`)),
	)
	.execute();
`,
	context: `import { Crust, defineContext } from "@crustjs/core";
import { help, version } from "@crustjs/extensions";
const config = defineContext("config")
	.flags({ org: { type: "string", env: { name: "BENCH_ORG" } } })
	.sections({ title: "Configuration", body: "org" })
	.setup(({ flags }) => ({ org: flags.org }));
await new Crust("bench", { version: "1.0.0" })
	.provide(config())
	.extend(help(), version())
	.command("ping", (command) => command.action(({ stdout }) => stdout("pong")))
	.command("show", (command) =>
		command.use(config).action(async ({ ctx, stdout }) => stdout(\`org=\${(await ctx.config).org}\`)),
	)
	.execute();
`,
	config: `import { defineConfig } from "@crustjs/config";
import { Crust } from "@crustjs/core";
import { help, version } from "@crustjs/extensions";
const config = defineConfig({
	name: "bench",
	global: true,
	project: true,
	flags: { org: { type: "string", env: { name: "BENCH_ORG" } } },
});
await new Crust("bench", { version: "1.0.0" })
	.provide(config())
	.extend(help(), version())
	.command("ping", (command) => command.action(({ stdout }) => stdout("pong")))
	.command("show", (command) =>
		command.use(config).action(async ({ ctx, stdout }) => stdout(\`org=\${(await ctx.config).org}\`)),
	)
	.execute();
`,
};

/** The app below `dir`, built as a package for each runtime; returns how to start each and its size. */
function buildApp(dir, source) {
	mkdirSync(join(dir, "src"), { recursive: true });
	mkdirSync(join(dir, "node_modules", "@crustjs"), { recursive: true });
	for (const name of ["config", "core", "extensions"]) {
		symlinkSync(join(repo, "packages", name), join(dir, "node_modules", "@crustjs", name), "dir");
	}
	writeFileSync(join(dir, "src", "cli.ts"), source);
	const builds = {};
	for (const runtime of ["bun", "node"]) {
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({
				name: "bench",
				version: "1.0.0",
				type: "module",
				bin: { bench: "src/cli.ts" },
				crust: { runtime, artifact: "package" },
				dependencies: { "@crustjs/config": "*", "@crustjs/core": "*", "@crustjs/extensions": "*" },
			}),
		);
		run("bun", [join(repo, "packages/crust/src/cli.ts"), "build", "--artifact", "package"], dir);
		const staged = join(dir, runtime);
		cpSync(join(dir, ".crust"), staged, { recursive: true });
		const entry = join(staged, "root", "bin", "bench.js");
		const bundle = readFileSync(entry);
		builds[runtime] = {
			start: [runtime, entry],
			bytes: bundle.length,
			gzip: gzipSync(bundle).length,
		};
	}
	return builds;
}

const apps = Object.fromEntries(
	Object.entries(SOURCES).map(([name, source]) => [name, buildApp(join(out, name), source)]),
);

// No config file anywhere: `show` with the config reads two missing files.
const home = join(out, "home");
mkdirSync(join(home, "xdg"), { recursive: true });
const env = { ...process.env, XDG_CONFIG_HOME: join(home, "xdg"), BENCH_ORG: "acme" };
for (const [name, builds] of Object.entries(apps)) {
	for (const [runtime, { start }] of Object.entries(builds)) {
		for (const [command, expected] of [
			["ping", "pong"],
			["show", "org=acme"],
		]) {
			const result = spawnSync(start[0], [...start.slice(1), command], {
				cwd: home,
				env,
				encoding: "utf8",
			});
			if (result.stdout.trim() !== expected)
				throw new Error(`${name} ${runtime} ${command}: ${result.stdout}${result.stderr}`);
		}
	}
}

const cases = [];
for (const runtime of ["bun", "node"]) {
	for (const command of ["ping", "show"]) {
		for (const name of Object.keys(apps)) {
			const { start } = apps[name][runtime];
			cases.push({
				label: `${runtime} ${command} ${name}`,
				command: [...start, command].map((part) => JSON.stringify(part)).join(" "),
			});
		}
	}
}

/** One hyperfine run of `ordered`; returns each case's mean and standard deviation in ms. */
function time(ordered, file) {
	const results = join(out, file);
	const hyperfine = spawnSync(
		"hyperfine",
		[
			"-N",
			"--warmup",
			"5",
			"--runs",
			values.runs,
			"--export-json",
			results,
			...ordered.map(({ command }) => command),
		],
		{ cwd: home, env, stdio: ["ignore", "ignore", "inherit"] },
	);
	if (hyperfine.status !== 0) process.exit(1);
	const summary = JSON.parse(readFileSync(results, "utf8")).results;
	return new Map(ordered.map(({ label }, index) => [label, summary[index]]));
}

const loadBefore = loadavg();
const forward = time(cases, "forward.json");
const reverse = time(cases.toReversed(), "reverse.json");
const revision = run("git", ["rev-parse", "HEAD"], repo).trim();
const ms = (seconds) => (seconds * 1000).toFixed(1);
console.log(
	`revision ${revision}; ${values.runs} runs after 5 warmups (hyperfine -N), in order then reversed; load ${loadBefore.map((load) => load.toFixed(2)).join(" ")} before, ${loadavg()
		.map((load) => load.toFixed(2))
		.join(" ")} after`,
);
console.log("| runtime | command | app | mean ± σ ms (in order) | mean ± σ ms (reversed) |");
console.log("| --- | --- | --- | --- | --- |");
for (const { label } of cases) {
	const cells = [forward, reverse].map((times) => {
		// hyperfine 1.20 moved the statistics under `summary.time_wall_clock`.
		const result = times.get(label);
		const { mean, stddev } = result.summary?.time_wall_clock ?? result;
		return `${ms(mean)} ± ${ms(stddev)}`;
	});
	console.log(`| ${label.split(" ").join(" | ")} | ${cells.join(" | ")} |`);
}
console.log("\n| runtime | app | bundle bytes | gzip bytes |\n| --- | --- | --- | --- |");
for (const [name, builds] of Object.entries(apps)) {
	for (const [runtime, { bytes, gzip }] of Object.entries(builds)) {
		console.log(`| ${runtime} | ${name} | ${bytes} | ${gzip} |`);
	}
}
console.log(`\nJSON: ${out}`);
