import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { BUILD_OUT_DIR_ENV, PACKAGED_BUILD_KEY } from "@crustjs/utils/artifacts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { defineExtension } from "../api/extension.ts";
import { defineExtensionId } from "../identity.ts";
import { Crust, defineCommand } from "./crust.ts";
import { SNAPSHOT_PATH_ENV } from "./invocation.ts";

describe("Invocation pipeline internal seam — snapshot protocol", () => {
	const originalExit = process.exit;
	const originalConsoleError = console.error;
	let exitCalls: Array<number | undefined>;
	let errorCalls: string[];
	let tempDirs: string[];

	beforeEach(() => {
		exitCalls = [];
		errorCalls = [];
		tempDirs = [];
		process.exit = (code?: number) => {
			exitCalls.push(code);
			throw new Error(`process.exit(${code ?? "undefined"}) was called during snapshot`);
		};
		console.error = (...values: unknown[]) => errorCalls.push(values.map(String).join(" "));
	});

	afterEach(async () => {
		process.exit = originalExit;
		console.error = originalConsoleError;
		vi.unstubAllEnvs();
		await Promise.all(tempDirs.map((path) => rm(path, { recursive: true, force: true })));
	});

	async function snapshotPath(): Promise<string> {
		const directory = await mkdtemp(join(tmpdir(), "crust-core-snapshot-test-"));
		tempDirs.push(directory);
		return join(directory, "command.json");
	}

	it("writes a snapshot, exits zero, and skips dispatch", async () => {
		const path = await snapshotPath();
		vi.stubEnv(SNAPSHOT_PATH_ENV, path);
		let actionRan = false;
		let preRunRan = false;
		const spy = defineExtension(defineExtensionId("spy")).preRun(() => {
			preRunRan = true;
		});
		const app = new Crust("build-subprocess", { description: "Snapshot test" })
			.extend(spy)
			.action(() => {
				actionRan = true;
			});

		await expect(app.execute({ argv: [] })).rejects.toThrow("process.exit(0) was called");

		expect(exitCalls).toEqual([0]);
		expect(actionRan).toBe(false);
		expect(preRunRan).toBe(false);
		expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
			meta: { name: "build-subprocess", description: "Snapshot test" },
			hasAction: true,
		});
	});

	it("runs build hooks in registration order", async () => {
		const path = await snapshotPath();
		const outDir = join(dirname(path), "output");
		vi.stubEnv(SNAPSHOT_PATH_ENV, path);
		vi.stubEnv(BUILD_OUT_DIR_ENV, outDir);
		const calls: string[] = [];
		const app = new Crust("build-subprocess")
			.extend(
				defineExtension(defineExtensionId("first")).build((ctx) => {
					expect(Object.isFrozen(ctx.snapshot)).toBe(true);
					expect(ctx.snapshot.meta.name).toBe("build-subprocess");
					// The output directory is owned by core; a hook has no handle to write beside its returned files.
					expect(Object.keys(ctx)).toEqual(["snapshot"]);
					calls.push("first");
					return [
						{ path: "first\\one.txt", content: "one" },
						{ path: "nested/../first-two.txt", content: new TextEncoder().encode("two") },
					];
				}),
				defineExtension(defineExtensionId("runtime-only")),
				defineExtension(defineExtensionId("second")).build(() => {
					calls.push("second");
					return [];
				}),
			)
			.action(() => {
				calls.push("action");
			});

		await expect(app.execute({ argv: [] })).rejects.toThrow("process.exit(0) was called");

		expect(calls).toEqual(["first", "second"]);
		// The report lists exactly the written paths; core wrote them, not the hook.
		expect(JSON.parse(await readFile(join(dirname(path), "build-report.json"), "utf8"))).toEqual({
			extensions: [
				{ id: "first", files: ["first/one.txt", "first-two.txt"] },
				{ id: "second", files: [] },
			],
		});
		expect(await readFile(join(outDir, "first", "one.txt"), "utf8")).toBe("one");
		expect(await readFile(join(outDir, "first-two.txt"), "utf8")).toBe("two");
	});

	it("rejects a path two build hooks both return, naming both Extensions, before writing", async () => {
		const path = await snapshotPath();
		const outDir = join(dirname(path), "output");
		vi.stubEnv(SNAPSHOT_PATH_ENV, path);
		vi.stubEnv(BUILD_OUT_DIR_ENV, outDir);
		const app = new Crust("build-subprocess").extend(
			defineExtension(defineExtensionId("first")).build(() => [
				{ path: "shared/config.json", content: "first" },
			]),
			defineExtension(defineExtensionId("second")).build(() => [
				{ path: "second/own.txt", content: "own" },
				{ path: "shared\\config.json", content: "second" },
			]),
		);

		await expect(app.execute({ argv: [] })).rejects.toThrow("process.exit(1) was called");

		expect(errorCalls).toHaveLength(1);
		expect(errorCalls[0]).toMatch(/^Extension "second" build failed:/);
		expect(errorCalls[0]).toContain('"shared/config.json"');
		expect(errorCalls[0]).toContain('Extension "first"');
		expect(await readFile(join(outDir, "shared", "config.json"), "utf8")).toBe("first");
		expect(existsSync(join(outDir, "second"))).toBe(false);
	});

	it("rejects paths that differ only by case, naming both Extensions and both spellings", async () => {
		const path = await snapshotPath();
		const outDir = join(dirname(path), "output");
		vi.stubEnv(SNAPSHOT_PATH_ENV, path);
		vi.stubEnv(BUILD_OUT_DIR_ENV, outDir);
		const app = new Crust("build-subprocess").extend(
			defineExtension(defineExtensionId("first")).build(() => [
				{ path: "shared/Config.json", content: "first" },
			]),
			defineExtension(defineExtensionId("second")).build(() => [
				{ path: "shared/config.json", content: "second" },
			]),
		);

		await expect(app.execute({ argv: [] })).rejects.toThrow("process.exit(1) was called");

		expect(errorCalls).toHaveLength(1);
		expect(errorCalls[0]).toMatch(/^Extension "second" build failed:/);
		expect(errorCalls[0]).toContain('"shared/config.json"');
		expect(errorCalls[0]).toContain('"shared/Config.json"');
		expect(errorCalls[0]).toContain('Extension "first"');
		// On a case-insensitive filesystem both spellings name this file; the first hook's content survives.
		expect(await readFile(join(outDir, "shared", "Config.json"), "utf8")).toBe("first");
	});

	it("rejects a path nested under a file an earlier hook produced, before writing", async () => {
		const path = await snapshotPath();
		const outDir = join(dirname(path), "output");
		vi.stubEnv(SNAPSHOT_PATH_ENV, path);
		vi.stubEnv(BUILD_OUT_DIR_ENV, outDir);
		const app = new Crust("build-subprocess").extend(
			defineExtension(defineExtensionId("first")).build(() => [{ path: "Foo", content: "first" }]),
			defineExtension(defineExtensionId("second")).build(() => [
				{ path: "second/own.txt", content: "own" },
				{ path: "foo/bar", content: "second" },
			]),
		);

		await expect(app.execute({ argv: [] })).rejects.toThrow("process.exit(1) was called");

		expect(errorCalls).toHaveLength(1);
		expect(errorCalls[0]).toMatch(/^Extension "second" build failed:/);
		expect(errorCalls[0]).toContain('"foo/bar"');
		expect(errorCalls[0]).toContain('"Foo"');
		expect(errorCalls[0]).toContain('Extension "first"');
		expect(await readFile(join(outDir, "Foo"), "utf8")).toBe("first");
		expect(existsSync(join(outDir, "second"))).toBe(false);
	});

	it("rejects a hook whose own files nest under each other, before writing", async () => {
		const path = await snapshotPath();
		const outDir = join(dirname(path), "output");
		vi.stubEnv(SNAPSHOT_PATH_ENV, path);
		vi.stubEnv(BUILD_OUT_DIR_ENV, outDir);
		const app = new Crust("build-subprocess").extend(
			defineExtension(defineExtensionId("only")).build(() => [
				{ path: "foo/bar", content: "nested" },
				{ path: "foo", content: "file" },
			]),
		);

		await expect(app.execute({ argv: [] })).rejects.toThrow("process.exit(1) was called");

		expect(errorCalls).toHaveLength(1);
		expect(errorCalls[0]).toMatch(/^Extension "only" build failed:/);
		expect(errorCalls[0]).toContain('"foo"');
		expect(errorCalls[0]).toContain('"foo/bar"');
		expect(errorCalls[0]).toContain('Extension "only"');
		expect(existsSync(outDir)).toBe(false);
	});

	it("runs only the last build hook for a duplicate Extension id", async () => {
		const path = await snapshotPath();
		vi.stubEnv(SNAPSHOT_PATH_ENV, path);
		vi.stubEnv(BUILD_OUT_DIR_ENV, dirname(path));
		const calls: string[] = [];
		const id = defineExtensionId("duplicate-build");
		const first = defineExtension(id).build(() => {
			calls.push("first");
			return [];
		});
		const second = defineExtension(id).build(() => {
			calls.push("second");
			return [];
		});
		const app = new Crust("build-subprocess").extend(first).extend(second);

		await expect(app.execute({ argv: [] })).rejects.toThrow("process.exit(0) was called");

		expect(calls).toEqual(["second"]);
	});

	it("refreshes sections between build hooks", async () => {
		const path = await snapshotPath();
		const outDir = join(dirname(path), "output");
		const marker = join(outDir, "generated-source", "marker.txt");
		vi.stubEnv(SNAPSHOT_PATH_ENV, path);
		vi.stubEnv(BUILD_OUT_DIR_ENV, outDir);
		const calls: string[] = [];
		const app = new Crust("build-subprocess").extend(
			defineExtension(defineExtensionId("producer")).build(async () => {
				expect(existsSync(path)).toBe(false);
				calls.push("producer");
				return [{ path: "generated-source/marker.txt", content: "ready" }];
			}),
			defineExtension(defineExtensionId("consumer"))
				// Reads the earlier hook's file from disk, like skills reading resolveArtifactDir("skills").
				.sections(() => [
					{
						command: [],
						title: "Generated source",
						body: existsSync(marker) ? readFileSync(marker, "utf8") : "missing",
					},
				])
				.build(({ snapshot }) => {
					calls.push("consumer");
					expect(existsSync(marker)).toBe(true);
					expect(snapshot.meta.sections).toContainEqual({
						title: "Generated source",
						body: "ready",
					});
					return [];
				}),
		);

		await expect(app.execute({ argv: [] })).rejects.toThrow("process.exit(0) was called");

		expect(calls).toEqual(["producer", "consumer"]);
		expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
			meta: { sections: [{ title: "Generated source", body: "ready" }] },
		});
	});

	it("runs Extension command recipes once across build hook refreshes", async () => {
		const path = await snapshotPath();
		vi.stubEnv(SNAPSHOT_PATH_ENV, path);
		vi.stubEnv(BUILD_OUT_DIR_ENV, join(dirname(path), "output"));
		let recipeRuns = 0;
		const app = new Crust("build-subprocess").extend(
			defineExtension(defineExtensionId("contributor"))
				.add(
					defineCommand("generated", (command) => {
						recipeRuns += 1;
						return command;
					}),
				)
				.build(() => []),
			defineExtension(defineExtensionId("second-hook")).build(() => []),
		);

		await expect(app.execute({ argv: [] })).rejects.toThrow("process.exit(0) was called");

		expect(recipeRuns).toBe(1);
	});

	it("attributes build hook failures to the extension", async () => {
		const path = await snapshotPath();
		vi.stubEnv(SNAPSHOT_PATH_ENV, path);
		vi.stubEnv(BUILD_OUT_DIR_ENV, join(dirname(path), "output"));
		const app = new Crust("build-subprocess").extend(
			defineExtension(defineExtensionId("broken")).build(() => {
				throw new Error("disk full");
			}),
		);

		await expect(app.execute({ argv: [] })).rejects.toThrow("process.exit(1) was called");

		expect(errorCalls).toEqual(['Extension "broken" build failed: disk full']);
	});

	it.each([
		["an absolute", (outDir: string) => join(outDir, "artifact.txt"), "must be relative"],
		["an escaping", () => "../artifact.txt", "escapes outDir"],
		["a drive-relative", () => "C:../outside.txt", "must be relative"],
		["a normalized drive-relative", () => "nested/../C:/outside.txt", "must be relative"],
		["an empty", () => "", "must name a file"],
		["an outDir-relative dot", () => "./", "must name a file"],
		["a collapsed dot", () => "nested/..", "must name a file"],
	])("rejects %s returned artifact path", async (_label, artifactPath, message) => {
		const path = await snapshotPath();
		const outDir = join(dirname(path), "output");
		vi.stubEnv(SNAPSHOT_PATH_ENV, path);
		vi.stubEnv(BUILD_OUT_DIR_ENV, outDir);
		const app = new Crust("build-subprocess").extend(
			defineExtension(defineExtensionId("unsafe"))
				// A valid sibling first: every path is checked before any file is written.
				.build(() => [
					{ path: "valid.txt", content: "valid" },
					{ path: artifactPath(outDir), content: "unsafe" },
				]),
		);

		await expect(app.execute({ argv: [] })).rejects.toThrow("process.exit(1) was called");

		expect(errorCalls).toHaveLength(1);
		expect(errorCalls[0]).toMatch(/^Extension "unsafe" build failed:/);
		expect(errorCalls[0]).toContain(message);
		expect(existsSync(outDir)).toBe(false);
	});

	it("skips the protocol in a packaged build without reading the environment", async () => {
		const path = await snapshotPath();
		const outDir = join(dirname(path), "output");
		vi.stubEnv(SNAPSHOT_PATH_ENV, path);
		vi.stubEnv(BUILD_OUT_DIR_ENV, outDir);
		const calls: string[] = [];
		const app = new Crust("packaged")
			.extend(
				defineExtension(defineExtensionId("builder")).build(() => {
					calls.push("build");
					return [];
				}),
			)
			.action(() => {
				calls.push("action");
			});
		// Stands in for Deno without --allow-env: any read throws.
		const envDescriptor = Object.getOwnPropertyDescriptor(process, "env")!;
		const deniedEnv = new Proxy(process.env, {
			get: (_target, key) => {
				throw new Error(`env read: ${String(key)}`);
			},
		});
		const marker = Symbol.for(PACKAGED_BUILD_KEY);
		Object.defineProperty(globalThis, marker, { value: true, configurable: true });
		Object.defineProperty(process, "env", { ...envDescriptor, value: deniedEnv });
		try {
			expect(await app.execute({ argv: [] })).toBe(0);
		} finally {
			Object.defineProperty(process, "env", envDescriptor);
			Reflect.deleteProperty(globalThis, marker);
		}

		expect(calls).toEqual(["action"]);
		expect(exitCalls).toEqual([]);
		expect(existsSync(path)).toBe(false);
		expect(existsSync(outDir)).toBe(false);
	});
});
