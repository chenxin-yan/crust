import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, freemem, platform, release, totalmem } from "node:os";
import { join } from "node:path";

import type { BuildManifest } from "./build.ts";
import { workload } from "./cases.ts";
import { exclusions, libraries, targets } from "./catalog.ts";
import { checked, fingerprint, here, runtimes, shuffled, stats, version } from "./support.ts";

const quick = process.argv.includes("--quick");
const outIndex = process.argv.indexOf("--out");
const outName = outIndex === -1 ? (quick ? "smoke" : "full") : process.argv[outIndex + 1];
if (
	!outName ||
	!/^[\w.-]+$/.test(outName) ||
	process.argv
		.slice(2)
		.some((arg, i, all) => arg !== "--quick" && arg !== "--out" && all[i - 1] !== "--out")
)
	throw new Error("Usage: bun measure.ts [--quick] [--out <name>]");
const settings = quick
	? {
			warmRounds: 1,
			warmups: 1,
			batches: 2,
			callsPerBatch: 10,
			startupWarmups: 1,
			startupSamples: 3,
		}
	: {
			warmRounds: 3,
			warmups: 3,
			batches: 5,
			callsPerBatch: 300,
			startupWarmups: 2,
			startupSamples: 30,
		};
const orderSeed = 20260920;
const sourceHash = fingerprint();
const rawBuild = readFileSync(join(here, ".generated/build.json"));
const build: BuildManifest = JSON.parse(rawBuild.toString());
const verification = JSON.parse(readFileSync(join(here, ".generated/verification.json"), "utf8"));
assert.equal(build.fingerprint, sourceHash, "Sources changed: rebuild and verify");
assert.equal(verification.fingerprint, sourceHash, "Sources changed: verify");
assert.equal(
	verification.buildHash,
	createHash("sha256").update(rawBuild).digest("hex"),
	"Build changed: verify",
);
assert.deepEqual(verification.failures, [], "Conformance failed");
assert.deepEqual(
	verification.runtimeVersions,
	{ bun: version(runtimes.bun), node: version(runtimes.node) },
	"Runtimes changed: verify again",
);
assert.equal(build.bun, version(runtimes.bun).replace(/^v/, ""), "Bundler runtime changed");
for (const row of build.rows)
	assert.equal(
		createHash("sha256")
			.update(readFileSync(join(here, row.file)))
			.digest("hex"),
		row.sha256,
		"Bundle changed: rebuild and verify",
	);
const lock = join(here, ".generated/measurement.lock");
const fd = openSync(lock, "wx");
closeSync(fd);
try {
	const empty = join(here, ".generated/empty.mjs");
	writeFileSync(empty, "");
	const warm: { runtime: string; id: string; round: number; samplesNs: number[] }[] = [];
	const startup: { runtime: string; id: string; samplesMs: number[] }[] = [];
	const orders: { phase: string; runtime: string; round: number; ids: string[] }[] = [];
	const ids = libraries.map((l) => l.id);
	for (const [runtimeIndex, runtime] of targets.entries()) {
		const executable = runtimes[runtime];
		for (let round = 0; round < settings.warmRounds; round++) {
			const order = shuffled(ids, orderSeed + runtimeIndex * 10_000 + round);
			orders.push({ phase: "warm", runtime, round, ids: order });
			for (const id of order) {
				const entry = join(here, ".generated/bundles/node", `${id}.mjs`);
				const result = JSON.parse(
					checked(
						executable,
						[
							join(here, "worker.ts"),
							"warm",
							entry,
							String(settings.callsPerBatch),
							String(settings.warmups),
							String(settings.batches),
						],
						120_000,
					).stdout,
				);
				assert.equal(result.nsPerInvocation.length, settings.batches);
				warm.push({ runtime, id, round, samplesNs: result.nsPerInvocation });
			}
		}
		const startupIds = [...ids, "empty-process"];
		const samples = new Map<string, number[]>(startupIds.map((id) => [id, []]));
		for (let round = -settings.startupWarmups; round < settings.startupSamples; round++) {
			const order = shuffled(
				startupIds,
				orderSeed + runtimeIndex * 10_000 + 1_000 + round + settings.startupWarmups,
			);
			orders.push({ phase: "startup", runtime, round, ids: order });
			for (const id of order) {
				const args =
					id === "empty-process"
						? [empty]
						: [join(here, ".generated/bundles/node", `${id}.mjs`), ...workload.argv];
				const start = performance.now();
				const result = checked(executable, args);
				const ms = performance.now() - start;
				if (id === "empty-process") assert.equal(result.stdout, "");
				else
					assert.deepEqual(
						JSON.parse(result.stdout),
						workload.expected,
						`startup ${runtime}/${id}`,
					);
				if (round >= 0) samples.get(id)?.push(ms);
			}
		}
		for (const [id, samplesMs] of samples) startup.push({ runtime, id, samplesMs });
	}
	const summary = targets.flatMap((runtime) =>
		libraries.map(({ id }) => ({
			runtime,
			id,
			warmNs: stats(
				warm
					.filter((row) => row.runtime === runtime && row.id === id)
					.flatMap((row) => row.samplesNs),
			),
			startupMs: stats(
				startup.find((row) => row.runtime === runtime && row.id === id)?.samplesMs ?? [],
			),
		})),
	);
	const metadata = {
		at: new Date().toISOString(),
		quick,
		sourceHash,
		settings,
		orderSeed,
		workload,
		dependencyLock: JSON.parse(readFileSync(join(here, "package-lock.json"), "utf8")),
		runtimeVersions: { bun: version(runtimes.bun), node: version(runtimes.node) },
		runtimeExecutables: runtimes,
		parentRuntime: process.versions,
		os: { platform: platform(), release: release(), arch: process.arch },
		cpu: cpus(),
		memory: { total: totalmem(), free: freemem() },
		gitRevision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: here, encoding: "utf8" }).trim(),
		gitStatus: execFileSync("git", ["status", "--short"], { cwd: here, encoding: "utf8" }),
		environment: {
			NO_COLOR: "1",
			FORCE_COLOR: "0",
			TERM: "dumb",
			CI: "1",
			CRUST_variables: "removed",
			NODE_OPTIONS: process.env.NODE_OPTIONS ?? null,
			BUN_OPTIONS: process.env.BUN_OPTIONS ?? null,
		},
		bundler: {
			name: "Bun.build",
			version: build.bun,
			target: "node",
			format: "esm",
			minify: true,
			splitting: false,
			sourcemap: "none",
			packages: "bundle",
			defines: {},
			gzipLevel: 9,
		},
		lifecycle:
			"fresh schema + parse + route + application validation + dispatch + normalized result per invocation; imports excluded from warm",
		warmOverhead:
			"same argv copy, await, JSON.stringify and equality check inside every timed iteration; no stdout inside timer",
		startupScope:
			"OS-cache-warm fresh process lifetime including runtime/import/schema/invoke/JSON stdout/exit; parent spawn overhead included; NOT filesystem cold start",
	};
	mkdirSync(join(here, "results"), { recursive: true });
	const file = join(here, "results", `${outName}.json`);
	writeFileSync(
		file,
		JSON.stringify(
			{ metadata, build, verification, libraries, exclusions, orders, warm, startup, summary },
			null,
			2,
		),
	);
	console.log(file);
} finally {
	rmSync(lock, { force: true });
}
