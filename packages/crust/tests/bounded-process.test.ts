import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { reapBoundedProcesses, runBoundedProcess } from "./bounded-process.ts";

const roots: string[] = [];

afterEach(async () => {
	await reapBoundedProcesses();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A hung child whose hung grandchild inherits its stdout; writes both PIDs to a file. */
function startHungTree(timeout: number) {
	const root = mkdtempSync(join(tmpdir(), "bounded-process-"));
	roots.push(root);
	const pidFile = join(root, "pids.json");
	const source = `
		const { spawn } = require("node:child_process");
		const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "inherit" });
		require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, JSON.stringify([process.pid, grandchild.pid]));
		setInterval(() => {}, 1000);
	`;
	const result = runBoundedProcess(process.execPath, ["-e", source], { timeout });
	// Attached now so the expected rejection is never reported as unhandled.
	const settled = result.catch((error: Error) => error);
	return { pidFile, settled };
}

function isRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		if (process.platform === "linux") {
			// A non-reaping container init can retain terminated children as zombies.
			const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
			return stat[stat.lastIndexOf(")") + 2] !== "Z";
		}
		return true;
	} catch (error) {
		// SAFETY: process.kill and readFileSync throw errno exceptions.
		const code = (error as NodeJS.ErrnoException).code;
		return code !== "ESRCH" && code !== "ENOENT";
	}
}

async function expectKilled(pidFile: string): Promise<void> {
	// SAFETY: the hung child wrote a [childPid, grandchildPid] JSON array.
	const pids = JSON.parse(readFileSync(pidFile, "utf8")) as number[];
	expect(pids).toHaveLength(2);
	await vi.waitFor(() => expect(pids.filter(isRunning)).toEqual([]), { timeout: 5_000 });
}

describe("runBoundedProcess", () => {
	it("kills the child and its descendants at the deadline", async () => {
		const { pidFile, settled } = startHungTree(1_000);

		expect(await settled).toMatchObject({
			message: expect.stringContaining("timed out after 1000ms"),
		});
		await expectKilled(pidFile);
	}, 15_000);

	it("reapBoundedProcesses kills children still running at teardown", async () => {
		const { pidFile, settled } = startHungTree(60_000);
		await vi.waitFor(() => readFileSync(pidFile), { timeout: 5_000 });
		// SAFETY: the fixture writes its child and grandchild PIDs.
		const pids = JSON.parse(readFileSync(pidFile, "utf8")) as number[];
		expect(pids).toHaveLength(2);
		expect(pids.filter(isRunning)).toEqual(pids);

		await reapBoundedProcesses();

		expect(await settled).toMatchObject({
			message: expect.stringContaining("was killed during test teardown"),
		});
		await expectKilled(pidFile);
	}, 15_000);
});
