import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";

import { Crust } from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";
import { isWithin } from "@crustjs/utils/path";
import { which } from "@crustjs/utils/process";
import { afterAll, afterEach, describe, expect, it } from "vite-plus/test";

import { stageNodeExeDependencies } from "../scripts/stage-node-exe-dependencies.ts";
import { buildCommand } from "../src/commands/build.ts";
import type { DistributionManifest } from "../src/distribute.ts";
import { hostTarget as resolveHostTarget, NODE_TARGETS } from "../src/targets.ts";
import { reapBoundedProcesses, runBoundedProcess } from "./bounded-process.ts";
import { hostTarget, seaNodeBinDir } from "./helpers.ts";

// Proves the Node binary backend travels with Crust's own distribution, not
// the monorepo: a Bun-compiled carrier of the backend code is staged exactly
// like crust (crust build + scripts/stage-node-exe-dependencies.ts), installed
// with CRUST_SMOKE_PM from tarballs, and run from its platform package, where
// the compiled crust runs, to build an application with the selected Node.
const packageManager = process.env.CRUST_SMOKE_PM;
const seaNodeDir = seaNodeBinDir();
const bunHost = hostTarget();
const nodeHost = resolveHostTarget(NODE_TARGETS);
const src = resolve(import.meta.dirname, "..", "src");

const root = mkdtempSync(join(tmpdir(), `crust-node-exe-delivery-${packageManager ?? "skip"}-`));
const carrier = join(root, "carrier");
const app = join(root, "app");
const installDir = join(root, "install");
const packDir = join(root, "packs");
const emptyBin = join(root, "empty-bin");

function writeFile(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content);
}

async function pack(dir: string): Promise<string> {
	const packed = await runBoundedProcess("npm", ["pack", dir], { cwd: packDir, timeout: 25_000 });
	expect(packed.exitCode, packed.stderr).toBe(0);
	return join(packDir, packed.stdout.trim().split("\n").at(-1)!);
}

afterEach(reapBoundedProcesses);

afterAll(async () => {
	await reapBoundedProcesses();
	rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

describe.skipIf(!packageManager || seaNodeDir === null || nodeHost === null)(
	"Node binary backend delivery",
	() => {
		it("builds a Node standalone binary from an installed crust-like distribution", async () => {
			if (!bunHost)
				throw new Error(`No Bun target for this host: ${process.platform}-${process.arch}`);
			for (const command of [packageManager!, "npm", "tar"]) {
				if (!which(command)) throw new Error(`${command} is required for this smoke test.`);
			}
			for (const dir of [packDir, emptyBin]) mkdirSync(dir, { recursive: true });

			writeFile(
				join(carrier, "src", "carrier.ts"),
				`import { join } from "node:path";
import { resolveBunBuildRunner } from ${JSON.stringify(join(src, "compilers.ts"))};
import { execNodeBinaryBuild, resolveNodeBinaryCompiler } from ${JSON.stringify(join(src, "node-exe.ts"))};
import { hostTarget, NODE_TARGETS } from ${JSON.stringify(join(src, "targets.ts"))};
const [project, outfile] = process.argv.slice(2);
const compiler = await resolveNodeBinaryCompiler(undefined, project);
await execNodeBinaryBuild(join(project, "src", "cli.ts"), outfile, true, hostTarget(NODE_TARGETS), [], project, compiler, resolveBunBuildRunner());
console.log(JSON.stringify({ tsdown: compiler.backend.packageJsonPath, node: compiler.version }));
`,
			);
			writeFile(
				join(carrier, "package.json"),
				JSON.stringify({
					name: "@scope/crust-carrier",
					version: "0.0.1",
					bin: { carrier: "src/carrier.ts" },
					crust: { artifact: "binary" },
				}),
			);
			const originalCwd = process.cwd;
			process.cwd = () => carrier;
			try {
				const built = await captureExecute(new Crust("test").add(buildCommand), [
					"build",
					"--target",
					bunHost,
					"--no-validate",
				]);
				expect(built.exitCode, built.stderr).toBe(0);
			} finally {
				process.cwd = originalCwd;
			}
			const stageDir = join(carrier, ".crust");
			stageNodeExeDependencies(stageDir);
			const manifest = JSON.parse(
				readFileSync(join(stageDir, "manifest.json"), "utf8"),
			) as DistributionManifest;
			const platform = manifest.packages[0]!;
			// Optional beside the root's platform packages, never required.
			const backend = { tsdown: "0.23.0", "@tsdown/exe": "0.23.0" };
			const staged = (dir: string) =>
				JSON.parse(readFileSync(join(stageDir, dir, "package.json"), "utf8"));
			expect(staged("root").optionalDependencies).toEqual({
				[platform.name]: manifest.version,
				...backend,
			});
			expect(staged(platform.dir).optionalDependencies).toEqual(backend);
			for (const dir of ["root", platform.dir]) {
				expect(staged(dir)).not.toHaveProperty("dependencies");
			}

			const rootTarball = await pack(join(stageDir, "root"));
			const platformTarball = await pack(join(stageDir, platform.dir));
			writeFile(
				join(installDir, "package.json"),
				JSON.stringify({
					name: "install",
					private: true,
					dependencies: {
						[manifest.root.name]: `file:${rootTarball}`,
						[platform.name]: `file:${platformTarball}`,
					},
				}),
			);
			if (packageManager === "pnpm") {
				// The unpublished platform package must resolve as the root's optional dependency.
				writeFile(
					join(installDir, "pnpm-workspace.yaml"),
					`overrides:\n  ${JSON.stringify(platform.name)}: ${JSON.stringify(`file:${platformTarball}`)}\n`,
				);
			}
			const auditFlags = packageManager === "npm" ? ["--no-audit", "--no-fund"] : [];
			const install = await runBoundedProcess(packageManager!, ["install", ...auditFlags], {
				cwd: installDir,
				timeout: 120_000,
			});
			expect(install.exitCode, install.stderr).toBe(0);

			writeFile(
				join(app, "package.json"),
				JSON.stringify({ name: "app", version: "1.0.0", type: "module" }),
			);
			writeFile(
				join(app, "node_modules", "app-dep", "package.json"),
				JSON.stringify({
					name: "app-dep",
					version: "1.0.0",
					type: "module",
					exports: "./index.js",
				}),
			);
			writeFile(
				join(app, "node_modules", "app-dep", "index.js"),
				'export const dep = "bundled";\n',
			);
			writeFile(
				join(app, "src", "cli.ts"),
				'import { dep } from "app-dep";\nconsole.log(`${dep} ${process.version}`);\n',
			);

			// Only the selected node and tar (for @tsdown/exe's cached download) on
			// PATH, and no NODE_PATH: nothing but the install can supply tsdown,
			// and the carrier's embedded Bun does the Bun bundling.
			const outfile = join(root, process.platform === "win32" ? "app-binary.exe" : "app-binary");
			const launcher = join(installDir, "node_modules", manifest.root.name, "bin", "carrier.js");
			const carried = await runBoundedProcess(
				join(seaNodeDir!, process.platform === "win32" ? "node.exe" : "node"),
				[launcher, app, outfile],
				{
					cwd: root,
					env: {
						PATH: [seaNodeDir, dirname(which("tar")!)].join(delimiter),
						HOME: process.env.HOME,
						USERPROFILE: process.env.USERPROFILE,
						LOCALAPPDATA: process.env.LOCALAPPDATA,
						XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
						SystemRoot: process.env.SystemRoot,
					},
					timeout: 180_000,
				},
			);
			expect(carried.exitCode, carried.stderr).toBe(0);
			const result = JSON.parse(carried.stdout) as { tsdown: string; node: string };
			expect(isWithin(realpathSync(installDir), realpathSync(result.tsdown))).toBe(true);

			rmSync(join(app, "node_modules"), { recursive: true });
			const run = await runBoundedProcess(outfile, [], {
				cwd: emptyBin,
				env: {
					PATH: emptyBin,
					...(process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : {}),
				},
				timeout: 20_000,
			});
			expect(run.exitCode, run.stderr).toBe(0);
			expect(run.stdout.trim()).toBe(`bundled v${result.node}`);
		}, 420_000);
	},
);
