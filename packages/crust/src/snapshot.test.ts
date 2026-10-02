import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { defineExtensionId } from "@crustjs/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { isRunning, reapBoundedProcesses, runBoundedProcess } from "../tests/bounded-process.ts";
import { buildEntrypoint } from "./snapshot.ts";

const coreUrl = import.meta.resolve("@crustjs/core");
const io = { stdout: () => {}, stderr: () => {} };

describe("buildEntrypoint", () => {
	const tempDirs: string[] = [];
	const lifetimeEvents = ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT", "exit"] as const;
	const listenerCounts = () => lifetimeEvents.map((event) => process.listenerCount(event));
	let listenersBefore: number[] = [];

	beforeEach(() => {
		listenersBefore = listenerCounts();
	});

	afterEach(async () => {
		// Normal, failed and timed-out preparations all remove their lifetime listeners.
		expect(listenerCounts()).toEqual(listenersBefore);
		await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
	});

	it("returns the entry snapshot and exits before trailing code", async () => {
		const directory = await mkdtemp(join(tmpdir(), "crust-entry-snapshot-test-"));
		tempDirs.push(directory);
		const entry = join(directory, "cli.ts");
		const trailingMarker = join(directory, "trailing-code-ran");
		await writeFile(
			entry,
			`import { Crust } from ${JSON.stringify(coreUrl)};\n` +
				`const app = new Crust("fixture", { description: "Fixture CLI" }).action(() => {});\n` +
				`await app.execute();\n` +
				`await Bun.write(${JSON.stringify(trailingMarker)}, "ran");\n`,
		);

		const { snapshot, build } = await buildEntrypoint(
			entry,
			join(directory, "dist"),
			[],
			io,
			directory,
		);

		expect(snapshot.meta).toMatchObject({ name: "fixture", description: "Fixture CLI" });
		expect(snapshot.hasAction).toBe(true);
		expect(build).toEqual({ extensions: [] });
		await expect(access(trailingMarker)).rejects.toThrow();
	});

	it("runs Extension build hooks and returns their artifact report", async () => {
		const directory = await mkdtemp(join(tmpdir(), "crust-entry-build-test-"));
		tempDirs.push(directory);
		const entry = join(directory, "cli.ts");
		const outDir = join(directory, "dist");
		await writeFile(
			entry,
			`import { Crust, defineExtension, defineExtensionId } from ${JSON.stringify(coreUrl)};\n` +
				`const artifact = defineExtension(defineExtensionId("artifact")).build(() => [{ path: "artifact.txt", content: "built" }, { path: "assets/bytes.bin", content: new Uint8Array([0, 255, 128, 10]) }]);\n` +
				`const app = new Crust("fixture").extend(artifact).action(() => {});\n` +
				`await app.execute();\n`,
		);

		const result = await buildEntrypoint(entry, outDir, [], io, directory);

		expect(result.snapshot.meta.name).toBe("fixture");
		expect(result.build.extensions).toHaveLength(1);
		expect(String(result.build.extensions[0]?.id)).toBe("artifact");
		expect(result.build.extensions[0]?.files).toEqual(["artifact.txt", "assets/bytes.bin"]);
		expect(await readFile(join(outDir, "artifact.txt"), "utf8")).toBe("built");
		expect(new Uint8Array(await readFile(join(outDir, "assets/bytes.bin")))).toEqual(
			new Uint8Array([0, 255, 128, 10]),
		);
	});

	it("builds skill and man artifacts without absolute source paths", async () => {
		const directory = await mkdtemp(join(tmpdir(), "crust-entry-artifacts-test-"));
		tempDirs.push(directory);
		const entry = join(directory, "cli.ts");
		const outDir = join(directory, "dist");
		await writeFile(join(directory, "package.json"), '{"name":"demo"}');
		const skillsUrl = pathToFileURL(resolve(import.meta.dirname, "../../skills/src/index.ts")).href;
		const manUrl = pathToFileURL(resolve(import.meta.dirname, "../../man/src/index.ts")).href;
		await writeFile(
			entry,
			`import { Crust } from ${JSON.stringify(coreUrl)};\n` +
				`import { skill } from ${JSON.stringify(skillsUrl)};\n` +
				`import { man } from ${JSON.stringify(manUrl)};\n` +
				`await new Crust("demo", { description: "Demo" }).extend(skill({}), man()).execute();\n`,
		);

		// Run the entry subprocess from the fixture project root so advertised
		// sources are relative to that project.
		await buildEntrypoint(entry, outDir, [], io, directory);

		// The man hook runs after the skills hook and reads the skill it just wrote
		// into the build output, advertised relative to the project root.
		const manual = await readFile(join(outDir, "man", "demo.1"), "utf8");
		const packagedSkill = await readFile(join(outDir, "skills", "demo", "SKILL.md"), "utf8");
		expect(manual).toContain(`Source: ${join("dist", "skills", "demo")}`);
		expect(manual).not.toContain(directory);
		expect(packagedSkill).not.toContain(directory);
	});

	it("attributes Extension build failures", async () => {
		const directory = await mkdtemp(join(tmpdir(), "crust-entry-build-test-"));
		tempDirs.push(directory);
		const entry = join(directory, "cli.ts");
		await writeFile(
			entry,
			`import { Crust, defineExtension, defineExtensionId } from ${JSON.stringify(coreUrl)};\n` +
				`const broken = defineExtension(defineExtensionId("broken")).build(() => { throw new Error("disk full"); });\n` +
				`await new Crust("fixture").extend(broken).execute();\n`,
		);

		await expect(
			buildEntrypoint(entry, join(directory, "dist"), [], io, directory),
		).rejects.toThrow('Extension "broken" build failed: disk full');
	});

	it("explains when an entry exits without producing a snapshot", async () => {
		const directory = await mkdtemp(join(tmpdir(), "crust-entry-snapshot-test-"));
		tempDirs.push(directory);
		const entry = join(directory, "cli.ts");
		await writeFile(entry, "export {};\n");

		await expect(
			buildEntrypoint(entry, join(directory, "dist"), [], io, directory),
		).rejects.toThrow("Entry exited without producing a Command Snapshot");
	});

	it("explains when core produces a snapshot without a build report", async () => {
		const directory = await mkdtemp(join(tmpdir(), "crust-entry-report-test-"));
		tempDirs.push(directory);
		const entry = join(directory, "cli.ts");
		await writeFile(
			entry,
			`await Bun.write(process.env.CRUST_INTERNAL_SNAPSHOT_PATH!, JSON.stringify({ meta: { name: "old-core" } }));\n`,
		);

		await expect(
			buildEntrypoint(entry, join(directory, "dist"), [], io, directory),
		).rejects.toThrow("Command Snapshot without a Build Report");
	});

	it.each([
		null,
		{},
		{ extensions: {} },
		{ extensions: [null] },
		{ extensions: [{ id: 42, files: [] }] },
		{ extensions: [{ id: "legacy", files: "unknown" }] },
		{ extensions: [{ id: "legacy" }] },
		{ extensions: [{ id: "bad", files: [42] }] },
		{ extensions: [{ id: "", files: [] }] },
		{ extensions: [{ id: " padded ", files: [] }] },
		{ extensions: [{ id: "missing", files: ["missing.txt"] }] },
	])("rejects malformed or synthetic legacy reports: %j", async (report) => {
		const directory = await mkdtemp(join(tmpdir(), "crust-entry-report-test-"));
		tempDirs.push(directory);
		const entry = join(directory, "cli.ts");
		await writeFile(
			entry,
			`import { dirname, join } from "node:path";
			await Bun.write(process.env.CRUST_INTERNAL_SNAPSHOT_PATH!, JSON.stringify({ meta: { name: "fixture" } }));
			await Bun.write(join(dirname(process.env.CRUST_INTERNAL_SNAPSHOT_PATH!), "build-report.json"), ${JSON.stringify(JSON.stringify(report))});`,
		);
		await expect(
			buildEntrypoint(entry, join(directory, "dist"), [], io, directory),
		).rejects.toThrow(/invalid Build Report[\s\S]*compatible @crustjs\/core/);
	});

	it.each([
		"../outside.txt",
		"/outside.txt",
		"C:outside.txt",
		"assets/../present.txt",
		"assets\\present.txt",
		".",
		"directory",
		"linked.txt",
		"linked-dir/outside.txt",
	])("rejects unsafe or nonregular reported paths: %s", async (file) => {
		const directory = await mkdtemp(join(tmpdir(), "crust-entry-report-path-test-"));
		tempDirs.push(directory);
		const entry = join(directory, "cli.ts");
		await writeFile(
			entry,
			`import { mkdirSync, symlinkSync } from "node:fs";
			import { dirname, join } from "node:path";
			const outDir = process.env.CRUST_INTERNAL_BUILD_OUT_DIR!;
			mkdirSync(join(outDir, "directory"), { recursive: true });
			await Bun.write(join(outDir, "present.txt"), "present");
			await Bun.write(join(dirname(outDir), "outside.txt"), "outside");
			symlinkSync(join(dirname(outDir), "outside.txt"), join(outDir, "linked.txt"), "file");
			symlinkSync(dirname(outDir), join(outDir, "linked-dir"), "dir");
			await Bun.write(process.env.CRUST_INTERNAL_SNAPSHOT_PATH!, JSON.stringify({ meta: { name: "fixture" } }));
			await Bun.write(join(dirname(process.env.CRUST_INTERNAL_SNAPSHOT_PATH!), "build-report.json"), ${JSON.stringify(JSON.stringify({ extensions: [{ id: "fixture", files: [file] }] }))});`,
		);
		await expect(
			buildEntrypoint(entry, join(directory, "dist"), [], io, directory),
		).rejects.toThrow(/invalid Build Report[\s\S]*compatible @crustjs\/core/);
	});

	it("keeps reports scoped to hook output rather than all entry side effects", async () => {
		const directory = await mkdtemp(join(tmpdir(), "crust-entry-side-effect-test-"));
		tempDirs.push(directory);
		const entry = join(directory, "cli.ts");
		const outDir = join(directory, "dist");
		await writeFile(
			entry,
			`import { join } from "node:path";
			import { Crust, defineExtension, defineExtensionId } from ${JSON.stringify(coreUrl)};
			await Bun.write(join(process.env.CRUST_INTERNAL_BUILD_OUT_DIR!, "extra.txt"), "side effect");
			await new Crust("fixture").extend(defineExtension(defineExtensionId("fixture")).build(() => [{ path: "assets/real.txt", content: "hook output" }])).execute();`,
		);
		const result = await buildEntrypoint(entry, outDir, [], io, directory);
		expect(result.build.extensions[0]?.files).toEqual(["assets/real.txt"]);
		expect(await readFile(join(outDir, "extra.txt"), "utf8")).toBe("side effect");
	});

	it("preserves an executed hook's empty array report", async () => {
		const directory = await mkdtemp(join(tmpdir(), "crust-entry-empty-test-"));
		tempDirs.push(directory);
		const entry = join(directory, "cli.ts");
		await writeFile(
			entry,
			`import { Crust, defineExtension, defineExtensionId } from ${JSON.stringify(coreUrl)};
			await new Crust("fixture").extend(defineExtension(defineExtensionId("empty")).build(() => [])).execute();`,
		);
		const result = await buildEntrypoint(entry, join(directory, "dist"), [], io, directory);
		expect(result.build).toEqual({ extensions: [{ id: defineExtensionId("empty"), files: [] }] });
	});

	it("rethrows the entry's error when the subprocess exits non-zero", async () => {
		const directory = await mkdtemp(join(tmpdir(), "crust-entry-snapshot-test-"));
		tempDirs.push(directory);
		const entry = join(directory, "cli.ts");
		await writeFile(entry, `throw new Error("entry blew up before execute");\n`);

		await expect(
			buildEntrypoint(entry, join(directory, "dist"), [], io, directory),
		).rejects.toThrow("entry blew up before execute");
	});

	it("explains when the snapshot file contains invalid JSON", async () => {
		const directory = await mkdtemp(join(tmpdir(), "crust-entry-snapshot-test-"));
		tempDirs.push(directory);
		const entry = join(directory, "cli.ts");
		await writeFile(
			entry,
			`await Bun.write(process.env.CRUST_INTERNAL_SNAPSHOT_PATH!, "not json");\n`,
		);

		await expect(
			buildEntrypoint(entry, join(directory, "dist"), [], io, directory),
		).rejects.toThrow("Entry produced an invalid Command Snapshot");
	});

	describe("entry lifetime", () => {
		const pids: number[] = [];

		// Runs before the outer afterEach removes the fixture directories.
		afterEach(async () => {
			await reapBoundedProcesses();
			for (const pid of pids.splice(0)) {
				try {
					process.kill(pid, "SIGKILL");
				} catch {
					// Already exited.
				}
			}
		});

		/** Runs an entry that writes its hung PIDs, bounding the wait so a regression fails instead of hanging. */
		async function expectSnapshotTimeout(source: (pidFile: string) => string): Promise<number[]> {
			const directory = await mkdtemp(join(tmpdir(), "crust-entry-timeout-test-"));
			tempDirs.push(directory);
			const entry = join(directory, "cli.ts");
			const pidFile = join(directory, "pids.json");
			await writeFile(entry, source(pidFile));

			let outerTimer: NodeJS.Timeout | undefined;
			const outcome = await Promise.race([
				buildEntrypoint(entry, join(directory, "dist"), [], io, directory, undefined, 2_000).then(
					() => new Error("resolved"),
					(error: Error) => error,
				),
				new Promise<Error>((resolve) => {
					outerTimer = setTimeout(() => resolve(new Error("still pending")), 10_000);
				}),
			]).finally(() => clearTimeout(outerTimer));
			// SAFETY: the fixture writes a JSON array of its hung PIDs.
			const recorded = JSON.parse(await readFile(pidFile, "utf8")) as number[];
			pids.push(...recorded);

			expect(outcome.message).toContain("Command Snapshot preparation timed out after 2s.");
			return recorded;
		}

		it.skipIf(process.platform === "win32")(
			"reports an external signal with stderr rather than a timeout",
			async () => {
				const directory = await mkdtemp(join(tmpdir(), "crust-entry-signal-test-"));
				tempDirs.push(directory);
				const entry = join(directory, "cli.ts");
				await writeFile(
					entry,
					`console.error("before signal");\nprocess.kill(process.pid, "SIGKILL");\n`,
				);

				await expect(
					buildEntrypoint(entry, join(directory, "dist"), [], io, directory),
				).rejects.toThrow("Command Snapshot preparation was killed by SIGKILL.\nbefore signal");
			},
		);

		it("kills an entry that ignores SIGTERM", async () => {
			const recorded = await expectSnapshotTimeout(
				(pidFile) =>
					`process.on("SIGTERM", () => {});\n` +
					`await Bun.write(${JSON.stringify(pidFile)}, JSON.stringify([process.pid]));\n` +
					`setInterval(() => {}, 1_000);\n`,
			);

			expect(recorded).toHaveLength(1);
			await vi.waitFor(() => expect(recorded.filter(isRunning)).toEqual([]), { timeout: 5_000 });
		}, 20_000);

		it("stops waiting on a descendant that inherited stderr after the entry exited", async () => {
			const recorded = await expectSnapshotTimeout(
				(pidFile) =>
					`import { spawn } from "node:child_process";\n` +
					`const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1_000)"], { stdio: ["ignore", "ignore", "inherit"] });\n` +
					`await Bun.write(${JSON.stringify(pidFile)}, JSON.stringify([process.pid, descendant.pid]));\n` +
					`process.exit(0);\n`,
			);

			expect(recorded).toHaveLength(2);
			// Windows taskkill cannot reach a descendant whose parent already exited.
			const cleaned = process.platform === "win32" ? recorded.slice(0, 1) : recorded;
			await vi.waitFor(() => expect(cleaned.filter(isRunning)).toEqual([]), { timeout: 5_000 });
		}, 20_000);

		/** Prepares an entry that leaves a worker (holding no inherited pipe) in its group, then asserts the worker dies. */
		async function expectWorkerReaped(
			body: string,
			settle: (prepared: Promise<unknown>) => Promise<void>,
		) {
			const directory = await mkdtemp(join(tmpdir(), "crust-entry-worker-test-"));
			tempDirs.push(directory);
			const entry = join(directory, "cli.ts");
			const pidFile = join(directory, "pids.json");
			await writeFile(
				entry,
				`import { spawn } from "node:child_process";\n` +
					`import { writeFileSync } from "node:fs";\n` +
					`import { Crust } from ${JSON.stringify(coreUrl)};\n` +
					`const worker = spawn(process.execPath, ["-e", "setInterval(() => {}, 1_000)"], { stdio: "ignore" });\n` +
					`worker.unref();\n` +
					`writeFileSync(${JSON.stringify(pidFile)}, JSON.stringify([worker.pid]));\n` +
					body,
			);

			await settle(buildEntrypoint(entry, join(directory, "dist"), [], io, directory));
			// SAFETY: the entry writes its worker's PID as a JSON array.
			const recorded = JSON.parse(await readFile(pidFile, "utf8")) as number[];
			pids.push(...recorded);
			expect(recorded).toHaveLength(1);
			await vi.waitFor(() => expect(recorded.filter(isRunning)).toEqual([]), { timeout: 5_000 });
		}

		it.skipIf(process.platform === "win32")(
			"kills a worker left in the entry group after a successful preparation",
			async () => {
				await expectWorkerReaped(
					`await new Crust("fixture").action(() => {}).execute();\n`,
					async (prepared) => {
						expect(await prepared).toMatchObject({
							snapshot: { meta: { name: "fixture" } },
						});
					},
				);
			},
			20_000,
		);

		it.skipIf(process.platform === "win32")(
			"kills a worker left in the entry group after a failed preparation",
			async () => {
				await expectWorkerReaped(
					`throw new Error("entry failed after starting a worker");\n`,
					async (prepared) => {
						await expect(prepared).rejects.toThrow("entry failed after starting a worker");
					},
				);
			},
			20_000,
		);

		const helpersUrl = pathToFileURL(resolve(import.meta.dirname, "snapshot.ts")).href;

		/**
		 * Runs a host that prepares hung entries (each with a stderr-holding descendant),
		 * then interrupts itself as `mode` describes once all are alive. `concurrent`
		 * prepares two projects at once and sends SIGINT.
		 */
		async function runInterruptedHost(
			mode: "SIGINT" | "SIGTERM" | "SIGHUP" | "SIGQUIT" | "exit" | "listener" | "concurrent",
			{
				runtime = "bun",
				listenerSignal = "SIGINT",
			}: {
				runtime?: "bun" | "node";
				listenerSignal?: "SIGINT" | "SIGQUIT";
			} = {},
		) {
			const directory = await mkdtemp(join(tmpdir(), "crust-entry-interrupt-test-"));
			tempDirs.push(directory);
			const host = join(directory, "host.ts");
			const projects = (mode === "concurrent" ? ["first", "second"] : ["project"]).map((name) =>
				join(directory, name),
			);
			const pidFiles = projects.map((project) => join(project, "pids.json"));
			for (const [index, project] of projects.entries()) {
				const pidFile = pidFiles[index]!;
				await mkdir(project);
				await writeFile(
					join(project, "cli.ts"),
					`import { spawn } from "node:child_process";\n` +
						`import { renameSync, writeFileSync } from "node:fs";\n` +
						`const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1_000)"], { stdio: ["ignore", "ignore", "inherit"] });\n` +
						`writeFileSync(${JSON.stringify(`${pidFile}.tmp`)}, JSON.stringify([process.pid, descendant.pid]));\n` +
						`renameSync(${JSON.stringify(`${pidFile}.tmp`)}, ${JSON.stringify(pidFile)});\n` +
						`setInterval(() => {}, 1_000);\n`,
				);
			}
			await writeFile(
				host,
				`import { existsSync } from "node:fs";\n` +
					`import { join } from "node:path";\n` +
					`import { buildEntrypoint } from ${JSON.stringify(helpersUrl)};\n` +
					`const mode = ${JSON.stringify(mode)};\n` +
					`const listenerSignal = ${JSON.stringify(listenerSignal)};\n` +
					`if (mode === "listener") process.on(listenerSignal, () => console.log("host listener"));\n` +
					`const io = { stdout: () => {}, stderr: () => {} };\n` +
					`const prepared = ${JSON.stringify(projects)}.map((project) => buildEntrypoint(join(project, "cli.ts"), join(project, "dist"), [], io, project, undefined, 60_000));\n` +
					`const poll = setInterval(() => {\n` +
					`  if (!${JSON.stringify(pidFiles)}.every((pidFile) => existsSync(pidFile))) return;\n` +
					`  clearInterval(poll);\n` +
					`  if (mode === "exit") process.exit(3);\n` +
					`  process.kill(process.pid, mode === "listener" ? listenerSignal : mode === "concurrent" ? "SIGINT" : mode);\n` +
					`}, 20);\n` +
					`for (const preparation of prepared) {\n` +
					`  await preparation.catch((error) => console.log(error.message, ${JSON.stringify(lifetimeEvents)}.map((event) => process.listenerCount(event)).join()));\n` +
					`}\n` +
					`process.exit(0);\n`,
			);

			// SIGQUIT's default action dumps core (Bun's is gigabytes of reserved memory). Ubuntu's
			// systemd-coredump core_pattern passes a fixed 2^63 limit, and the kernel ignores
			// RLIMIT_CORE for piped patterns, so `ulimit -c 0` (kept for macOS and file patterns)
			// alone does not stop it. An empty coredump_filter keeps the Linux dump tiny.
			// `exec` keeps the host's own exit signal.
			const run = runBoundedProcess(
				"sh",
				[
					"-c",
					'ulimit -c 0; [ -w /proc/self/coredump_filter ] && echo 0 > /proc/self/coredump_filter; exec "$0" "$1"',
					runtime === "node" ? process.execPath : "bun",
					host,
				],
				{ cwd: directory, timeout: 15_000 },
			);
			// Recorded even when the host fails, so teardown still kills the entry groups.
			await run.catch(() => {});
			const recorded: number[] = [];
			for (const pidFile of pidFiles) {
				// SAFETY: each entry writes its own and its descendant's PIDs as a JSON array.
				recorded.push(
					...(JSON.parse(await readFile(pidFile, "utf8").catch(() => "[]")) as number[]),
				);
			}
			pids.push(...recorded);
			const result = await run;
			expect(recorded).toHaveLength(2 * projects.length);
			await vi.waitFor(() => expect(recorded.filter(isRunning)).toEqual([]), { timeout: 5_000 });
			return result;
		}

		it.skipIf(process.platform === "win32").each([
			["bun", "SIGINT"],
			["bun", "SIGTERM"],
			["bun", "SIGHUP"],
			["bun", "SIGQUIT"],
			["node", "SIGQUIT"],
		] as const)(
			"kills the entry group and keeps default termination when the %s host gets %s",
			async (runtime, signal) => {
				const result = await runInterruptedHost(signal, { runtime });

				expect(result).toMatchObject({ exitCode: null, signal, stdout: "" });
			},
			20_000,
		);

		it.skipIf(process.platform === "win32")(
			"kills the entry group when the host exits synchronously",
			async () => {
				expect(await runInterruptedHost("exit")).toMatchObject({ exitCode: 3, signal: null });
			},
			20_000,
		);

		it.skipIf(process.platform === "win32").each(["SIGINT", "SIGQUIT"] as const)(
			"kills the entry group and leaves an existing Bun host %s listener in charge",
			async (signal) => {
				const result = await runInterruptedHost("listener", { listenerSignal: signal });

				expect(result).toMatchObject({ exitCode: 0, signal: null });
				// The host listener still ran and remains the only lifetime listener.
				expect(result.stdout).toBe(
					`host listener\nCommand Snapshot preparation was interrupted by ${signal}. ${signal === "SIGINT" ? "1,0,0,0,0" : "0,0,0,1,0"}\n`,
				);
			},
			20_000,
		);

		it.skipIf(process.platform === "win32")(
			"kills concurrent preparations of different projects and still terminates by SIGINT",
			async () => {
				// Each preparation defers to the other's listener; the last one re-raises.
				const result = await runInterruptedHost("concurrent");

				expect(result).toMatchObject({ exitCode: null, signal: "SIGINT", stdout: "" });
			},
			20_000,
		);
	});
});
