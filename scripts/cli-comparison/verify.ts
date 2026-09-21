import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BuildManifest } from "./build.ts";
import { invalid, valid } from "./cases.ts";
import { exclusions, libraries, targets } from "./catalog.ts";
import { checked, child, fingerprint, here, runtimes, version } from "./support.ts";

const sourceOnly = process.argv.includes("--source-only");
const records: object[] = [];
const failures: string[] = [];
function checkSuite(runtime: string, entry: string, label: string, bundled: boolean, cwd = here) {
	const result = checked(runtime, [join(here, "worker.ts"), "valid", entry], undefined, cwd);
	assert.deepEqual(
		JSON.parse(result.stdout),
		{ valid: valid.length * 4 },
		`${label}: worker output`,
	);
	if (bundled)
		for (const test of valid) {
			const p = checked(runtime, [entry, ...test.argv], undefined, cwd);
			assert.deepEqual(JSON.parse(p.stdout), test.expected, `${label}: startup ${test.name}`);
		}
	for (const test of invalid) {
		const p = bundled
			? child(runtime, [entry, ...test.argv], undefined, cwd)
			: child(runtime, [join(here, "worker.ts"), "once", entry, "1", ...test.argv], undefined, cwd);
		assert.notEqual(p.status, 0, `${label}: accepted ${test.name}: ${p.stdout}`);
		// An invalid invocation must not emit a successful normalized result.
		assert(!p.stdout.includes('"command":'), `${label}: dispatched invalid input ${test.name}`);
	}
	return {
		label,
		validInvocations: valid.length * (bundled ? 5 : 4),
		invalidProcesses: invalid.length,
		status: "passed",
	};
}
for (const runtime of targets) {
	for (const { id } of libraries) {
		const label = `${id}/source/${runtime}`;
		try {
			records.push(checkSuite(runtimes[runtime], join(here, "adapters", `${id}.ts`), label, false));
		} catch (error) {
			failures.push(`${label}: ${String(error)}`);
		}
	}
	const cmd = JSON.parse(checked(runtimes[runtime], [join(here, "probes/cmd-ts.ts")]).stdout);
	assert.equal(cmd.length, 5);
	for (const row of cmd)
		assert.deepEqual(row.result, { _tag: "ok", value: { region: "us-east-1", value: null } });
	const cac = JSON.parse(checked(runtimes[runtime], [join(here, "probes/cac.ts")]).stdout);
	assert.deepEqual(cac, { target: "api", region: 1, tag: ["2"] });
	const citty = JSON.parse(checked(runtimes[runtime], [join(here, "probes/citty.ts")]).stdout);
	assert.equal(citty.tag, "b");
	assert.equal(citty.unknown, true);
	assert.equal(
		checked(runtimes[runtime], [join(here, "probes/sade.ts")]).stdout.trim(),
		"cli, 0.0.0",
	);
	assert.equal(
		checked(runtimes[runtime], [join(here, "probes/gunshi.ts")]).stdout.trim(),
		"unknown",
	);
	records.push({ runtime, probes: "cac/citty/sade/gunshi/cmd-ts limitations reproduced" });
}
let buildHash: string | undefined;
if (!sourceOnly) {
	const raw = readFileSync(join(here, ".generated/build.json"));
	const manifest: BuildManifest = JSON.parse(raw.toString());
	assert.equal(manifest.fingerprint, fingerprint(), "Sources changed: rebuild");
	buildHash = createHash("sha256").update(raw).digest("hex");
	// Bundles copied OUTSIDE the dependency tree: no accidental package/assets fallback.
	const isolated = mkdtempSync(join(tmpdir(), "cli-comparison-"));
	try {
		for (const row of manifest.rows) {
			const data = readFileSync(join(here, row.file));
			assert.equal(createHash("sha256").update(data).digest("hex"), row.sha256);
			const entry = join(isolated, `${row.target}-${row.id}.mjs`);
			copyFileSync(join(here, row.file), entry);
			for (const runtime of targets) {
				const label = `${row.id}/${row.target}-bundle/${runtime}`;
				try {
					records.push(checkSuite(runtimes[runtime], entry, label, true, isolated));
				} catch (error) {
					failures.push(`${label}: ${String(error)}`);
				}
			}
		}
	} finally {
		rmSync(isolated, { recursive: true, force: true });
	}
}
mkdirSync(join(here, ".generated"), { recursive: true });
writeFileSync(
	join(here, ".generated", sourceOnly ? "source-verification.json" : "verification.json"),
	JSON.stringify(
		{
			fingerprint: fingerprint(),
			buildHash,
			runtimeVersions: { bun: version(runtimes.bun), node: version(runtimes.node) },
			at: new Date().toISOString(),
			records,
			exclusions,
			failures,
		},
		null,
		2,
	),
);
if (failures.length) throw new Error(failures.join("\n\n"));
console.log(
	`Conformance passed: ${records.length} suites/probe groups; ${sourceOnly ? "source only" : "source + portable Node-target bundles on BOTH runtimes"}.`,
);
