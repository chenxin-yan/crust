/**
 * @module-tag windows
 * @module-tag macos
 */
import { type ChildProcessWithoutNullStreams, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { createStore } from "../src/index.ts";

// A strict store never takes a lock from a process that may still run: these tests suspend or
// kill real Node and Bun processes inside a mutation. Killing a process shows crash atomicity,
// not power-loss durability; `src/lock.test.ts` asserts the flush order.

const storeEntry = pathToFileURL(resolve(import.meta.dirname, "../src/index.ts")).href;
const workDir = mkdtempSync(join(tmpdir(), "crust-store-strict-"));
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

/** No process has this pid: `process.kill(pid, 0)` fails with `ESRCH`. */
const MISSING_PID = 2 ** 31 - 2;

// Appends its id to the store under a strict lock. `<kind>:<point>` makes it stop there:
// `stop` suspends itself (SIGSTOP), `hang` waits until killed, `gate` waits for `<dir>/go`.
// It patches node:fs/promises before importing the store, so the store's own calls pause.
const CHILD_SOURCE = `import { existsSync, writeSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
const [dirPath, id, pause = "", timeout = "40000"] = process.argv.slice(2);
const [kind, point] = pause.split(":");
const storeFile = join(dirPath, "notes.json");
let reached = false;
async function at(name) {
	if (reached || name !== point) return;
	reached = true;
	writeSync(1, name + "\\n");
	if (kind === "stop") process.kill(process.pid, "SIGSTOP");
	if (kind === "hang") await new Promise(() => setInterval(() => {}, 1000));
	while (kind === "gate" && !existsSync(join(dirPath, "go"))) await new Promise((r) => setTimeout(r, 10));
}
const fs = createRequire(import.meta.url)("node:fs/promises");
const { readFile, chmod, rename, open } = fs;
fs.readFile = async (path, ...rest) => {
	if (String(path) !== storeFile) return readFile(path, ...rest);
	await at("acquired");
	const text = await readFile(path, ...rest);
	await at("read");
	return text;
};
fs.chmod = async (path, ...rest) => {
	if (String(path).endsWith(".tmp")) await at("temp-written");
	return chmod(path, ...rest);
};
fs.rename = async (...args) => {
	await at("rename");
	return rename(...args);
};
fs.open = async (path, flags, ...rest) => {
	if (String(path).endsWith(".recover") && flags === "wx") await at("recover");
	return open(path, flags, ...rest);
};
syncBuiltinESMExports();
const { createStore } = await import(${JSON.stringify(storeEntry)});
const store = createStore({
	dirPath,
	name: "notes",
	fields: { notes: { type: "string", array: true, default: [] } },
	strict: true,
	lockTimeout: Number(timeout),
});
await store.update((current) => ({ notes: [...current.notes, id] }));
`;
const childScript = join(workDir, "child.mjs");
writeFileSync(childScript, CHILD_SOURCE);

const RUNTIMES = [
	["Node", process.execPath],
	["Bun", "bun"],
] as const;

interface Child {
	process: ChildProcessWithoutNullStreams;
	/** Resolves when the child prints `line`. */
	printed(line: string): Promise<void>;
	/** Resolves with the exit code; rejects with stderr when it is not 0. */
	exited(): Promise<void>;
}

function startChild(runtime: string, args: string[]): Child {
	const child = spawn(runtime, [childScript, ...args], { timeout: 60_000 });
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (chunk: Buffer) => {
		stdout += chunk.toString();
	});
	child.stderr.on("data", (chunk: Buffer) => {
		stderr += chunk.toString();
	});
	const closed = once(child, "close") as Promise<[number | null, string | null]>;
	return {
		process: child,
		printed: async (line) => {
			while (!stdout.split("\n").includes(line)) {
				if (child.exitCode !== null || child.signalCode === "SIGKILL") {
					throw new Error(`child exited before printing ${line}:\n${stderr}`);
				}
				await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
			}
		},
		exited: async () => {
			const [code, signal] = await closed;
			if (code !== 0) throw new Error(`child exited ${code ?? signal}:\n${stderr}`);
		},
	};
}

let dirPath: string;
let caseCount = 0;
beforeEach(() => {
	dirPath = join(workDir, `case-${caseCount++}`);
	mkdirSync(dirPath, { mode: 0o700 });
});

const notesStore = (timeout: number) =>
	createStore({
		dirPath,
		name: "notes",
		fields: { notes: { type: "string", array: true, default: [] } },
		strict: true,
		lockTimeout: timeout,
	});
const notes = (): string[] =>
	(JSON.parse(readFileSync(join(dirPath, "notes.json"), "utf-8")) as { notes: string[] }).notes;

// The premises of the macOS and Windows dead-owner rule and of the Windows symlink refusal,
// checked on every CI host for both runtimes.
describe("platform premises", () => {
	it("process.kill(pid, 0) fails with ESRCH for a missing pid on Node", () => {
		expect(() => process.kill(MISSING_PID, 0)).toThrow(expect.objectContaining({ code: "ESRCH" }));
	});

	it("process.kill(pid, 0) fails with ESRCH for a missing pid on Bun", () => {
		const result = spawnSync(
			"bun",
			[
				"-e",
				`try { process.kill(${MISSING_PID}, 0); console.log("alive") } catch (e) { console.log(e.code) }`,
			],
			{ encoding: "utf-8", timeout: 30_000 },
		);
		expect(result.stdout.trim()).toBe("ESRCH");
	});

	it.runIf(process.platform === "win32")(
		"lstat reports a junction as a symbolic link on Node and Bun",
		() => {
			const script = `const fs = require("node:fs");
fs.mkdirSync(${JSON.stringify(join(dirPath, "target"))});
const link = ${JSON.stringify(join(dirPath, "junction"))};
fs.symlinkSync(${JSON.stringify(join(dirPath, "target"))}, link, "junction");
console.log(fs.lstatSync(link).isSymbolicLink());
fs.rmSync(link);
fs.rmSync(${JSON.stringify(join(dirPath, "target"))}, { recursive: true });`;
			for (const runtime of [process.execPath, "bun"]) {
				const result = spawnSync(runtime, ["-e", script], { encoding: "utf-8", timeout: 30_000 });
				expect(`${runtime}: ${result.stdout.trim()}${result.stderr}`).toBe(`${runtime}: true`);
			}
		},
	);
});

describe.each(RUNTIMES)("a %s holder", (_name, runtime) => {
	describe.skipIf(process.platform === "win32")("suspended inside its mutation", () => {
		it.each(["acquired", "read", "temp-written", "rename"])(
			"keeps its lock when paused %s: the waiter fails at its deadline and writes nothing",
			{ timeout: 30_000 },
			async (point) => {
				await notesStore(5_000).update(() => ({ notes: ["seed"] }));
				const holder = startChild(runtime, [dirPath, "holder", `stop:${point}`]);
				try {
					await holder.printed(point);
					const files = readdirSync(dirPath).toSorted();

					const error = await notesStore(1_000)
						.update((current) => ({ notes: [...current.notes, "waiter"] }))
						.catch((err: unknown) => err);

					expect(error).toMatchObject({
						code: "LOCK",
						details: { verdict: "alive", owner: { pid: holder.process.pid } },
					});
					expect(notes()).toEqual(["seed"]);
					expect(readdirSync(dirPath).toSorted()).toEqual(files);
				} finally {
					holder.process.kill("SIGCONT");
				}
				await holder.exited();
				expect(notes()).toEqual(["seed", "holder"]);
				expect(readdirSync(dirPath)).toEqual(["notes.json"]);
			},
		);
	});

	it("is taken over once killed, and its mutation never lands", { timeout: 30_000 }, async () => {
		await notesStore(5_000).update(() => ({ notes: ["seed"] }));
		const holder = startChild(runtime, [dirPath, "holder", "hang:read"]);
		await holder.printed("read");
		holder.process.kill("SIGKILL");
		await once(holder.process, "close");
		expect(readdirSync(dirPath)).toContain("notes.json.lock");

		await notesStore(5_000).update((current) => ({ notes: [...current.notes, "waiter"] }));

		expect(notes()).toEqual(["seed", "waiter"]);
		expect(readdirSync(dirPath)).toEqual(["notes.json"]);
	});

	it(
		"has two waiters on its dead lock recover it one at a time, with no lost update",
		{ timeout: 60_000 },
		async () => {
			await notesStore(5_000).update(() => ({ notes: ["seed"] }));
			const holder = startChild(runtime, [dirPath, "holder", "hang:read"]);
			await holder.printed("read");
			holder.process.kill("SIGKILL");
			await once(holder.process, "close");

			const waiters = ["a", "b"].map((id) =>
				startChild(runtime, [dirPath, id, "gate:recover", "30000"]),
			);
			// Both judged the owner dead and stand right before taking `.recover`.
			await Promise.all(waiters.map((waiter) => waiter.printed("recover")));
			writeFileSync(join(dirPath, "go"), "");
			await Promise.all(waiters.map((waiter) => waiter.exited()));

			expect(notes().toSorted()).toEqual(["a", "b", "seed"]);
			expect(readdirSync(dirPath).toSorted()).toEqual(["go", "notes.json"]);
		},
	);
});
