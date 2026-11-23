import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, beforeAll, expect, it } from "vite-plus/test";

// A project with the shipped package and its dependencies, but no @crustjs/core: core is an
// optional peer that only `@crustjs/prompts/extension` needs. The package is copied, not linked,
// so nothing resolves core from the workspace's node_modules.

const repoRoot = resolve(import.meta.dirname, "../../..");
const promptsPkg = resolve(import.meta.dirname, "..");
const tscBin = join(repoRoot, "node_modules/.bin/tsc");

const MAIN = `import { canPrompt, input } from "@crustjs/prompts";

const answer: Promise<string> = input({ message: "Name?", default: "ada" });
console.log(canPrompt(), await answer);
`;

const EXTENSION = `import { prompts } from "@crustjs/prompts/extension";

console.log(prompts);
`;

let fixtureDir: string;

beforeAll(() => {
	fixtureDir = mkdtempSync(join(tmpdir(), "crust-prompts-without-core-"));
	const scope = join(fixtureDir, "node_modules/@crustjs");
	mkdirSync(join(scope, "prompts"), { recursive: true });
	cpSync(join(promptsPkg, "package.json"), join(scope, "prompts/package.json"));
	cpSync(join(promptsPkg, "dist"), join(scope, "prompts/dist"), { recursive: true });
	for (const name of ["style", "utils"]) {
		symlinkSync(resolve(repoRoot, "packages", name), join(scope, name));
	}
	writeFileSync(join(fixtureDir, "package.json"), JSON.stringify({ type: "module" }));
	writeFileSync(join(fixtureDir, "main.ts"), MAIN);
	writeFileSync(join(fixtureDir, "extension.ts"), EXTENSION);
	const compilerOptions = {
		strict: true,
		target: "esnext",
		module: "esnext",
		moduleResolution: "bundler",
		noEmit: true,
		allowImportingTsExtensions: true,
		skipLibCheck: false,
		typeRoots: [join(repoRoot, "node_modules/@types")],
		types: ["bun"],
	};
	for (const file of ["main", "extension"]) {
		writeFileSync(
			join(fixtureDir, `tsconfig.${file}.json`),
			JSON.stringify({ compilerOptions, files: [`${file}.ts`] }),
		);
	}
});

afterAll(() => rmSync(fixtureDir, { recursive: true, force: true }));

const tsc = (project: string) => {
	const result = spawnSync(tscBin, ["-p", project], { cwd: fixtureDir, timeout: 60_000 });
	return { status: result.status, output: result.stdout.toString() + result.stderr.toString() };
};

it("type-checks the main entry without @crustjs/core", () => {
	expect(tsc("tsconfig.main.json")).toEqual({ status: 0, output: "" });
});

it("runs the main entry without @crustjs/core", () => {
	const result = spawnSync(process.execPath, ["main.ts"], {
		cwd: fixtureDir,
		stdio: ["ignore", "pipe", "pipe"],
		timeout: 30_000,
	});
	expect({ status: result.status, stdout: result.stdout.toString() }).toEqual({
		status: 0,
		stdout: "false ada\n",
	});
});

it("needs @crustjs/core for the extension entry only", () => {
	const result = tsc("tsconfig.extension.json");
	expect(result.status).not.toBe(0);
	expect(result.output).toContain("Cannot find module '@crustjs/core'");
});
