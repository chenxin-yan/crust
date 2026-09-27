import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

import {
	execNodeBinaryBuild,
	hostTarget,
	type NodeBinaryCompiler,
	NODE_TARGETS,
	type NodeTarget,
	resolveNodeBinaryCompiler,
} from "../src/utils/build-helpers.ts";
import { reapBoundedProcesses, runBoundedProcess } from "./bounded-process.ts";
import { seaNodeBinDir, withPathPrefix } from "./helpers.ts";

// Real tsdown executable builds under the selected external Node (see
// seaNodeBinDir), run from an unrelated directory without Node on PATH after
// the project's node_modules is gone.
const seaNodeDir = seaNodeBinDir();
const host = hostTarget(NODE_TARGETS);
const coreDist = fileURLToPath(import.meta.resolve("@crustjs/core"));
const extensionsDist = fileURLToPath(import.meta.resolve("@crustjs/extensions"));

const root = mkdtempSync(join(tmpdir(), "crust-node-exe-"));
const project = join(root, "project");
const outDir = join(root, "out");
const elsewhere = join(root, "elsewhere");
const emptyBin = join(root, "empty-bin");
let compiler: NodeBinaryCompiler;

function writeFile(path: string, content: string): void {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, content);
}

/** Runs a built executable with no Node (or anything else) on PATH. */
function runExecutable(path: string, args: string[], env: NodeJS.ProcessEnv = {}) {
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

function executable(name: string): string {
	return join(outDir, process.platform === "win32" ? `${name}.exe` : name);
}

beforeAll(async () => {
	if (seaNodeDir === null || host === null) return;
	for (const dir of [outDir, elsewhere, emptyBin]) mkdirSync(dir, { recursive: true });
	writeFile(
		join(project, "package.json"),
		JSON.stringify({
			name: "@scope/node-exe",
			version: "0.1.0",
			type: "module",
			engines: { node: ">=26" },
			dependencies: { "esm-dep": "1.0.0", "cjs-dep": "1.0.0" },
		}),
	);
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
		'const path = require("node:path");\nmodule.exports = { dirnameType: () => typeof __dirname, sep: path.sep };\n',
	);
	writeFile(
		join(project, ".env.build"),
		"PUBLIC_ORIGIN=https://file.example\nSECRET_TOKEN=do-not-embed\n",
	);
	writeFile(
		join(project, "src", "greet.ts"),
		`import { Crust } from ${JSON.stringify(coreDist)};
import { help } from ${JSON.stringify(extensionsDist)};
import { mark } from "esm-dep";
import cjs from "cjs-dep";
await new Crust("greet", { description: "Greets from a Node binary" })
	.extend(help())
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
			origin: process.env.PUBLIC_ORIGIN ?? null,
			secret: process.env.SECRET_TOKEN ?? null,
			cjs: [cjs.dirnameType(), cjs.sep],
		}));
	})
	.execute();
`,
	);
	writeFile(
		join(project, "src", "admin.ts"),
		`import { Crust } from ${JSON.stringify(coreDist)};
await new Crust("admin").action(({ stdout }) => {
	stdout("admin ran");
	process.exitCode = 3;
}).execute();
`,
	);
	writeFile(
		join(project, "src", "missing.ts"),
		'import { nope } from "not-installed";\nconsole.log(nope);\n',
	);

	compiler = await withPathPrefix(seaNodeDir, () =>
		resolveNodeBinaryCompiler({ engines: { node: ">=26" } }, project),
	);
	// Each command is its own single-entry tsdown build.
	for (const command of ["greet", "admin"]) {
		await execNodeBinaryBuild(
			join(project, "src", `${command}.ts`),
			executable(command),
			true,
			host,
			[join(project, ".env.build")],
			project,
			compiler,
		);
	}
	// Nothing may resolve from the build machine any more.
	renameSync(join(project, "node_modules"), join(project, "node_modules.moved"));
}, 240_000);

afterEach(reapBoundedProcesses);

afterAll(async () => {
	await reapBoundedProcesses();
	rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

describe.skipIf(seaNodeDir === null || host === null)("execNodeBinaryBuild", () => {
	it("selects the external node and the backend installed with crust", () => {
		expect(compiler.runner.command).toBe(
			join(seaNodeDir!, process.platform === "win32" ? "node.exe" : "node"),
		);
		expect(compiler.backend).toMatchObject({ version: "0.23.0", seaMinVersion: "25.7.0" });
		expect(compiler.backend.packageJsonPath).toContain("node_modules");
	});

	it("runs a real command standalone with its dependencies and the selected Node embedded", async () => {
		const run = await runExecutable(executable("greet"), ["ada", "--shout"]);
		expect(run.exitCode, run.stderr).toBe(0);
		expect(run.stderr.trim()).toBe("to stderr");
		expect(JSON.parse(run.stdout)).toEqual({
			greeting: "HELLO ADA!",
			node: `v${compiler.version}`,
			bun: null,
			origin: "https://file.example",
			secret: null,
			cjs: ["string", process.platform === "win32" ? "\\" : "/"],
		});
		expect(readFileSync(executable("greet")).includes("do-not-embed")).toBe(false);

		const help = await runExecutable(executable("greet"), ["--help"]);
		expect(help.exitCode, help.stderr).toBe(0);
		expect(help.stdout).toContain("Greets from a Node binary");

		const invalid = await runExecutable(executable("greet"), []);
		expect(invalid.exitCode).not.toBe(0);
		expect(invalid.stderr).toContain("name");
	});

	it("builds every command separately", async () => {
		const run = await runExecutable(executable("admin"), []);
		expect(run.stdout.trim()).toBe("admin ran");
		expect(run.exitCode).toBe(3);
	});

	it("ignores a conflicting Command Snapshot path in the finished executable", async () => {
		const snapshotPath = join(root, "snapshot.json");
		const run = await runExecutable(executable("greet"), ["ada"], {
			CRUST_INTERNAL_SNAPSHOT_PATH: snapshotPath,
			CRUST_INTERNAL_BUILD: "0",
		});
		expect(run.exitCode, run.stderr).toBe(0);
		expect(JSON.parse(run.stdout).greeting).toBe("hello ada!");
		expect(existsSync(snapshotPath)).toBe(false);
	});

	it("rejects an import left for the runtime and writes no executable", async () => {
		const outfile = executable("missing");
		await expect(
			execNodeBinaryBuild(
				join(project, "src", "missing.ts"),
				outfile,
				false,
				host!,
				[],
				project,
				compiler,
			),
		).rejects.toThrow(
			"not-installed is imported in app.mjs but is not included in deps.onlyImport",
		);
		expect(existsSync(outfile)).toBe(false);
	}, 60_000);

	it("constructs a non-host Linux target embedding the same Node version", async () => {
		// Construction evidence only: this host cannot execute the other architecture.
		const target: NodeTarget = host === "linux-arm64" ? "linux-x64" : "linux-arm64";
		const outfile = join(outDir, `admin-${target}`);
		await execNodeBinaryBuild(
			join(project, "src", "admin.ts"),
			outfile,
			true,
			target,
			[],
			project,
			compiler,
		);
		const binary = readFileSync(outfile);
		const header = binary.subarray(0, 20);
		expect(header.subarray(0, 4).toString("hex")).toBe("7f454c46");
		// ELF e_machine: 62 is x86-64, 183 is AArch64.
		expect(header.readUInt16LE(18)).toBe(target === "linux-x64" ? 62 : 183);
		expect(binary.includes(`v${compiler.version}`)).toBe(true);
	}, 180_000);
});
