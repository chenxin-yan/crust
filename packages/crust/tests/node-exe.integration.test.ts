import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Crust } from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";
import type { JsonValue } from "@crustjs/utils/json";
import { which } from "@crustjs/utils/process";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

import { buildCommand } from "../src/commands/build.ts";
import type { DistributionManifest } from "../src/distribute.ts";
import { hostTarget, NODE_TARGETS, type NodeTarget, type TargetInfo } from "../src/targets.ts";
import { reapBoundedProcesses, runBoundedProcess } from "./bounded-process.ts";
import { seaNodeBinDir, withPathPrefix } from "./helpers.ts";

// Public `crust build` of Node standalone binaries with the selected external
// Node (see seaNodeBinDir) -> npm pack -> install -> execute: direct binaries
// run from an unrelated directory without Node on PATH after the project's
// node_modules is gone; the npm launcher keeps its own Node prerequisite.
const seaNodeDir = seaNodeBinDir();
const host = hostTarget(NODE_TARGETS);
const consumerNode = which("node");
const npm = which("npm");
const exe = process.platform === "win32" ? ".exe" : "";
const coreDist = fileURLToPath(import.meta.resolve("@crustjs/core"));
const extensionsDist = fileURLToPath(import.meta.resolve("@crustjs/extensions"));

const root = mkdtempSync(join(tmpdir(), "crust-node-exe-"));
const project = join(root, "project");
const stageDir = join(project, ".crust");
const packDir = join(root, "packs");
const consumer = join(root, "consumer");
const elsewhere = join(root, "elsewhere");
const emptyBin = join(root, "empty-bin");
const packageJson = {
	name: "@scope/node-exe",
	version: "0.1.0",
	type: "module",
	bin: { greet: "src/greet.ts", admin: "src/admin.cjs" },
	crust: { runtime: "node", artifact: "binary", include: ["assets"] },
	// The builder Node must satisfy both this range and tsdown's own requirements.
	engines: { node: ">=22" },
	dependencies: { "esm-dep": "1.0.0", "cjs-dep": "1.0.0" },
};
let nodeVersion: string;
let hostBuild: Awaited<ReturnType<typeof crustBuild>>;
let rootTarball: string;
let platformTarball: string;

function writeFile(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content);
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** `crust build` in the project with the selected Node first on PATH. */
async function crustBuild(argv: string[]) {
	const originalCwd = process.cwd;
	process.cwd = () => project;
	try {
		return await withPathPrefix(seaNodeDir!, () =>
			captureExecute(new Crust("test").add(buildCommand), ["build", ...argv]),
		);
	} finally {
		process.cwd = originalCwd;
	}
}

/** A consumer dependency spec: relative with forward slashes, which npm accepts on every OS. */
async function pack(dir: string): Promise<string> {
	// Each command embeds Node; allow time to compress both runtimes on slower CI runners.
	const packed = await runBoundedProcess(npm!, ["pack", dir], { cwd: packDir, timeout: 120_000 });
	expect(packed.exitCode, packed.stderr).toBe(0);
	return `file:../packs/${packed.stdout.trim().split("\n").at(-1)!}`;
}

/** Runs a file with nothing, not even Node, on PATH. */
function runWithoutNode(path: string, args: string[], env: NodeJS.ProcessEnv = {}) {
	return runBoundedProcess(path, args, {
		cwd: elsewhere,
		env: {
			PATH: emptyBin,
			...(process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : {}),
			...env,
		},
		timeout: 20_000,
	});
}

beforeAll(async () => {
	if (seaNodeDir === null || host === null || npm === null) return;
	for (const dir of [packDir, consumer, elsewhere, emptyBin]) mkdirSync(dir, { recursive: true });
	nodeVersion = (
		await runBoundedProcess(join(seaNodeDir, `node${exe}`), ["--version"], { timeout: 10_000 })
	).stdout
		.trim()
		.replace(/^v/, "");
	writeFile(join(project, "package.json"), JSON.stringify(packageJson));
	writeFile(join(project, "assets", "greeting.txt"), "hello from assets\n");
	writeFile(
		join(project, "node_modules", "esm-dep", "package.json"),
		JSON.stringify({ name: "esm-dep", version: "1.0.0", type: "module", exports: "./index.js" }),
	);
	writeFile(join(project, "node_modules", "esm-dep", "index.js"), 'export const mark = "!";\n');
	writeFile(
		join(project, "node_modules", "cjs-dep", "package.json"),
		JSON.stringify({ name: "cjs-dep", version: "1.0.0", main: "index.js" }),
	);
	writeFile(
		join(project, "node_modules", "cjs-dep", "index.js"),
		'const path = require("node:path");\nif (require.main === module) console.log("CJS DEP RAN AS MAIN");\nmodule.exports = { dirnameType: () => typeof __dirname, sep: path.sep };\n',
	);
	writeFile(
		join(project, ".env.build"),
		"PUBLIC_HOST=file.example\nPUBLIC_ORIGIN=https://$PUBLIC_HOST\nPUBLIC_REGION=file\nSECRET_TOKEN=do-not-embed\n",
	);
	// Bun's precedence, then expansion: the later file wins PUBLIC_HOST, the environment PUBLIC_REGION.
	writeFile(join(project, ".env.local"), "PUBLIC_HOST=later.example\n");
	writeFile(
		join(project, "src", "helper.ts"),
		'if (import.meta.main) console.log("HELPER RAN AS MAIN");\nexport const helper = "imported";\n',
	);
	// Real Crust commands: an Extension build hook generates man/, crust.include
	// ships assets/, and both resolve next to the executable.
	writeFile(
		join(project, "src", "greet.ts"),
		`import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Crust, defineExtension, defineExtensionId, resolveArtifactDir } from ${JSON.stringify(coreDist)};
import { help } from ${JSON.stringify(extensionsDist)};
import { mark } from "esm-dep";
import cjs from "cjs-dep";
import { helper } from "./helper.ts";
const man = defineExtension(defineExtensionId("man")).build(() => [{ path: "man/greet.1", content: ".Dd" }]);
// Only this module is main: helper.ts and cjs-dep guard main-only output.
if (import.meta.main) await new Crust("greet", { description: "Greets from a Node binary" })
	.extend(man, help())
	.args({ name: "name", type: "string", required: true })
	.flags({ name: "shout", type: "boolean" })
	.action(async ({ args, flags, stdout, stderr }) => {
		await new Promise((done) => setTimeout(done, 5));
		const greeting = \`hello \${args.name}\${mark}\`;
		stderr("to stderr");
		stdout(JSON.stringify({
			greeting: flags.shout ? greeting.toUpperCase() : greeting,
			node: process.version,
			bun: process.versions.bun ?? null,
			sea: process.getBuiltinModule("node:sea")?.isSea() ?? false,
			origin: process.env.PUBLIC_ORIGIN ?? null,
			region: process.env.PUBLIC_REGION ?? null,
			secret: process.env.SECRET_TOKEN ?? null,
			helper,
			cjs: [cjs.dirnameType(), cjs.sep],
			asset: readFileSync(join(resolveArtifactDir("assets"), "greeting.txt"), "utf8").trim(),
			man: readFileSync(join(resolveArtifactDir("man"), "greet.1"), "utf8"),
		}));
	})
	.execute();
`,
	);
	writeFile(
		join(project, "src", "admin.cjs"),
		`const { Crust } = require(${JSON.stringify(coreDist)});
if (require.main === module) {
	new Crust("admin").action(({ stdout }) => {
		stdout("admin ran");
		process.exitCode = 3;
	}).execute();
}
`,
	);
	writeFile(
		join(project, "src", "missing.ts"),
		'import { nope } from "not-installed";\nconsole.log(nope);\n',
	);

	process.env.PUBLIC_REGION = "environment";
	try {
		hostBuild = await crustBuild([
			"--target",
			"host",
			"--env-file",
			".env.build",
			"--env-file",
			".env.local",
		]);
	} finally {
		delete process.env.PUBLIC_REGION;
	}
	expect(hostBuild.exitCode, hostBuild.stderr).toBe(0);
	const alias = NODE_TARGETS.info[host].alias;
	rootTarball = await pack(join(stageDir, "root"));
	platformTarball = await pack(join(stageDir, alias));
}, 300_000);

afterEach(reapBoundedProcesses);

afterAll(async () => {
	await reapBoundedProcesses();
	rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

describe.skipIf(seaNodeDir === null || host === null || npm === null)(
	"Node standalone binary",
	() => {
		it("stages every command for the host with the selected Node's version", () => {
			const nodePath = join(seaNodeDir!, `node${exe}`);
			expect(hostBuild.stdout).toContain("Runtime: node (from package.json)");
			expect(hostBuild.stdout).toContain("Artifact: binary");
			const compilerLine = `Compiler: node ${nodeVersion} (${nodePath})`;
			if (process.platform === "win32") {
				// PATH lookup can preserve PATHEXT's uppercase .EXE spelling.
				expect(hostBuild.stdout.toLowerCase()).toContain(compilerLine.toLowerCase());
			} else {
				expect(hostBuild.stdout).toContain(compilerLine);
			}
			const { alias, os, cpu, libc }: TargetInfo = NODE_TARGETS.info[host!];
			const bins = { greet: `bin/greet-${host}${exe}`, admin: `bin/admin-${host}${exe}` };
			const manifest = readJson<DistributionManifest>(join(stageDir, "manifest.json"));
			expect(manifest).toMatchObject({
				runtime: "node",
				artifact: "binary",
				embeddedRuntimeVersion: nodeVersion,
				root: { name: "@scope/node-exe", bins: ["greet", "admin"] },
				packages: [
					{
						target: alias,
						name: `@scope/node-exe-${alias}`,
						os,
						cpu,
						...(libc ? { libc } : {}),
						bins,
					},
				],
				publishOrder: [alias, "root"],
			});
			// Command Snapshots ran for both commands (under Bun) before tsdown built them.
			expect(Object.keys(manifest.build ?? {})).toEqual(["greet", "admin"]);

			const rootPackage = readJson<Record<string, JsonValue>>(
				join(stageDir, "root", "package.json"),
			);
			expect(rootPackage).toMatchObject({
				bin: { greet: "bin/greet.js", admin: "bin/admin.js" },
				optionalDependencies: { [`@scope/node-exe-${alias}`]: "0.1.0" },
			});
			// Dependencies are bundled, and engines.node constrained the builder, not the users.
			for (const staged of [
				rootPackage,
				readJson<Record<string, JsonValue>>(join(stageDir, alias, "package.json")),
			]) {
				expect(staged).not.toHaveProperty("dependencies");
				expect(staged).not.toHaveProperty("engines");
			}
			for (const bin of Object.values(bins)) {
				expect(existsSync(join(stageDir, alias, bin))).toBe(true);
			}
			expect(readFileSync(join(stageDir, alias, bins.greet)).includes("do-not-embed")).toBe(false);
		});

		it("provisions every target before staging, keeping the previous stage without an unpacking tool", async () => {
			// A cold tsdown cache forces a real download and unpack of the host
			// target's Node. Linux: tar without xz, as observed on a real host;
			// elsewhere no tar at all, only the selected node.
			const cache = mkdtempSync(join(root, "tsdown-cache-"));
			const tools = mkdtempSync(join(root, "tools-"));
			if (process.platform === "linux") {
				symlinkSync(realpathSync(which("tar")!), join(tools, "tar"));
			}
			writeFileSync(join(stageDir, "kept.txt"), "kept\n");
			const manifest = readFileSync(join(stageDir, "manifest.json"), "utf8");
			const env = {
				PATH: [seaNodeDir, tools].join(delimiter),
				XDG_CACHE_HOME: cache,
				LOCALAPPDATA: cache,
				HOME: cache,
			};
			const saved = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
			const originalCwd = process.cwd;
			Object.assign(process.env, env);
			process.cwd = () => project;
			let result: Awaited<ReturnType<typeof crustBuild>>;
			try {
				result = await captureExecute(new Crust("test").add(buildCommand), [
					"build",
					"--target",
					"host",
					"--no-validate",
				]);
			} finally {
				process.cwd = originalCwd;
				for (const [key, value] of Object.entries(saved)) {
					if (value === undefined) delete process.env[key];
					else process.env[key] = value;
				}
			}
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain(`Could not provision the Node ${nodeVersion} binary`);
			expect(result.stderr).toContain(`${host}: Failed to extract Node.js archive with \`tar\``);
			if (process.platform === "linux") expect(result.stderr).toContain("xz");
			expect(readFileSync(join(stageDir, "kept.txt"), "utf8")).toBe("kept\n");
			expect(readFileSync(join(stageDir, "manifest.json"), "utf8")).toBe(manifest);
			rmSync(join(stageDir, "kept.txt"));
		}, 180_000);

		it("requires Bun, which bundles every command, before staging even without validation", async () => {
			const manifest = readFileSync(join(stageDir, "manifest.json"), "utf8");
			const path = process.env.PATH;
			const originalCwd = process.cwd;
			// The host target's Node is cached by now, so only Bun is missing.
			process.env.PATH = seaNodeDir!;
			process.cwd = () => project;
			let result: Awaited<ReturnType<typeof crustBuild>>;
			try {
				result = await captureExecute(new Crust("test").add(buildCommand), [
					"build",
					"--target",
					"host",
					"--no-validate",
				]);
			} finally {
				process.cwd = originalCwd;
				process.env.PATH = path;
			}
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("bun was not found on PATH.");
			expect(readFileSync(join(stageDir, "manifest.json"), "utf8")).toBe(manifest);
		}, 120_000);

		it("constructs a bounded non-host target embedding the same Node version", async () => {
			// Construction evidence only: this host cannot execute the other architecture.
			const target: NodeTarget =
				process.platform === "win32"
					? "win-arm64"
					: host === "linux-arm64"
						? "linux-x64"
						: "linux-arm64";
			const { alias, os, cpu } = NODE_TARGETS.info[target];
			const result = await crustBuild(["--target", target, "--no-validate"]);
			expect(result.exitCode, result.stderr).toBe(0);
			const manifest = readJson<DistributionManifest>(join(stageDir, "manifest.json"));
			expect(manifest).toMatchObject({
				embeddedRuntimeVersion: nodeVersion,
				packages: [{ target: alias, os, cpu }],
			});
			const binary = readFileSync(join(stageDir, alias, manifest.packages[0]!.bins.admin!));
			if (os === "win32") {
				// PE: "MZ", then the COFF machine after "PE\0\0" (0xAA64 is ARM64).
				const pe = binary.readUInt32LE(0x3c);
				expect(binary.subarray(0, 2).toString()).toBe("MZ");
				expect(binary.readUInt16LE(pe + 4)).toBe(0xaa64);
			} else {
				// ELF e_machine: 62 is x86-64, 183 is AArch64.
				expect(binary.subarray(0, 4).toString("hex")).toBe("7f454c46");
				expect(binary.readUInt16LE(18)).toBe(cpu === "x64" ? 62 : 183);
			}
			expect(binary.includes(`v${nodeVersion}`)).toBe(true);
		}, 240_000);

		it("fails on an import left for the runtime and writes no manifest", async () => {
			writeFile(
				join(project, "package.json"),
				JSON.stringify({ ...packageJson, bin: { ...packageJson.bin, broken: "src/missing.ts" } }),
			);
			try {
				const result = await crustBuild(["--target", "host", "--no-validate"]);
				expect(result.exitCode).toBe(1);
				expect(result.stderr).toContain('Could not resolve: "not-installed"');
			} finally {
				writeFile(join(project, "package.json"), JSON.stringify(packageJson));
			}
			expect(existsSync(join(stageDir, "manifest.json"))).toBe(false);
		}, 120_000);

		it.skipIf(consumerNode === null)(
			"installs with strict engines and runs each command without Node or the project",
			async () => {
				const alias = NODE_TARGETS.info[host!].alias;
				writeFile(
					join(consumer, "package.json"),
					JSON.stringify({
						name: "consumer",
						private: true,
						dependencies: {
							"@scope/node-exe": rootTarball,
							[`@scope/node-exe-${alias}`]: platformTarball,
						},
					}),
				);
				// The consumer's npm and Node, not the builder's: no package demands the embedded version.
				const install = await runBoundedProcess(
					npm!,
					["install", "--engine-strict", "--no-audit", "--no-fund"],
					{ cwd: consumer, timeout: 60_000 },
				);
				expect(install.exitCode, install.stderr).toBe(0);
				// Nothing may resolve from the build machine any more.
				renameSync(join(project, "node_modules"), join(project, "node_modules.moved"));

				const platformDir = join(consumer, "node_modules", "@scope", `node-exe-${alias}`);
				const greetBinary = join(platformDir, "bin", `greet-${host}${exe}`);
				const expected = {
					greeting: "HELLO ADA!",
					node: `v${nodeVersion}`,
					bun: null,
					sea: true,
					origin: "https://later.example",
					region: "environment",
					secret: null,
					helper: "imported",
					cjs: ["string", process.platform === "win32" ? "\\" : "/"],
					asset: "hello from assets",
					man: ".Dd",
				};
				const direct = await runWithoutNode(greetBinary, ["ada", "--shout"]);
				expect(direct.exitCode, direct.stderr).toBe(0);
				expect(direct.stderr.trim()).toBe("to stderr");
				expect(JSON.parse(direct.stdout)).toEqual(expected);

				const help = await runWithoutNode(greetBinary, ["--help"]);
				expect(help.exitCode, help.stderr).toBe(0);
				expect(help.stdout).toContain("Greets from a Node binary");
				const invalid = await runWithoutNode(greetBinary, []);
				expect(invalid.exitCode).toBe(1);
				expect(invalid.stderr).toContain('Missing required argument "<name>"');
				const admin = await runWithoutNode(join(platformDir, "bin", `admin-${host}${exe}`), []);
				expect(admin.stdout.trim()).toBe("admin ran");
				expect(admin.exitCode).toBe(3);

				// Build-only protocol variables cannot turn the finished binary into a snapshot run.
				const snapshotPath = join(root, "snapshot.json");
				const protocol = await runWithoutNode(greetBinary, ["ada"], {
					CRUST_INTERNAL_SNAPSHOT_PATH: snapshotPath,
					CRUST_INTERNAL_BUILD: "0",
					CRUST_INTERNAL_BUILD_OUT_DIR: join(root, "hooks"),
				});
				expect(protocol.exitCode, protocol.stderr).toBe(0);
				expect(JSON.parse(protocol.stdout)).toMatchObject({
					greeting: "hello ada!",
					asset: "hello from assets",
				});
				expect(existsSync(snapshotPath)).toBe(false);
				expect(existsSync(join(root, "hooks"))).toBe(false);

				// The npm launcher runs on the consumer's Node and hands off to the embedded one.
				const launcher = join(consumer, "node_modules", "@scope", "node-exe", "bin", "greet.js");
				const launched = await runBoundedProcess(consumerNode!, [launcher, "ada", "--shout"], {
					cwd: elsewhere,
					timeout: 20_000,
				});
				expect(launched.exitCode, launched.stderr).toBe(0);
				expect(JSON.parse(launched.stdout)).toEqual(expected);
				// ...so the launcher itself is not Node-free.
				if (process.platform !== "win32") {
					const withoutNode = await runWithoutNode(realpathSync(launcher), ["ada"]);
					expect(withoutNode.exitCode).not.toBe(0);
					expect(withoutNode.stdout).not.toContain("hello");
				}
			},
			120_000,
		);
	},
);
