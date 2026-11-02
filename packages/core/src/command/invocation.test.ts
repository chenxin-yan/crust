import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { BUILD_OUT_DIR_ENV } from "@crustjs/utils/artifacts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { defineExtension } from "../api/extension.ts";
import { defineExtensionId } from "../identity.ts";
import { Crust, defineCommand } from "./crust.ts";
import { SNAPSHOT_PATH_ENV } from "./invocation.ts";
import type { CommandSnapshot } from "./snapshot.ts";

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
});

describe("Invocation pipeline — snapshot projection", () => {
	function rootObserver() {
		const roots: CommandSnapshot[] = [];
		const observer = defineExtension(defineExtensionId("observer"))
			.preRun((ctx) => void roots.push(ctx.rootCommand))
			.onError((_error, ctx) => {
				roots.push(ctx.rootCommand);
				return true;
			});
		return { observer, roots };
	}

	it("keeps one rootCommand per invocation, including fallback failure rendering", async () => {
		const { observer, roots } = rootObserver();
		const seen: CommandSnapshot[] = [];
		const app = new Crust("app")
			.extend(observer)
			.add(
				defineCommand("sub", (c) =>
					c.action(({ rootCommand, command }) => {
						seen.push(rootCommand, command);
					}),
				),
			)
			.action(() => {});

		await app.run(["sub"]);
		// An unknown flag fails before dispatch builds a context.
		const originalExitCode = process.exitCode;
		try {
			expect(await app.execute({ argv: ["--nope"], io: { stderr: () => {} } })).toBe(1);
		} finally {
			process.exitCode = originalExitCode ?? 0;
		}

		expect(roots).toHaveLength(2);
		// The action and the preRun hook see one projection, whose child is the routed command.
		expect(seen[0]).toBe(roots[0]);
		expect(roots[0]!.subCommands.sub).toBe(seen[1]);
		expect(roots[1]!.subCommands.sub?.meta.name).toBe("sub");
	});

	it("reuses rootCommand across invocations once every command is built", async () => {
		const { observer, roots } = rootObserver();
		const built: string[] = [];
		const command = (name: string) =>
			defineCommand(name, (c) => {
				built.push(name);
				return c.action(() => {});
			});
		const app = new Crust("app").extend(observer).add(command("a"), command("b"));

		await app.run(["a"]);
		await app.run(["a"]);
		// Deciding reuse must not build the pending sibling.
		expect(built).toEqual(["a"]);
		expect(roots[1]).not.toBe(roots[0]);

		await app.run(["b"]);
		await app.run(["b"]);
		expect(roots[3]).toBe(roots[2]);
	});

	it("keeps routed snapshot identity when reading a pending child makes the root reusable", async () => {
		const app = new Crust("app").add(
			defineCommand("group", (c) =>
				c.add(defineCommand("leaf", (leaf) => leaf.action(() => {}))).action((ctx) => {
					const command = ctx.command;
					void command.subCommands.leaf;
					return ctx.rootCommand.subCommands.group === command && ctx.command === command;
				}),
			),
		);

		for (let invocation = 0; invocation < 3; invocation++) {
			expect(await app.run(["group"])).toMatchObject({ status: "completed", result: true });
		}
	});

	it("keeps exposed snapshots stable while an overlapping invocation populates shared snapshots", async () => {
		const started = Promise.withResolvers<void>();
		const resume = Promise.withResolvers<void>();
		let first = true;
		const app = new Crust("app").add(
			defineCommand("group", (c) =>
				c.add(defineCommand("leaf", (leaf) => leaf.action(() => {}))).action(async (ctx) => {
					const root = ctx.rootCommand;
					const command = ctx.command;
					const nested = root.subCommands.group;
					void command.subCommands.leaf;
					if (first) {
						first = false;
						started.resolve();
						await resume.promise;
					}
					return (
						ctx.rootCommand === root &&
						ctx.command === command &&
						nested === command &&
						root.subCommands.group === command
					);
				}),
			),
		);

		const pending = app.run(["group"]);
		try {
			await started.promise;
			expect(await app.run(["group"])).toMatchObject({ status: "completed", result: true });
		} finally {
			resume.resolve();
		}
		expect(await pending).toMatchObject({ status: "completed", result: true });
	});

	it("keeps re-projecting when a URL default would make a reused snapshot stale", async () => {
		const endpoint = new URL("https://a.example/v1");
		const { observer, roots } = rootObserver();
		const app = new Crust("app")
			.extend(observer)
			.flags({ name: "endpoint", type: "url", default: endpoint })
			.action(({ flags }) => flags.endpoint.href);

		await app.run([]);
		endpoint.pathname = "/v2";
		const second = await app.run([]);

		// The action and the snapshot must agree on the shared URL default.
		expect(second).toMatchObject({ status: "completed", result: "https://a.example/v2" });
		expect(roots.map(({ flags }) => flags.endpoint?.default)).toEqual([
			"https://a.example/v1",
			"https://a.example/v2",
		]);
	});

	it("keeps re-projecting when a JSON default would make a reused snapshot stale", async () => {
		const json = ["a"];
		const { observer, roots } = rootObserver();
		const app = new Crust("app")
			.extend(observer)
			.flags({ name: "data", type: "json", default: json })
			.action(() => {});

		await app.run([]);
		json.push("b");
		await app.run([]);

		expect(roots.map(({ flags }) => flags.data?.default)).toEqual([["a"], ["a", "b"]]);
	});
});

describe("Invocation pipeline — inherited SIGINT ignore", () => {
	// Bun keeps an inherited SIG_IGN (Node resets it at startup). The real executable, not a
	// version-manager shim that may reset signals before exec.
	const bunPath =
		process.platform === "linux"
			? spawnSync("bun", ["-e", "console.log(process.execPath)"], {
					encoding: "utf8",
					timeout: 10_000,
				}).stdout?.trim()
			: undefined;

	it.skipIf(!bunPath)(
		"keeps a background job immune to SIGINT on Bun",
		async () => {
			const dir = await mkdtemp(join(tmpdir(), "crust-ignored-sigint-"));
			const probe = join(dir, "probe.ts");
			await writeFile(
				probe,
				`import { Crust } from ${JSON.stringify(pathToFileURL(join(import.meta.dirname, "..", "index.ts")).href)};
await new Crust("app").action(() => {}).execute({ argv: [] });
process.kill(process.pid, "SIGINT");
await new Promise((resolve) => setTimeout(resolve, 200));
console.log("alive");`,
			);
			try {
				const result = spawnSync("sh", ["-c", 'trap "" INT; exec "$0" "$1"', bunPath!, probe], {
					encoding: "utf8",
					timeout: 10_000,
				});
				expect(result).toMatchObject({ status: 0, stdout: "alive\n" });
			} finally {
				await rm(dir, { recursive: true, force: true });
			}
		},
		15_000,
	);
});
