import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, expect, it } from "vite-plus/test";

// Store mutations hold an advisory lock file across processes: parallel CLI
// invocations (`for i in …; do cli add & done`) must not lose updates.

const storeEntry = pathToFileURL(resolve(import.meta.dirname, "../src/index.ts")).href;
const persistenceEntry = pathToFileURL(resolve(import.meta.dirname, "../src/persistence.ts")).href;
const workDir = mkdtempSync(join(tmpdir(), "crust-store-processes-"));

afterAll(() => rmSync(workDir, { recursive: true, force: true }));

const CHILD_SOURCE = `import { createStore } from ${JSON.stringify(storeEntry)};
const [dirPath, id] = process.argv.slice(2);
const store = createStore({
	dirPath,
	name: "notes",
	fields: { notes: { type: "string", array: true, default: [] } },
});
await store.update((current) => ({ notes: [...current.notes, id] }));
`;

// Appends `id` to `<dir>/list.json` under the lock after holding it for `holdMs`.
// With `wait`, it prints "ready" and starts only once stdin closes, so the test can
// release many children at the same instant; it prints "locked" once it holds the lock.
const LOCK_CHILD_SOURCE = `import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withFileLock } from ${JSON.stringify(persistenceEntry)};
const [dir, id, holdMs, staleMs, wait] = process.argv.slice(2);
if (wait) {
	process.stdout.write("ready\\n");
	await new Promise((resolve) => process.stdin.on("data", () => {}).once("end", resolve));
}
const file = join(dir, "list.json");
await withFileLock(file, async () => {
	process.stdout.write("locked\\n");
	let list = [];
	try { list = JSON.parse(readFileSync(file, "utf-8")); } catch {}
	await new Promise((resolve) => setTimeout(resolve, Number(holdMs)));
	writeFileSync(file, JSON.stringify([...list, id]));
}, { operation: "write", staleMs: Number(staleMs) });
`;

// Holds the lock, then blocks its event loop for `freezeMs` (a suspended or frozen
// process: no heartbeat) before writing `{ id }` to `<dir>/doc.json`.
const FROZEN_CHILD_SOURCE = `import { join } from "node:path";
import { withFileLock, writeJson } from ${JSON.stringify(persistenceEntry)};
const [dir, id, freezeMs] = process.argv.slice(2);
const file = join(dir, "doc.json");
await withFileLock(file, async (assertOwned) => {
	process.stdout.write("locked\\n");
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(freezeMs));
	await writeJson(file, { id }, { beforeCommit: assertOwned });
}, { operation: "write", staleMs: 300 });
`;

function runChild(
	script: string,
	args: readonly string[],
	onSpawn?: (child: ChildProcess) => void,
): Promise<void> {
	return new Promise((resolvePromise, reject) => {
		const child = spawn("bun", [script, ...args], { timeout: 60_000 });
		onSpawn?.(child);
		let stderr = "";
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.once("error", reject);
		child.once("close", (code) => {
			if (code === 0) resolvePromise();
			else reject(new Error(`child ${args.join(" ")} exited ${code}:\n${stderr}`));
		});
	});
}

it("keeps every update from 21 parallel processes", { timeout: 90_000 }, async () => {
	const script = join(workDir, "append.ts");
	writeFileSync(script, CHILD_SOURCE);
	const ids = Array.from({ length: 21 }, (_, index) => `p${index}`);

	await Promise.all(ids.map((id) => runChild(script, [workDir, id])));

	const { notes } = JSON.parse(readFileSync(join(workDir, "notes.json"), "utf-8")) as {
		notes: string[];
	};
	expect(notes.toSorted()).toEqual(ids.toSorted());
});

function waitForLine(child: ChildProcess, line: string): Promise<void> {
	return new Promise((resolvePromise) => {
		let stdout = "";
		child.stdout?.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
			if (stdout.split("\n").includes(line)) resolvePromise();
		});
	});
}

function readList(dir: string): string[] {
	return JSON.parse(readFileSync(join(dir, "list.json"), "utf-8")) as string[];
}

it("keeps a live holder's lock past the stale threshold", { timeout: 60_000 }, async () => {
	const dir = join(workDir, "slow-holder");
	mkdirSync(dir);
	const script = join(workDir, "lock.ts");
	writeFileSync(script, LOCK_CHILD_SOURCE);

	// The slow holder sleeps through five stale thresholds; the fast one must wait for it.
	let locked: Promise<void> | undefined;
	const slow = runChild(script, [dir, "slow", "1500", "300"], (child) => {
		locked = waitForLine(child, "locked");
	});
	await locked;
	const fast = runChild(script, [dir, "fast", "0", "300"]);

	await Promise.all([slow, fast]);
	expect(readList(dir)).toEqual(["slow", "fast"]);
});

it(
	"fails a frozen holder's write once another process took its lock",
	{ timeout: 60_000 },
	async () => {
		const dir = join(workDir, "frozen-holder");
		mkdirSync(dir);
		const script = join(workDir, "frozen.ts");
		writeFileSync(script, FROZEN_CHILD_SOURCE);

		let locked: Promise<void> | undefined;
		const frozen = runChild(script, [dir, "frozen", "1500"], (child) => {
			locked = waitForLine(child, "locked");
		});
		await locked;
		const successor = runChild(script, [dir, "successor", "0"]);

		await expect(frozen).rejects.toThrow(/Lost the lock on store file/);
		await successor;
		expect(JSON.parse(readFileSync(join(dir, "doc.json"), "utf-8"))).toEqual({ id: "successor" });
	},
);

it("recovers a dead owner's lock once among 20 racing processes", { timeout: 90_000 }, async () => {
	const script = join(workDir, "lock.ts");
	writeFileSync(script, LOCK_CHILD_SOURCE);

	for (let round = 0; round < 3; round++) {
		const dir = join(workDir, `dead-owner-${round}`);
		mkdirSync(dir);
		writeFileSync(
			join(dir, "list.json.lock"),
			JSON.stringify({ pid: 2 ** 31 - 2, host: hostname(), token: "dead" }),
		);
		const ids = Array.from({ length: 20 }, (_, index) => `p${index}`);
		const children: ChildProcess[] = [];
		const ready: Promise<void>[] = [];
		const done = ids.map((id) =>
			runChild(script, [dir, id, "30", "10000", "wait"], (child) => {
				children.push(child);
				ready.push(waitForLine(child, "ready"));
			}),
		);
		await Promise.all(ready);
		for (const child of children) child.stdin?.end();

		await Promise.all(done);
		expect(readList(dir).toSorted()).toEqual(ids.toSorted());
	}
});
