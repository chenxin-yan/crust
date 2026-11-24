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
import { type AnyCrust, Crust, type CommandDefinition, defineCommand } from "./crust.ts";
import { SNAPSHOT_PATH_ENV } from "./invocation.ts";
import type { CommandSnapshot } from "./snapshot.ts";

describe("Invocation pipeline internal seam — snapshot protocol", () => {
	const originalExit = process.exit;
	let exitCalls: Array<number | undefined>;
	let errorCalls: string[];
	const io = { stderr: (text: string) => void errorCalls.push(text) };
	let tempDirs: string[];

	beforeEach(() => {
		exitCalls = [];
		errorCalls = [];
		tempDirs = [];
		process.exit = (code?: number) => {
			exitCalls.push(code);
			throw new Error(`process.exit(${code ?? "undefined"}) was called during snapshot`);
		};
	});

	afterEach(async () => {
		process.exit = originalExit;
		vi.unstubAllEnvs();
		await Promise.all(tempDirs.map((path) => rm(path, { recursive: true, force: true })));
	});

	async function stubBuildEnv() {
		const directory = await mkdtemp(join(tmpdir(), "crust-core-snapshot-test-"));
		tempDirs.push(directory);
		const path = join(directory, "command.json");
		const outDir = join(directory, "output");
		vi.stubEnv(SNAPSHOT_PATH_ENV, path);
		vi.stubEnv(BUILD_OUT_DIR_ENV, outDir);
		return { path, outDir };
	}

	it("writes a snapshot, exits zero, and skips dispatch", async () => {
		const { path } = await stubBuildEnv();
		// No build output directory: the protocol still writes the snapshot.
		vi.stubEnv(BUILD_OUT_DIR_ENV, undefined);
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

		await expect(app.execute({ argv: [], io })).rejects.toThrow("process.exit(0) was called");

		expect(exitCalls).toEqual([0]);
		expect(actionRan).toBe(false);
		expect(preRunRan).toBe(false);
		expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
			meta: { name: "build-subprocess", description: "Snapshot test" },
			hasAction: true,
		});
	});

	it("runs build hooks in registration order", async () => {
		const { path, outDir } = await stubBuildEnv();
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

		await expect(app.execute({ argv: [], io })).rejects.toThrow("process.exit(0) was called");

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
		const { outDir } = await stubBuildEnv();
		const app = new Crust("build-subprocess").extend(
			defineExtension(defineExtensionId("first")).build(() => [
				{ path: "shared/Config.json", content: "first" },
			]),
			defineExtension(defineExtensionId("second")).build(() => [
				{ path: "shared/config.json", content: "second" },
			]),
		);

		await expect(app.execute({ argv: [], io })).rejects.toThrow("process.exit(1) was called");

		expect(errorCalls).toHaveLength(1);
		expect(errorCalls[0]).toMatch(/^Extension "second" build failed:/);
		expect(errorCalls[0]).toContain('"shared/config.json"');
		expect(errorCalls[0]).toContain('"shared/Config.json"');
		expect(errorCalls[0]).toContain('Extension "first"');
		// On a case-insensitive filesystem both spellings name this file; the first hook's content survives.
		expect(await readFile(join(outDir, "shared", "Config.json"), "utf8")).toBe("first");
	});

	it("rejects a path nested under a file an earlier hook produced, before writing", async () => {
		const { outDir } = await stubBuildEnv();
		const app = new Crust("build-subprocess").extend(
			defineExtension(defineExtensionId("first")).build(() => [{ path: "Foo", content: "first" }]),
			defineExtension(defineExtensionId("second")).build(() => [
				{ path: "second/own.txt", content: "own" },
				{ path: "foo/bar", content: "second" },
			]),
		);

		await expect(app.execute({ argv: [], io })).rejects.toThrow("process.exit(1) was called");

		expect(errorCalls).toHaveLength(1);
		expect(errorCalls[0]).toMatch(/^Extension "second" build failed:/);
		expect(errorCalls[0]).toContain('"foo/bar"');
		expect(errorCalls[0]).toContain('"Foo"');
		expect(errorCalls[0]).toContain('Extension "first"');
		expect(await readFile(join(outDir, "Foo"), "utf8")).toBe("first");
		expect(existsSync(join(outDir, "second"))).toBe(false);
	});

	it("rejects a hook whose own files nest under each other, before writing", async () => {
		const { outDir } = await stubBuildEnv();
		const app = new Crust("build-subprocess").extend(
			defineExtension(defineExtensionId("only")).build(() => [
				{ path: "foo/bar", content: "nested" },
				{ path: "foo", content: "file" },
			]),
		);

		await expect(app.execute({ argv: [], io })).rejects.toThrow("process.exit(1) was called");

		expect(errorCalls).toHaveLength(1);
		expect(errorCalls[0]).toMatch(/^Extension "only" build failed:/);
		expect(errorCalls[0]).toContain('"foo"');
		expect(errorCalls[0]).toContain('"foo/bar"');
		expect(errorCalls[0]).toContain('Extension "only"');
		expect(existsSync(outDir)).toBe(false);
	});

	it("refreshes sections between build hooks", async () => {
		const { path, outDir } = await stubBuildEnv();
		const marker = join(outDir, "generated-source", "marker.txt");
		const calls: string[] = [];
		const app = new Crust("build-subprocess").extend(
			defineExtension(defineExtensionId("producer")).build(async () => {
				expect(existsSync(path)).toBe(false);
				calls.push("producer");
				return [{ path: "generated-source/marker.txt", content: "ready" }];
			}),
			defineExtension(defineExtensionId("consumer"))
				// Reads the earlier hook's file from disk, like skills reading artifactPath("skills").
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

		await expect(app.execute({ argv: [], io })).rejects.toThrow("process.exit(0) was called");

		expect(calls).toEqual(["producer", "consumer"]);
		expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
			meta: { sections: [{ title: "Generated source", body: "ready" }] },
		});
	});

	it("runs Extension command recipes once across build hook refreshes", async () => {
		await stubBuildEnv();
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

		await expect(app.execute({ argv: [], io })).rejects.toThrow("process.exit(0) was called");

		expect(recipeRuns).toBe(1);
	});

	it("attributes build hook failures to the extension", async () => {
		await stubBuildEnv();
		const app = new Crust("build-subprocess").extend(
			defineExtension(defineExtensionId("broken")).build(() => {
				throw new Error("disk full");
			}),
		);

		await expect(app.execute({ argv: [], io })).rejects.toThrow("process.exit(1) was called");

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
		const { outDir } = await stubBuildEnv();
		const app = new Crust("build-subprocess").extend(
			defineExtension(defineExtensionId("unsafe"))
				// A valid sibling first: every path is checked before any file is written.
				.build(() => [
					{ path: "valid.txt", content: "valid" },
					{ path: artifactPath(outDir), content: "unsafe" },
				]),
		);

		await expect(app.execute({ argv: [], io })).rejects.toThrow("process.exit(1) was called");

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
			expect(await app.execute({ argv: ["--nope"], io: { stderr: () => {} } })).toBe(2);
		} finally {
			process.exitCode = originalExitCode ?? 0;
		}

		expect(roots).toHaveLength(2);
		// The action and the preRun hook see one projection, whose child is the routed command.
		expect(seen[0]).toBe(roots[0]);
		expect(roots[0]!.subCommands.sub).toBe(seen[1]);
		expect(roots[1]!.subCommands.sub?.meta.name).toBe("sub");
	});

	it("reads child metadata without building the child; reading its body builds it", async () => {
		const built: string[] = [];
		const command = (name: string) =>
			defineCommand(name, { description: `${name} command` }, (c) => {
				built.push(name);
				return c.flags({ [`${name}-flag`]: { type: "boolean" } }).action(() => {});
			});
		const app = new Crust("app").add(command("a"), command("b")).action(({ rootCommand }) => {
			const b = rootCommand.subCommands.b!;
			const before = [...built];
			const meta = { name: b.meta.name, description: b.meta.description };
			const afterMeta = [...built];
			const flags = Object.keys(b.flags);
			return {
				before,
				meta,
				afterMeta,
				flags,
				after: [...built],
				same: rootCommand.subCommands.b === b,
			};
		});

		expect(await app.run([])).toMatchObject({
			status: "completed",
			result: {
				before: [],
				meta: { name: "b", description: "b command" },
				afterMeta: [],
				flags: ["b-flag"],
				after: ["b"],
				same: true,
			},
		});
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
			.flags({ endpoint: { type: "url", default: endpoint } })
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
			.flags({ data: { type: "json", default: json } })
			.action(() => {});

		await app.run([]);
		json.push("b");
		await app.run([]);

		expect(roots.map(({ flags }) => flags.data?.default)).toEqual([["a"], ["a", "b"]]);
	});
});

describe("Invocation pipeline — commandPathOf", () => {
	const migrate = defineCommand("migrate", (c) => c.action(() => {}));
	const db = defineCommand("db", { aliases: ["d"] }, (c) => c.add(migrate).action(() => {}));
	const status = defineCommand("status", (c) => c.action(() => {}));
	const doctor = defineCommand("doctor", (c) => c.action(() => {}));
	const unmounted = defineCommand("unmounted", (c) => c.action(() => {}));
	const tools = defineExtension(defineExtensionId("tools")).add(doctor);

	function lookup(definitions: readonly CommandDefinition<any, any, any, any>[]) {
		const found: unknown[] = [];
		const observer = defineExtension(defineExtensionId("observer"))
			.postRun((ctx) => {
				for (const definition of definitions) found.push(ctx.commandPathOf(definition));
			})
			.onError((_error, ctx) => {
				for (const definition of definitions) found.push(ctx.commandPathOf(definition));
				return true;
			});
		return { found, observer };
	}

	it("finds the canonical path of an added, nested, or Extension-contributed definition", async () => {
		const renamed = status.as("state");
		const { found, observer } = lookup([migrate, db, doctor, renamed, status, unmounted]);
		const app = new Crust("app").extend(observer, tools).add(db, renamed);

		expect(await app.run(["doctor"])).toMatchObject({ status: "completed" });
		expect(found).toEqual([
			["app", "db", "migrate"],
			["app", "db"],
			["app", "doctor"],
			["app", "state"],
			// `.as()` returns a different definition.
			undefined,
			undefined,
		]);
	});

	it("returns the shallowest path of a definition added more than once", async () => {
		const { found, observer } = lookup([migrate]);
		const app = new Crust("app").extend(observer).add(db, migrate);

		await app.run(["db"]);
		expect(found).toEqual([["app", "migrate"]]);
	});

	it("breaks a same-depth tie by the first added, even for integer-like names", async () => {
		const { found, observer } = lookup([migrate]);
		const app = new Crust("app")
			.extend(observer)
			.command("2", (c) => c.add(migrate))
			.command("1", (c) => c.add(migrate))
			.action(() => {});

		await app.run([]);
		expect(found).toEqual([["app", "2", "migrate"]]);
	});

	it("finds paths from onError after a failure before dispatch", async () => {
		const { found, observer } = lookup([migrate]);
		const app = new Crust("app").extend(observer).add(db);

		const originalExitCode = process.exitCode;
		try {
			await app.execute({ argv: ["nope"], io: { stderr: () => {} } });
		} finally {
			process.exitCode = originalExitCode ?? 0;
		}
		expect(found).toEqual([["app", "db", "migrate"]]);
	});
});

describe("Invocation pipeline — parseCommandArgv", () => {
	function setUp() {
		const ran: string[] = [];
		const trace = defineExtension(defineExtensionId("trace"))
			.flags({ trace: { type: "boolean" } })
			.setup(() => void ran.push("setup"))
			.preRun((ctx) => void ran.push(`preRun ${ctx.commandPath.join(" ")}`));
		const remove = defineCommand("delete", (c) =>
			c
				.args({ name: "id", type: "string", required: true })
				.flags({
					region: { type: "string", env: { name: "REGION" }, default: "us" },
					tag: { type: "string", multiple: true, parse: (raw) => raw.toUpperCase() },
					force: { type: "boolean" },
				})
				.action(() => void ran.push("delete action")),
		);
		const users = defineCommand("users", { aliases: ["u"] }, (c) => {
			ran.push("users recipe");
			return c.add(remove);
		});
		const teams = defineCommand("teams", (c) => {
			ran.push("teams recipe");
			return c.action(() => {});
		});
		const parsed: unknown[] = [];
		const preview = (path: readonly string[], argv: readonly string[]) =>
			defineExtension(defineExtensionId("preview")).preRun(async (ctx) => {
				parsed.push(await ctx.parseCommandArgv(path, argv));
			});
		const app = (path: readonly string[], argv: readonly string[]) =>
			new Crust("app")
				.extend(trace, preview(path, argv))
				.add(users, teams)
				.command("preview", (c) => c.action(() => void ran.push("preview action")));
		return { ran, parsed, app };
	}

	it("parses, checks and transforms argv for the command at a path without running it", async () => {
		const { ran, parsed, app } = setUp();
		const outcome = await app(
			["app", "u", "delete"],
			["u_1", "--force", "--tag", "a", "--trace", "--", "rest"],
		).run(["preview"], {}, { env: { REGION: "eu" } });

		expect(outcome).toMatchObject({ status: "completed" });
		expect(parsed).toEqual([
			{
				// The canonical path, also when routed through an alias.
				path: ["app", "users", "delete"],
				args: { id: "u_1" },
				flags: { force: true, region: "eu", tag: ["A"], trace: true },
				rawArgs: ["rest"],
			},
		]);
		// Only the preview invocation's own hooks and action ran; no sibling recipe was built.
		expect(ran).toEqual(["setup", "preRun app preview", "users recipe", "preview action"]);
	});

	it("fails as the command's own invocation would", async () => {
		const failures = async (path: readonly string[], argv: readonly string[]) => {
			const outcome = await setUp().app(path, argv).run(["preview"]);
			return outcome.status === "failed" ? outcome.error : outcome;
		};

		expect(await failures(["app", "users", "delete"], [])).toMatchObject({
			code: "VALIDATION",
			message: expect.stringContaining("<id>"),
		});
		expect(await failures(["app", "users", "delete"], ["u_1", "--nope"])).toMatchObject({
			code: "PARSE",
			message: expect.stringContaining("--nope"),
		});
		expect(await failures(["app", "users", "nope"], [])).toMatchObject({
			code: "COMMAND_NOT_FOUND",
			details: { input: "nope", commandPath: ["app", "users"] },
		});
		expect(await failures(["other", "users"], [])).toMatchObject({ code: "PARSE" });
	});
});

describe("Invocation pipeline — exit status", () => {
	let originalExitCode: typeof process.exitCode;
	beforeEach(() => {
		originalExitCode = process.exitCode;
	});
	afterEach(() => {
		process.exitCode = originalExitCode ?? 0;
	});

	async function execute(app: AnyCrust, argv: string[]) {
		const stdout: string[] = [];
		const stderr: string[] = [];
		const exitCode = await app.execute({
			argv,
			io: { stdout: (text) => void stdout.push(text), stderr: (text) => void stderr.push(text) },
		});
		return { exitCode, processExitCode: process.exitCode, stdout, stderr };
	}

	it("ends with the last exitCode(n) the action set, and the action carries on", async () => {
		const app = new Crust("app").action(({ exitCode, stdout }) => {
			exitCode(3);
			exitCode(4);
			stdout("after");
			return "done";
		});
		expect(await execute(app, [])).toEqual({
			exitCode: 4,
			processExitCode: 4,
			stdout: ["after"],
			stderr: [],
		});
		expect(await app.run([])).toMatchObject({ status: "completed", result: "done", exitCode: 4 });
	});

	it("fails when the action calls exitCode(n) with a non-integer", async () => {
		const app = new Crust("app").action(({ exitCode }) => exitCode(1.5));
		expect(await execute(app, [])).toMatchObject({
			exitCode: 1,
			processExitCode: 1,
			stderr: ["Error: exitCode(1.5): not an integer."],
		});
		expect(await app.run([])).toMatchObject({ status: "failed", exitCode: 1 });
	});

	it("ends with a thrown value's non-zero integer exitCode, else 1, whatever exitCode(n) set", async () => {
		const failing = (error: unknown) =>
			new Crust("app").action(({ exitCode }) => {
				exitCode(3);
				throw error;
			});
		const child = Object.assign(new Error("child failed"), { exitCode: 137 });
		expect(await execute(failing(child), [])).toMatchObject({
			exitCode: 137,
			processExitCode: 137,
			stderr: ["Error: child failed"],
		});
		expect(await failing(child).run([])).toMatchObject({ status: "failed", exitCode: 137 });
		expect((await execute(failing(new Error("plain")), [])).exitCode).toBe(1);
		expect((await execute(failing({ exitCode: 1.5 }), [])).exitCode).toBe(1);
		expect((await execute(failing({ exitCode: "2" }), [])).exitCode).toBe(1);
		expect((await execute(failing({ exitCode: 0 }), [])).exitCode).toBe(1);
		expect((await execute(failing({ exitCode: 1e21 }), [])).exitCode).toBe(1);
		// A shell keeps only the low byte: 256 would read as success.
		expect((await execute(failing({ exitCode: 256 }), [])).exitCode).toBe(1);
		const revoked = Proxy.revocable({}, {});
		revoked.revoke();
		expect((await execute(failing(revoked.proxy), [])).exitCode).toBe(1);
		expect(await failing(revoked.proxy).run([])).toMatchObject({ status: "failed", exitCode: 1 });
		// An Extension that fails to apply goes through the same rule.
		const broken = new Crust("app")
			.extend(
				defineExtension(defineExtensionId("broken")).sections(() => {
					throw child;
				}),
			)
			.action(() => {});
		expect(await execute(broken, [])).toMatchObject({ exitCode: 137, processExitCode: 137 });
	});

	it("ends with 2 for PARSE, VALIDATION, and COMMAND_NOT_FOUND errors", async () => {
		const app = new Crust("app")
			.flags({ mode: { type: "string", required: true } })
			.add(defineCommand("known", (command) => command.action(() => {})));
		const leaf = new Crust("leaf")
			.flags({ mode: { type: "string", required: true } })
			.action(() => {});
		expect((await execute(leaf, ["--nope"])).exitCode).toBe(2);
		expect((await execute(leaf, [])).exitCode).toBe(2);
		expect((await execute(app, ["nope"])).exitCode).toBe(2);
		expect(process.exitCode).toBe(2);
		const erased: AnyCrust = leaf;
		expect(await erased.run([])).toMatchObject({ status: "failed", exitCode: 2 });
	});

	it("ignores process.exitCode set by the action or a hook", async () => {
		const hooks = defineExtension(defineExtensionId("hooks"))
			.onError(() => {
				process.exitCode = 0;
				return true;
			})
			.postRun(() => {
				process.exitCode = 9;
			});
		const passing = new Crust("app").extend(hooks).action(() => {
			process.exitCode = 7;
		});
		expect(await execute(passing, [])).toMatchObject({ exitCode: 0, processExitCode: 0 });
		const failing = new Crust("app").extend(hooks).action(() => {
			throw new Error("failed");
		});
		expect(await execute(failing, [])).toMatchObject({ exitCode: 1, processExitCode: 1 });
		const rewriting = new Crust("app")
			.extend(
				defineExtension(defineExtensionId("rewrite")).onError((error) => {
					Object.assign(error as object, { exitCode: 5 });
				}),
			)
			.action(() => {
				throw Object.assign(new Error("failed"), { exitCode: 3 });
			});
		expect(await execute(rewriting, [])).toMatchObject({ exitCode: 3, processExitCode: 3 });
		const rewritingAfterRun = new Crust("app")
			.extend(
				defineExtension(defineExtensionId("rewrite")).postRun((_context, outcome) => {
					if (outcome.status === "failed") Object.assign(outcome.error as object, { exitCode: 5 });
				}),
			)
			.action(() => {
				throw Object.assign(new Error("failed"), { exitCode: 3 });
			});
		expect(await execute(rewritingAfterRun, [])).toMatchObject({ exitCode: 3 });
		expect(await rewritingAfterRun.run([])).toMatchObject({ status: "failed", exitCode: 3 });
	});
});

describe("Invocation pipeline — output failures", () => {
	let originalExitCode: typeof process.exitCode;
	beforeEach(() => {
		originalExitCode = process.exitCode;
	});
	afterEach(() => {
		process.exitCode = originalExitCode ?? 0;
	});

	/** What the process stdout writer throws once the reader is gone. */
	const stdoutClosed = () =>
		Object.assign(new DOMException("Standard output was closed.", "AbortError"), {
			cause: "SIGPIPE",
		});

	async function execute(app: AnyCrust, failure: () => unknown) {
		const stderr: string[] = [];
		const exitCode = await app.execute({
			argv: [],
			io: {
				stdout: () => {
					throw failure();
				},
				stderr: (text) => void stderr.push(text),
			},
		});
		return { exitCode, stderr };
	}

	it("cancels the invocation silently with 141 when stdout's reader is gone", async () => {
		const seen: unknown[] = [];
		const throwing = new Crust("app").action(({ stdout, signal }) => {
			try {
				stdout("line");
			} finally {
				seen.push(signal.reason);
			}
		});
		expect(await execute(throwing, stdoutClosed)).toEqual({ exitCode: 141, stderr: [] });
		expect(seen).toEqual([expect.objectContaining({ name: "AbortError", cause: "SIGPIPE" })]);

		// Whatever the action did after the throw.
		const ignoring = new Crust("app").action(({ stdout }) => {
			try {
				stdout("line");
			} catch {}
		});
		expect(await execute(ignoring, stdoutClosed)).toEqual({ exitCode: 141, stderr: [] });

		// A writer that bypasses stdout(), such as raw bytes to the process's stdout.
		// Hooks see the cancellation, and a failing cleanup keeps 141.
		let postRunCause: unknown;
		const leaky = defineExtension(defineExtensionId("leaky"))
			.setup(({ defer }) =>
				defer(() => {
					throw new Error("close failed");
				}),
			)
			.postRun(({ signal }) => {
				postRunCause = signal.reason?.cause;
			});
		const direct = new Crust("app").extend(leaky).action(() => {
			throw stdoutClosed();
		});
		expect(await execute(direct, stdoutClosed)).toEqual({
			exitCode: 141,
			stderr: ["Cleanup failed: close failed"],
		});
		expect(postRunCause).toBe("SIGPIPE");

		// The action's own `await using` fails while that cancellation unwinds.
		postRunCause = undefined;
		const disposing = new Crust("app").extend(leaky).action(async () => {
			await using _resource = {
				async [Symbol.asyncDispose]() {
					throw new Error("own close failed");
				},
			};
			throw stdoutClosed();
		});
		expect(await execute(disposing, stdoutClosed)).toEqual({
			exitCode: 141,
			stderr: ["Error: own close failed", "Cleanup failed: close failed"],
		});
		expect(postRunCause).toBe("SIGPIPE");
	});

	it("fails the invocation with 1 on any other stdout write error", async () => {
		let aborted: boolean | undefined;
		const app = new Crust("app").action(({ stdout, signal }) => {
			try {
				stdout("line");
			} finally {
				aborted = signal.aborted;
			}
		});
		const full = () =>
			Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" });
		expect(await execute(app, full)).toEqual({
			exitCode: 1,
			stderr: ["Error: ENOSPC: no space left on device, write"],
		});
		expect(aborted).toBe(false);
	});
});

describe("Invocation pipeline — inherited signal ignores", () => {
	// Bun keeps an inherited SIG_IGN (Node resets it at startup). The real executable, not a
	// version-manager shim that may reset signals before exec.
	const bunPath =
		process.platform === "linux"
			? spawnSync("bun", ["-e", "console.log(process.execPath)"], {
					encoding: "utf8",
					timeout: 10_000,
				}).stdout?.trim()
			: undefined;

	it.skipIf(!bunPath).each([
		["SIGINT", "INT"],
		["SIGTERM", "TERM"],
	])(
		"keeps a process started with %s ignored immune to it on Bun",
		async (signal, trapName) => {
			const dir = await mkdtemp(join(tmpdir(), "crust-ignored-signal-"));
			const probe = join(dir, "probe.ts");
			await writeFile(
				probe,
				`import { Crust } from ${JSON.stringify(pathToFileURL(join(import.meta.dirname, "..", "index.ts")).href)};
await new Crust("app").action(() => {}).execute({ argv: [] });
process.kill(process.pid, ${JSON.stringify(signal)});
await new Promise((resolve) => setTimeout(resolve, 200));
console.log("alive");`,
			);
			try {
				const result = spawnSync(
					"sh",
					["-c", `trap "" ${trapName}; exec "$0" "$1"`, bunPath!, probe],
					{
						encoding: "utf8",
						timeout: 10_000,
					},
				);
				expect(result).toMatchObject({ status: 0, stdout: "alive\n" });
			} finally {
				await rm(dir, { recursive: true, force: true });
			}
		},
		15_000,
	);
});
