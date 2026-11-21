import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

import { Crust, defineCommand } from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";
import { describe, expect, it, vi } from "vite-plus/test";

import { help } from "./help.ts";
import { schema } from "./schema.ts";
import { search } from "./search.ts";
import { telemetry } from "./telemetry.ts";

const state = vi.hoisted(() => ({ rankingLoaded: false, storeLoaded: false }));
// search() ranks commands only when `search` runs; registering it must not load the ranking.
vi.mock("@crustjs/utils/search", async (importOriginal) => {
	state.rankingLoaded = true;
	return importOriginal();
});
// telemetry() reads its saved setting only when a variable does not decide, or its command runs.
vi.mock("@crustjs/store", async (importOriginal) => {
	state.storeLoaded = true;
	return importOriginal();
});

const srcDir = import.meta.dirname;

/** Value (non-type) static import specifiers and dynamic import() specifiers of one module. */
function importsOf(file: string): { static: string[]; dynamic: string[] } {
	const source = readFileSync(file, "utf8");
	const statics: string[] = [];
	for (const match of source.matchAll(
		/^(?:import|export)\s+(type\s+)?(?:(\{[^}]*\}|[\w*\s,{}]+?)\s+from\s+)?["']([^"']+)["']/gm,
	)) {
		const [, typeOnly, clause, specifier] = match;
		if (typeOnly) continue;
		// `import { type A, type B } from` is erased like `import type`.
		const names = clause
			?.match(/^\{([^}]*)\}$/)?.[1]
			?.split(",")
			.map((name) => name.trim());
		if (names?.filter(Boolean).every((name) => name.startsWith("type "))) continue;
		statics.push(specifier!);
	}
	const dynamic = [...source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]!);
	return { static: statics, dynamic };
}

/** Every module reachable from `entry` through static imports, plus external specifiers. */
function staticGraph(entry: string): { modules: Set<string>; external: Set<string> } {
	const modules = new Set<string>();
	const external = new Set<string>();
	const visit = (file: string) => {
		if (modules.has(file)) return;
		modules.add(file);
		for (const specifier of importsOf(file).static) {
			if (specifier.startsWith(".")) visit(resolve(dirname(file), specifier));
			else external.add(specifier);
		}
	};
	visit(entry);
	return { modules, external };
}

describe("startup import graph", () => {
	const root = staticGraph(join(srcDir, "index.ts"));

	it("loads only @crustjs/core when the package is imported", () => {
		expect([...root.external]).toEqual(["@crustjs/core"]);
	});

	it("keeps lazily loaded modules from importing startup modules", () => {
		// A lazy module that imports a startup module forces the bundler to split
		// that module into a shared chunk, which every CLI then loads at startup.
		const lazyEntries = [...root.modules].flatMap((file) =>
			importsOf(file)
				.dynamic.filter((specifier) => specifier.startsWith("."))
				.map((specifier) => resolve(dirname(file), specifier)),
		);
		expect(lazyEntries.length).toBeGreaterThan(0);
		for (const entry of lazyEntries) {
			const graph = staticGraph(entry);
			const shared = [...graph.modules].filter((file) => root.modules.has(file));
			expect(
				shared.map((file) => relative(srcDir, file)),
				relative(srcDir, entry),
			).toEqual([]);
			// A static `node:*` import evaluates every lazy getter on the built-in;
			// `process.getBuiltinModule()` at the call site skips that.
			expect(
				[...graph.external].filter((specifier) => specifier.startsWith("node:")),
				relative(srcDir, entry),
			).toEqual([]);
		}
	});
});

describe("search() at startup", () => {
	it("loads the ranking only when `search` runs", async () => {
		const app = new Crust("acme")
			.extend(search(), help(), schema())
			.add(
				defineCommand("deploy", { description: "Deploy the app" }, (cmd) => cmd.action(() => {})),
			);
		for (const argv of [["deploy"], ["--help"], ["--llms"]]) {
			expect((await captureExecute(app, argv)).exitCode, argv.join(" ")).toBe(0);
		}
		await app.snapshot();
		expect(state.rankingLoaded).toBe(false);

		const found = await captureExecute(app, ["search", "deploy"]);
		expect(found.stdout).toBe("acme deploy  Deploy the app");
		expect(state.rankingLoaded).toBe(true);
	});
});

describe("telemetry() at startup", () => {
	it("loads the store only when neither variable decides or `telemetry` runs", async () => {
		const configHome = mkdtempSync(join(tmpdir(), "crust-telemetry-startup-"));
		vi.stubEnv("XDG_CONFIG_HOME", configHome);
		vi.stubEnv("APPDATA", configHome);
		try {
			const send = vi.fn(async () => {});
			const app = new Crust("acme")
				.extend(telemetry({ env: "ACME_TELEMETRY", enabled: "opt-out", send }), help())
				.add(defineCommand("deploy", (cmd) => cmd.action(() => {})));
			for (const [variable, doNotTrack] of [
				["0", undefined],
				["1", undefined],
				[undefined, "1"],
			] as const) {
				vi.stubEnv("ACME_TELEMETRY", variable);
				vi.stubEnv("DO_NOT_TRACK", doNotTrack);
				for (const argv of [["deploy"], ["--help"]]) {
					expect((await captureExecute(app, argv)).exitCode, argv.join(" ")).toBe(0);
				}
			}
			expect(send).toHaveBeenCalledTimes(2);
			expect(state.storeLoaded).toBe(false);

			vi.stubEnv("ACME_TELEMETRY", undefined);
			vi.stubEnv("DO_NOT_TRACK", undefined);
			expect((await captureExecute(app, ["deploy"])).exitCode).toBe(0);
			expect(state.storeLoaded).toBe(true);
			expect(send).toHaveBeenCalledTimes(3);
		} finally {
			vi.unstubAllEnvs();
			rmSync(configHome, { recursive: true, force: true });
		}
	});
});
