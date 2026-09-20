import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// ────────────────────────────────────────────────────────────────────────────
// Build marker bundle — `crust build` defines `process.env.CRUST_INTERNAL_BUILD`
// as `"1"` in finished Bun/Node bundles. The snapshot subprocess protocol
// serves source entries only, so a finished bundle must compile it out and
// dispatch normally even when the protocol env var is set.
// ────────────────────────────────────────────────────────────────────────────

const corePkg = resolve(import.meta.dir, "..");
const utilsPkg = resolve(corePkg, "../utils");

const ENTRY_SOURCE = `import { Crust } from ${JSON.stringify(join(corePkg, "dist/index.js"))};
await new Crust("marker-cli").action(({ stdout }) => stdout("action ran")).execute();
`;

let fixtureDir: string;

beforeAll(() => {
	// Bundles consume dist: never rebuild an existing dist here, sibling tests
	// import it in parallel. This fallback only serves a direct `bun test` on a
	// fresh checkout; core dist imports utils dist, so both must exist.
	for (const [pkg, marker] of [
		[utilsPkg, "dist/artifacts.js"],
		[corePkg, "dist/index.js"],
	] as const) {
		if (existsSync(join(pkg, marker))) continue;
		const build = Bun.spawnSync(["bun", "run", "build"], { cwd: pkg });
		if (build.exitCode !== 0) {
			throw new Error(
				`${pkg} build failed:\n${build.stdout.toString()}\n${build.stderr.toString()}`,
			);
		}
	}
	fixtureDir = mkdtempSync(join(tmpdir(), "crust-build-marker-"));
	writeFileSync(join(fixtureDir, "entry.ts"), ENTRY_SOURCE);
});

afterAll(() => rmSync(fixtureDir, { recursive: true, force: true }));

async function bundle(name: string, define?: Record<string, string>): Promise<string> {
	const result = await Bun.build({
		entrypoints: [join(fixtureDir, "entry.ts")],
		target: "bun",
		minify: true,
		define,
	});
	if (!result.success) throw new AggregateError(result.logs, "bundle failed");
	const path = join(fixtureDir, `${name}.js`);
	writeFileSync(path, await result.outputs[0]!.text());
	return path;
}

async function runWithSnapshotEnv(bundlePath: string, snapshotPath: string) {
	const proc = Bun.spawn([process.execPath, bundlePath], {
		env: { ...process.env, CRUST_INTERNAL_SNAPSHOT_PATH: snapshotPath },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { stdout, stderr, exitCode };
}

describe("finished Bun/Node bundle with the build marker", () => {
	it("compiles out the snapshot protocol and dispatches the action", async () => {
		const bundlePath = await bundle("marked", { "process.env.CRUST_INTERNAL_BUILD": '"1"' });
		const text = await Bun.file(bundlePath).text();
		expect(text).not.toContain("CRUST_INTERNAL_SNAPSHOT_PATH");
		expect(text).not.toContain("build-report.json");

		const snapshotPath = join(fixtureDir, "marked-snapshot.json");
		const { stdout, stderr, exitCode } = await runWithSnapshotEnv(bundlePath, snapshotPath);
		expect(stderr).toBe("");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("action ran");
		expect(existsSync(snapshotPath)).toBe(false);
	});

	it("keeps the snapshot protocol when bundled without the marker", async () => {
		const bundlePath = await bundle("unmarked");
		const snapshotPath = join(fixtureDir, "unmarked-snapshot.json");
		const { stdout, stderr, exitCode } = await runWithSnapshotEnv(bundlePath, snapshotPath);
		expect(stderr).toBe("");
		expect(exitCode).toBe(0);
		expect(stdout).not.toContain("action ran");
		expect(JSON.parse(await Bun.file(snapshotPath).text())).toMatchObject({
			meta: { name: "marker-cli" },
			hasAction: true,
		});
	});
});
