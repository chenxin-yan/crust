// A URL spec in the four artifact types `crust build` makes: the bundle leaves the spec out, and
// each artifact reads the copy the build hook wrote to its data directory.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { which } from "@crustjs/utils/process";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { runBuildHooks } from "../../crust/tests/build-hooks.ts";
import { app } from "./fixtures/built-cli/app.ts";

const fixture = join(import.meta.dirname, "fixtures", "built-cli");
// `node --build-sea` exists from Node 25.5.
const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
const canBuildSea = process.platform === "linux" && (major > 25 || (major === 25 && minor >= 5));
const listed = "GET /users listUsers List the users (built-cli-marker)\n";

let root = "";
let spec = "";

function run(command: string, args: readonly string[], cwd = root) {
	const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 60_000 });
	if (result.error) throw result.error;
	return result;
}

/** `bun build` of the fixture entry as `crust build` runs it: the build marker defined. */
function bundle(outfile: string, ...options: string[]) {
	const result = run("bun", [
		"build",
		join(fixture, "cli.ts"),
		"--define",
		'process.env.CRUST_INTERNAL_BUILD="1"',
		"--outfile",
		outfile,
		...options,
	]);
	expect(result.status, result.stderr).toBe(0);
	return outfile;
}

/** Writes the build hook's spec copy to `dir`'s data directory. */
function shipSpec(dir: string) {
	mkdirSync(join(dir, "openapi"), { recursive: true });
	writeFileSync(join(dir, "openapi", "spec.json"), spec);
}

describe.skipIf(!which("bun"))("a URL spec in a built CLI", () => {
	beforeAll(async () => {
		root = mkdtempSync(join(tmpdir(), "crust-openapi-built-"));
		const { files, error } = await runBuildHooks(app);
		expect(error).toBeUndefined();
		spec = files.get("openapi/spec.json") ?? "";
		expect(JSON.parse(spec)).toMatchObject({ openapi: "3.1.0" });
	});

	afterAll(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it.each([
		["Node", "node", process.execPath],
		["Bun", "bun", "bun"],
	])(
		"runs from a %s bundle that leaves the spec out",
		(_, target, runtime) => {
			const installed = join(root, `${target}-bundle`);
			const entry = bundle(join(installed, "bin", "cli.js"), `--target=${target}`);
			expect(readFileSync(entry, "utf8")).not.toContain("built-cli-marker");

			const missing = run(runtime, [entry, "api", "--list"]);
			expect(missing.status).toBe(1);
			expect(missing.stderr).toBe(
				`Error: api: the OpenAPI document was not found at "${join(installed, "openapi", "spec.json")}". Run \`crust build\` first, and ship its "openapi" directory with the CLI.\n`,
			);

			shipSpec(installed);
			expect(run(runtime, [entry, "api", "--list"])).toMatchObject({ stdout: listed, status: 0 });
		},
		60_000,
	);

	it("runs from a Bun executable with its data directory beside it", () => {
		const executable = bundle(join(root, "bun-exe", "cli"), "--compile");
		shipSpec(dirname(executable));

		expect(run(executable, ["api", "--list"], tmpdir())).toMatchObject({
			stdout: listed,
			stderr: "",
			status: 0,
		});
	}, 60_000);

	it.skipIf(!canBuildSea)(
		"runs from a Node single executable application with its data directory beside it",
		() => {
			const dir = join(root, "node-exe");
			const entry = bundle(join(dir, "cli.mjs"), "--target=node", "--format=esm");
			const executable = join(dir, "bin", "cli");
			mkdirSync(dirname(executable));
			writeFileSync(
				join(dir, "sea.json"),
				JSON.stringify({
					main: entry,
					mainFormat: "module",
					output: executable,
					disableExperimentalSEAWarning: true,
				}),
			);
			const sea = run(process.execPath, ["--build-sea", join(dir, "sea.json")]);
			expect(sea.status, sea.stderr).toBe(0);
			shipSpec(dirname(executable));

			expect(run(executable, ["api", "--list"], tmpdir())).toMatchObject({
				stdout: listed,
				stderr: "",
				status: 0,
			});
		},
		60_000,
	);

	it("reads the pinned file itself from source", () => {
		expect(run("bun", [join(fixture, "cli.ts"), "api", "--list"])).toMatchObject({
			stdout: listed,
			status: 0,
		});
	}, 60_000);
});
