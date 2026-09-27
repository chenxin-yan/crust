import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { PACKAGED_BUILD_KEY } from "@crustjs/utils/artifacts";
import { which } from "@crustjs/utils/process";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

// ────────────────────────────────────────────────────────────────────────────
// Marker-only core fixture: a wrapper establishes packaged context before
// loading the command graph, independently of Crust's compiler. The tooling
// package tests the production output prelude and import.meta.main behavior.
// This bundle resolves real package exports and runs without env permission
// from an unrelated cwd after its sources are gone.
// ────────────────────────────────────────────────────────────────────────────

const corePkg = resolve(import.meta.dirname, "..");
const utilsPkg = resolve(corePkg, "../utils");
const deno = which("deno");

const ENTRY_SOURCE = `import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Crust } from "@crustjs/core";
import { resolveArtifactDir } from "@crustjs/utils/artifacts";
await new Crust("deno-packaged")
	.action(({ stdout }) => stdout(readFileSync(join(resolveArtifactDir("assets"), "hello.txt"), "utf8")))
	.execute();
`;

// Establish the shared marker contract without depending on the compiler.
const PACKAGED_ENTRY_SOURCE = `globalThis[Symbol.for(${JSON.stringify(PACKAGED_BUILD_KEY)})] = true;
await import("./entry.ts");
`;

let fixtureDir: string;
let sourceDir: string;
let cwd: string;
let snapshotPath: string;
let staleOutDir: string;

/** `deno bundle` → `<fixture>/<name>/bin/cli.js`, with a real asset beside `bin/`. */
function bundle(name: string, entry: string): string {
	const root = join(fixtureDir, name);
	const outfile = join(root, "bin", "cli.js");
	const result = spawnSync(
		deno!,
		["bundle", "--platform=deno", "--node-modules-dir=manual", entry, "--output", outfile],
		// A cold Deno cache downloads the bundler's esbuild once.
		{ cwd: sourceDir, encoding: "utf8", timeout: 120_000 },
	);
	if (result.status !== 0) throw new Error(`deno bundle failed:\n${result.stderr}`);
	mkdirSync(join(root, "assets"));
	writeFileSync(join(root, "assets", "hello.txt"), `${name} asset`);
	return outfile;
}

function run(bundlePath: string, permissions: string[]) {
	const result = spawnSync(deno!, ["run", "--no-prompt", ...permissions, bundlePath], {
		cwd,
		env: {
			...process.env,
			CRUST_INTERNAL_SNAPSHOT_PATH: snapshotPath,
			CRUST_INTERNAL_BUILD_OUT_DIR: staleOutDir,
		},
		encoding: "utf8",
		timeout: 30_000,
	});
	return { stdout: result.stdout, stderr: result.stderr, exitCode: result.status };
}

describe.skipIf(deno === null)("packaged Deno bundle", () => {
	let marked: string;
	let unmarked: string;

	beforeAll(() => {
		// Bundles consume dist: never rebuild an existing dist here, sibling tests
		// import it in parallel. Core dist imports utils dist, so both must exist.
		for (const [pkg, marker] of [
			[utilsPkg, "dist/artifacts.js"],
			[corePkg, "dist/index.js"],
		] as const) {
			if (existsSync(join(pkg, marker))) continue;
			const build = spawnSync("bun", ["run", "build"], { cwd: pkg, timeout: 120_000 });
			if (build.status !== 0) {
				throw new Error(
					`${pkg} build failed:\n${build.stdout.toString()}\n${build.stderr.toString()}`,
				);
			}
		}
		fixtureDir = mkdtempSync(join(tmpdir(), "crust-deno-packaged-"));
		sourceDir = join(fixtureDir, "source");
		cwd = join(fixtureDir, "unrelated-cwd");
		snapshotPath = join(fixtureDir, "snapshot.json");
		staleOutDir = join(fixtureDir, "stale-build-output");
		mkdirSync(join(sourceDir, "node_modules", "@crustjs"), { recursive: true });
		mkdirSync(cwd);
		writeFileSync(
			join(sourceDir, "package.json"),
			JSON.stringify({ name: "deno-packaged", type: "module" }),
		);
		// Junctions need no symlink privilege on Windows; elsewhere the type is ignored.
		symlinkSync(corePkg, join(sourceDir, "node_modules", "@crustjs", "core"), "junction");
		symlinkSync(utilsPkg, join(sourceDir, "node_modules", "@crustjs", "utils"), "junction");
		writeFileSync(join(sourceDir, "entry.ts"), ENTRY_SOURCE);
		writeFileSync(join(sourceDir, "main.js"), PACKAGED_ENTRY_SOURCE);

		marked = bundle("marked", "main.js");
		unmarked = bundle("unmarked", "entry.ts");
		// Installed execution must not reach back into the source checkout.
		rmSync(sourceDir, { recursive: true, force: true });
	}, 240_000);

	afterAll(() => {
		if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
	});

	it("reads installed assets and ignores build-only env without env permission, repeatedly", () => {
		for (let attempt = 0; attempt < 2; attempt++) {
			const { stdout, stderr, exitCode } = run(marked, [
				`--allow-read=${join(fixtureDir, "marked")}`,
			]);
			expect(stderr).toBe("");
			expect(exitCode).toBe(0);
			expect(stdout).toBe("marked asset\n");
		}
		expect(existsSync(snapshotPath)).toBe(false);
		expect(existsSync(staleOutDir)).toBe(false);
	});

	it("reproduces the unmarked regression: it reads build-only env and obeys it", () => {
		const denied = run(unmarked, [`--allow-read=${join(fixtureDir, "unmarked")}`]);
		expect(denied.exitCode).not.toBe(0);
		expect(denied.stderr).toContain('Requires env access to "CRUST_INTERNAL_BUILD"');

		const granted = run(unmarked, ["--allow-env", "--allow-read", `--allow-write=${fixtureDir}`]);
		expect(granted.stderr).toBe("");
		expect(granted.exitCode).toBe(0);
		expect(granted.stdout).toBe("");
		expect(existsSync(snapshotPath)).toBe(true);
	});
});
