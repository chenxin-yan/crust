import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

// ────────────────────────────────────────────────────────────────────────────
// Build marker bundle — `crust build` defines `process.env.CRUST_INTERNAL_BUILD`
// as `"1"` in finished Bun/Node bundles. The snapshot subprocess protocol
// serves source entries only, so a finished bundle must compile it out and
// dispatch normally even when the protocol env var is set.
// ────────────────────────────────────────────────────────────────────────────

const corePkg = resolve(import.meta.dirname, "..");
const utilsPkg = resolve(corePkg, "../utils");

const ENTRY_SOURCE = `import { Crust } from ${JSON.stringify(join(corePkg, "dist/index.js"))};
await new Crust("marker-cli").action(({ stdout }) => stdout("action ran")).execute();
`;

let fixtureDir: string;

beforeAll(() => {
	// Bundles consume dist: never rebuild an existing dist here, sibling tests
	// import it in parallel. This fallback only serves a direct `vp test` on a
	// fresh checkout; core dist imports utils dist, so both must exist.
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
	fixtureDir = mkdtempSync(join(tmpdir(), "crust-build-marker-"));
	writeFileSync(join(fixtureDir, "entry.ts"), ENTRY_SOURCE);
});

afterAll(() => rmSync(fixtureDir, { recursive: true, force: true }));

/** Bundles the entry with Bun's bundler (`bun build`, the CLI over `Bun.build`). */
function bundle(name: string, define: Record<string, string> = {}): string {
	const path = join(fixtureDir, `${name}.js`);
	const defines = Object.entries(define).map(([key, value]) => `--define=${key}=${value}`);
	const result = spawnSync(
		"bun",
		[
			"build",
			join(fixtureDir, "entry.ts"),
			"--target=bun",
			"--minify",
			...defines,
			"--outfile",
			path,
		],
		{ encoding: "utf8", timeout: 30_000 },
	);
	if (result.status !== 0) throw new Error(`bundle failed:\n${result.stderr}`);
	return path;
}

function runWithSnapshotEnv(bundlePath: string, snapshotPath: string) {
	const result = spawnSync("bun", [bundlePath], {
		env: { ...process.env, CRUST_INTERNAL_SNAPSHOT_PATH: snapshotPath },
		encoding: "utf8",
		timeout: 30_000,
	});
	return { stdout: result.stdout, stderr: result.stderr, exitCode: result.status };
}

describe("finished Bun/Node bundle with the build marker", () => {
	it("compiles out the snapshot protocol and dispatches the action", () => {
		const bundlePath = bundle("marked", { "process.env.CRUST_INTERNAL_BUILD": '"1"' });
		const text = readFileSync(bundlePath, "utf8");
		expect(text).not.toContain("CRUST_INTERNAL_SNAPSHOT_PATH");
		expect(text).not.toContain("build-report.json");

		const snapshotPath = join(fixtureDir, "marked-snapshot.json");
		const { stdout, stderr, exitCode } = runWithSnapshotEnv(bundlePath, snapshotPath);
		expect(stderr).toBe("");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("action ran");
		expect(existsSync(snapshotPath)).toBe(false);
	});

	it("keeps the snapshot protocol when bundled without the marker", () => {
		const bundlePath = bundle("unmarked");
		const snapshotPath = join(fixtureDir, "unmarked-snapshot.json");
		const { stdout, stderr, exitCode } = runWithSnapshotEnv(bundlePath, snapshotPath);
		expect(stderr).toBe("");
		expect(exitCode).toBe(0);
		expect(stdout).not.toContain("action ran");
		expect(JSON.parse(readFileSync(snapshotPath, "utf8"))).toMatchObject({
			meta: { name: "marker-cli" },
			hasAction: true,
		});
	});
});
