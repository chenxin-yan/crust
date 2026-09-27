import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { build } from "vite-plus/pack";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { which } from "../src/process.ts";

const artifactsModule = resolve(import.meta.dirname, "../src/artifacts.ts");
// `node --build-sea` exists from Node 25.5; run this suite under such a Node to exercise it.
const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
const canBuildSea = process.platform === "linux" && (major > 25 || (major === 25 && minor >= 5));

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "crust-artifacts-runtimes-"));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

/** Writes `<dir>/templates/hello.txt` containing `text`. */
function writeTemplates(dir: string, text: string): void {
	mkdirSync(join(dir, "templates"), { recursive: true });
	writeFileSync(join(dir, "templates", "hello.txt"), text);
}

function run(command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv) {
	const result = spawnSync(command, args, { cwd, env, encoding: "utf8", timeout: 60_000 });
	if (result.error) throw result.error;
	return result;
}

// Reads the resolved artifact's contents so a wrong-but-existing directory cannot pass.
const probeSource = `
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveArtifactDir } from ${JSON.stringify(artifactsModule)};
const dir = resolveArtifactDir("templates");
console.log(JSON.stringify({ dir, text: readFileSync(join(dir, "hello.txt"), "utf8") }));
`;

describe.skipIf(!canBuildSea)("resolveArtifactDir in a Node single executable application", () => {
	it("resolves assets next to the executable despite the crust build marker", async () => {
		writeFileSync(join(root, "probe.ts"), probeSource);
		// Mirror a `crust build` bundle: everything inlined, the build marker defined.
		await build({
			config: false,
			cwd: root,
			entry: { probe: "probe.ts" },
			outDir: "js",
			format: "esm",
			platform: "node",
			dts: false,
			logLevel: "silent",
			define: { "process.env.CRUST_INTERNAL_BUILD": '"1"' },
		});
		const binDir = join(root, "release", "bin");
		mkdirSync(binDir, { recursive: true });
		const executable = join(binDir, "cli");
		writeFileSync(
			join(root, "sea.json"),
			JSON.stringify({
				main: join(root, "js", "probe.mjs"),
				mainFormat: "module",
				output: executable,
				disableExperimentalSEAWarning: true,
			}),
		);
		const seaBuild = run(process.execPath, ["--build-sea", join(root, "sea.json")], root);
		expect(seaBuild.status, seaBuild.stderr).toBe(0);

		writeTemplates(binDir, "adjacent");
		// Decoys for the bundle-relative layout and a conflicting build-only output dir.
		writeTemplates(join(root, "release"), "bundle-relative");
		writeTemplates(join(root, "build-out"), "build-out");
		const linkDir = join(root, "link");
		mkdirSync(linkDir);
		symlinkSync(executable, join(linkDir, "cli"));
		const elsewhere = join(root, "elsewhere");
		mkdirSync(elsewhere);

		for (const invoked of [executable, join(linkDir, "cli")]) {
			const result = run(invoked, [], elsewhere, {
				PATH: "",
				CRUST_INTERNAL_BUILD_OUT_DIR: join(root, "build-out"),
			});
			expect(result.stderr).toBe("");
			expect(result.status).toBe(0);
			expect(JSON.parse(result.stdout)).toEqual({
				dir: join(binDir, "templates"),
				text: "adjacent",
			});
		}
	});
});

// A static `node:sea` import fails to load on runtimes without that built-in.
describe("resolveArtifactDir loads from source on other runtimes", () => {
	for (const [runtime, args] of [
		["bun", ["run"]],
		["deno", ["run", "--allow-read", "--allow-env"]],
	] as const) {
		it.skipIf(!which(runtime))(runtime, () => {
			writeFileSync(join(root, "package.json"), "{}");
			writeFileSync(join(root, "probe.ts"), probeSource);
			writeTemplates(join(root, ".crust", "root"), "source");
			const result = run(runtime, [...args, join(root, "probe.ts")], root);
			expect(result.stderr).toBe("");
			expect(result.status).toBe(0);
			expect(JSON.parse(result.stdout)).toEqual({
				dir: join(root, ".crust", "root", "templates"),
				text: "source",
			});
		});
	}
});
