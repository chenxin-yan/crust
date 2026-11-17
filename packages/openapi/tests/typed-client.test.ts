/**
 * @module-tag network
 */
// The typed client end to end: the fixture installs inspex and TypeScript 7.1 (its own dev
// dependencies; the repository keeps its TypeScript), whose content mapper registers
// acme.openapi.jsonc in `Specs`, so `call()` is typed with no import and no type argument.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { which } from "@crustjs/utils/process";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

const packages = resolve(import.meta.dirname, "..", "..");
const fixture = join(import.meta.dirname, "fixtures", "typed-client");
// The repository's TypeScript, which runs no content mapper.
const repoTsc = join(import.meta.dirname, "..", "node_modules", "typescript", "bin", "tsc");

let project = "";

function run(command: string, args: readonly string[]) {
	const result = spawnSync(command, args, { cwd: project, encoding: "utf8", timeout: 120_000 });
	if (result.error) throw result.error;
	return result;
}

/** `file(line): error TSxxxx` for each error tsc printed. */
function errors(output: string): string[] {
	return [...output.matchAll(/^(\S+)\((\d+),\d+\): error (TS\d+)/gm)].map(
		([, file, line, code]) => `${file}(${line}): ${code}`,
	);
}

describe("call() typed by the inspex content mapper", () => {
	beforeAll(() => {
		const npm = which("npm");
		if (!npm)
			throw new Error("npm is required to install the fixture's TypeScript 7.1 and inspex.");
		// Outside the workspace, so no workspace tsconfig or node_modules is picked up.
		project = mkdtempSync(join(tmpdir(), "crust-openapi-typed-"));
		cpSync(fixture, project, { recursive: true });
		const install = run(npm, ["install", "--no-audit", "--no-fund", "--ignore-scripts"]);
		expect(install.status, install.stderr).toBe(0);
		// The workspace packages as installed: their built declarations.
		mkdirSync(join(project, "node_modules", "@crustjs"));
		for (const name of ["core", "openapi"]) {
			symlinkSync(
				join(packages, name),
				join(project, "node_modules", "@crustjs", name),
				"junction",
			);
		}
	}, 180_000);

	afterAll(() => {
		if (project !== "") rmSync(project, { recursive: true, force: true });
	});

	it("types ids, inputs and results, and reports each wrong use where it is", () => {
		const tsc = join("node_modules", "typescript", "bin", "tsc");
		const result = run(process.execPath, [tsc, "--noEmit", "--runExternalCode"]);
		const lines = readFileSync(join(project, "src", "errors.ts"), "utf8").split("\n");
		const marked = lines.flatMap((line, index) =>
			line.includes("// error:") ? [`src/errors.ts(${index + 1})`] : [],
		);

		expect(errors(result.stdout).map((error) => error.replace(/: TS\d+$/, ""))).toEqual(marked);
		expect(errors(result.stdout).map((error) => error.split(": ")[1])).toEqual([
			// An unknown id is a readable argument error, not TS2589 (excessively deep).
			"TS2345",
			// "Did you mean 'expand'?"
			"TS2561",
			"TS2353",
			"TS2339",
		]);
		expect(result.stdout).not.toContain("TS2589");
	}, 120_000);

	it("compiles the calls untyped on the repository's TypeScript, where results are unknown", () => {
		const untyped = run(process.execPath, [repoTsc, "--noEmit", "-p", "."]);

		// Calls compile; only reading a result field needs the mapper.
		expect(errors(untyped.stdout)).toEqual([
			"src/errors.ts(13): TS18046",
			"src/typed.ts(10): TS18046",
			"src/typed.ts(12): TS18046",
		]);
	}, 120_000);
});
