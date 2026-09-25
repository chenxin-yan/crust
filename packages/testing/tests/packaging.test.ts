import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

// ────────────────────────────────────────────────────────────────────────────
// Packed-package isolation — a consumer that installs only the peers each
// entry point declares must be able to import it at runtime and typecheck it
// with `skipLibCheck: false`:
//   `.`              needs @crustjs/core only (no prompts, no progress)
//   `./interactive`  needs @crustjs/core + @crustjs/prompts (no progress)
// plus those peers' own runtime deps (@crustjs/utils, @crustjs/style).
// Real `pnpm pack` tarballs are extracted into a temp dir outside the
// workspace so workspace symlinks cannot mask a missing peer.
// ────────────────────────────────────────────────────────────────────────────

const repoRoot = resolve(import.meta.dirname, "../../..");
const testingPkg = resolve(import.meta.dirname, "..");
const tscBin = join(repoRoot, "node_modules/.bin/tsc");
function packageDir(name: string, from: string): string {
	return dirname(createRequire(import.meta.url).resolve(`${name}/package.json`, { paths: [from] }));
}
// @types/node is only reachable through @types/bun → bun-types in pnpm's
// isolated store, which keeps it beside its undici-types dependency.
const nodeTypes = packageDir(
	"@types/node",
	packageDir("bun-types", packageDir("@types/bun", repoRoot)),
);

const ROOT_CONSUMER = `import { Crust } from "@crustjs/core";
import { captureExecute, type CapturedExecute } from "@crustjs/testing";

const captured: CapturedExecute = await captureExecute(
	new Crust("packed").action(({ stdout }) => stdout("packed-root-ok")),
	[],
);
if (captured.exitCode !== 0 || captured.stdout !== "packed-root-ok") {
	throw new Error(JSON.stringify(captured));
}
console.log("packed-root-ok");
`;

const INTERACTIVE_CONSUMER = `import { Crust } from "@crustjs/core";
import { input } from "@crustjs/prompts";
import { type InteractiveRun, runInteractive } from "@crustjs/testing/interactive";

const run: InteractiveRun = runInteractive(
	new Crust("packed").action(async ({ stderr }) => {
		stderr(\`Hello, \${await input({ message: "Name?" })}!\`);
	}),
	[],
);
await run.waitFor(/Name\\?/);
run.type("Ada");
run.keys("return");
await run.done;
if (!run.screen().includes("Hello, Ada!")) throw new Error(run.screen());
console.log("packed-interactive-ok");
`;

let workRoot: string;
const tarballs = new Map<string, string>();

function pack(name: string): void {
	const result = spawnSync(
		"pnpm",
		["pack", "--ignore-scripts", "--json", "--pack-destination", join(workRoot, "packs")],
		{ cwd: join(repoRoot, "packages", name), timeout: 60_000 },
	);
	if (result.status !== 0) {
		throw new Error(`pnpm pack failed for ${name}:\n${result.stderr.toString()}`);
	}
	tarballs.set(name, JSON.parse(result.stdout.toString()).filename);
}

function createConsumer(label: string, source: string, packages: readonly string[]): string {
	const dir = join(workRoot, label);
	const modules = join(dir, "node_modules");
	for (const name of packages) {
		const dest = join(modules, "@crustjs", name);
		mkdirSync(dest, { recursive: true });
		const untar = spawnSync(
			"tar",
			["-xzf", tarballs.get(name)!, "-C", dest, "--strip-components=1"],
			{ timeout: 30_000 },
		);
		if (untar.status !== 0) throw new Error(`tar failed for ${name}:\n${untar.stderr.toString()}`);
	}
	mkdirSync(join(modules, "@types"), { recursive: true });
	symlinkSync(nodeTypes, join(modules, "@types/node"));
	writeFileSync(join(dir, "consumer.ts"), source);
	writeFileSync(
		join(dir, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: {
				module: "esnext",
				moduleResolution: "bundler",
				target: "esnext",
				lib: ["esnext"],
				types: ["node"],
				strict: true,
				noEmit: true,
				skipLibCheck: false,
			},
			include: ["consumer.ts"],
		}),
	);
	return dir;
}

function expectClean(command: string[], cwd: string, expectedStdout: string): void {
	const [file, ...args] = command;
	const result = spawnSync(file!, args, { cwd, timeout: 60_000 });
	expect(result.stderr.toString()).toBe("");
	expect(result.stdout.toString()).toContain(expectedStdout);
	expect(result.status).toBe(0);
}

beforeAll(() => {
	// Mirrors core's declaration-emission fallback: never rebuild an existing dist
	// (sibling tests import it in parallel); build only on a fresh checkout.
	if (!existsSync(join(testingPkg, "dist/index.d.ts"))) {
		const build = spawnSync("bun", ["run", "build"], { cwd: testingPkg, timeout: 120_000 });
		if (build.status !== 0) {
			throw new Error(
				`testing build failed:\n${build.stdout.toString()}\n${build.stderr.toString()}`,
			);
		}
	}
	workRoot = mkdtempSync(join(tmpdir(), "crust-testing-packed-"));
	mkdirSync(join(workRoot, "packs"));
	for (const name of ["utils", "core", "style", "prompts", "testing"]) pack(name);
});

afterAll(() => {
	rmSync(workRoot, { recursive: true, force: true });
});

describe("packed @crustjs/testing", () => {
	it("root entry runs and typechecks with only @crustjs/core installed", () => {
		const dir = createConsumer("root", ROOT_CONSUMER, ["utils", "core", "testing"]);
		expectClean(["bun", "consumer.ts"], dir, "packed-root-ok");
		expectClean([tscBin, "-p", "."], dir, "");
	});

	it("interactive entry runs and typechecks with core and prompts but no progress", () => {
		const dir = createConsumer("interactive", INTERACTIVE_CONSUMER, [
			"utils",
			"core",
			"style",
			"prompts",
			"testing",
		]);
		expectClean(["bun", "consumer.ts"], dir, "packed-interactive-ok");
		expectClean([tscBin, "-p", "."], dir, "");
	});
});
