import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, expect, it } from "vite-plus/test";

import { createStore } from "../src/index.ts";

// Store mutations hold an advisory lock file across processes: parallel CLI
// invocations (`for i in …; do cli add & done`) must not lose updates.

const storeEntry = pathToFileURL(resolve(import.meta.dirname, "../src/index.ts")).href;
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

// Prints "locked" from inside a mutation that then never finishes.
const HOLDER_SOURCE = `import { createStore } from ${JSON.stringify(storeEntry)};
const store = createStore({
	dirPath: process.argv[2],
	name: "held",
	fields: {
		n: {
			type: "number",
			default: 0,
			validate: async () => {
				process.stdout.write("locked\\n");
				await new Promise((resolve) => setTimeout(resolve, 60_000));
			},
		},
	},
});
await store.patch({ n: 1 });
`;

function runChild(script: string, id: string): Promise<string> {
	return new Promise((resolvePromise, reject) => {
		const child = spawn("bun", [script, workDir, id], { timeout: 60_000 });
		let stderr = "";
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.once("error", reject);
		child.once("close", (code) => {
			if (code === 0) resolvePromise(id);
			else reject(new Error(`child ${id} exited ${code}:\n${stderr}`));
		});
	});
}

it("keeps every update from 21 parallel processes", { timeout: 90_000 }, async () => {
	const script = join(workDir, "append.ts");
	writeFileSync(script, CHILD_SOURCE);
	const ids = Array.from({ length: 21 }, (_, index) => `p${index}`);

	await Promise.all(ids.map((id) => runChild(script, id)));

	const { notes } = JSON.parse(readFileSync(join(workDir, "notes.json"), "utf-8")) as {
		notes: string[];
	};
	expect(notes.toSorted()).toEqual(ids.toSorted());
});

it(
	"takes over the lock of a process killed mid-mutation at once",
	{ timeout: 30_000 },
	async () => {
		const script = join(workDir, "hold.ts");
		writeFileSync(script, HOLDER_SOURCE);
		const holder = spawn("bun", [script, workDir], { stdio: ["ignore", "pipe", "inherit"] });
		await once(holder.stdout, "data");
		holder.kill("SIGKILL");
		await once(holder, "close");
		expect(readdirSync(workDir)).toContain("held.json.lock");

		const store = createStore({
			dirPath: workDir,
			name: "held",
			fields: { n: { type: "number", default: 0 } },
		});
		const start = Date.now();
		expect(await store.patch({ n: 2 })).toEqual({ n: 2 });

		// Far sooner than the 10 seconds a lock of unknown origin is waited on.
		expect(Date.now() - start).toBeLessThan(5_000);
		expect(readdirSync(workDir)).not.toContain("held.json.lock");
	},
);
