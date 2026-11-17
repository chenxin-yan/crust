/**
 * @module-tag windows
 * @module-tag macos
 */
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chmod, mkdir, readdir, rm, stat, symlink } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join, sep } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { withLock } from "./lock.ts";
import { createStore } from "./store.ts";

// Durability-relevant fs calls in order, as `<call> <path>`.
const fsTrace = vi.hoisted((): string[] => []);
// Error codes the next `sync` of a handle opened on the keyed path fails with.
const syncFailures = vi.hoisted(() => new Map<string, string>());
// Runs while `lstat` of the keyed path is in flight, whether it succeeds or fails.
const duringLstat = vi.hoisted(() => new Map<string, () => void>());
// Error codes the next `close` of a handle opened on the keyed path fails with, after closing.
const closeFailures = vi.hoisted(() => new Map<string, string>());
// How many of the next `rm` calls on the keyed path fail with `EBUSY`.
const rmFailures = vi.hoisted(() => new Map<string, number>());
// Paths whose `readFile` fails with `EACCES`.
const unreadable = vi.hoisted(() => new Set<string>());
vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	const lstat: typeof actual.lstat = (async (path: string, options?: never) => {
		fsTrace.push(`lstat ${path}`);
		try {
			return await actual.lstat(path, options);
		} finally {
			duringLstat.get(path)?.();
		}
	}) as typeof actual.lstat;
	const chmod: typeof actual.chmod = async (path, mode) => {
		fsTrace.push(`chmod ${String(path)}`);
		return actual.chmod(path, mode);
	};
	const rename: typeof actual.rename = async (from, to) => {
		fsTrace.push(`rename ${String(to)}`);
		return actual.rename(from, to);
	};
	const rm: typeof actual.rm = async (path, options) => {
		fsTrace.push(`rm ${String(path)}`);
		const failures = rmFailures.get(String(path)) ?? 0;
		if (failures > 0) {
			rmFailures.set(String(path), failures - 1);
			throw Object.assign(new Error("EBUSY"), { code: "EBUSY" });
		}
		return actual.rm(path, options);
	};
	const readFile = (async (path: string, options?: never) => {
		if (unreadable.has(path)) {
			throw Object.assign(new Error("EACCES"), { code: "EACCES" });
		}
		return actual.readFile(path, options);
	}) as typeof actual.readFile;
	const open = async (...args: Parameters<typeof actual.open>) => {
		const path = String(args[0]);
		const handle = await actual.open(...args);
		fsTrace.push(`open ${path} ${String(args[1] ?? "r")}`);
		const { close, sync, writeFile } = handle;
		handle.close = async () => {
			await close.apply(handle);
			const code = closeFailures.get(path);
			closeFailures.delete(path);
			if (code !== undefined) throw Object.assign(new Error(code), { code });
		};
		handle.writeFile = (...writeArgs) => {
			fsTrace.push(`write ${path}`);
			return writeFile.apply(handle, writeArgs);
		};
		handle.sync = async () => {
			fsTrace.push(`sync ${path}`);
			const code = syncFailures.get(path);
			syncFailures.delete(path);
			if (code !== undefined) throw Object.assign(new Error(code), { code });
			return sync.apply(handle);
		};
		return handle;
	};
	const mocked = { lstat, chmod, rename, rm, readFile, open };
	return { ...actual, ...mocked, default: { ...actual, ...mocked } };
});

/** No process has this pid: `process.kill(pid, 0)` fails with `ESRCH`. */
const MISSING_PID = 2 ** 31 - 2;

let dir: string;
let path: string;
let lockPath: string;

beforeEach(async () => {
	// The parent is the test's own: a strict lock refuses a directory others can enter.
	dir = join(tmpdir(), `crust-store-lock-${randomUUID()}`);
	await mkdir(dir, { mode: 0o700 });
	await chmod(dir, 0o700);
	path = join(dir, "doc.json");
	lockPath = `${path}.lock`;
});

afterEach(async () => {
	vi.restoreAllMocks();
	duringLstat.clear();
	closeFailures.clear();
	rmFailures.clear();
	unreadable.clear();
	await rm(dir, { recursive: true, force: true });
});

/** The record this process writes for a lock it holds right now. */
async function ownRecord(): Promise<Record<string, unknown>> {
	return withLock(path, async () => JSON.parse(readFileSync(lockPath, "utf-8")));
}

/** A lock record of this process with `changes` applied, written at `file`. Takes the lock to learn the record. */
async function writeRecord(file: string, changes: Record<string, unknown>): Promise<string> {
	const record = JSON.stringify({ ...(await ownRecord()), ownerId: randomUUID(), ...changes });
	writeFileSync(file, record);
	return record;
}

/** Holds the lock until the returned `release` is called. */
async function holdLock(): Promise<() => Promise<void>> {
	let release!: () => void;
	let acquired!: () => void;
	const held = new Promise<void>((resolve) => {
		acquired = resolve;
	});
	const done = withLock(
		path,
		() =>
			new Promise<void>((resolve) => {
				release = resolve;
				acquired();
			}),
	);
	await held;
	return async () => {
		release();
		await done;
	};
}

/** Runs `withLock` with a short deadline and returns the error it fails with. */
async function lockError(options: { signal?: AbortSignal; timeout?: number } = {}) {
	const fn = vi.fn(async () => {});
	const error = await withLock(path, fn, { timeout: 300, ...options }).catch((err: unknown) => err);
	expect(fn).not.toHaveBeenCalled();
	return error;
}

describe("withLock", () => {
	it("holds `<path>.lock` with the owner's record while `fn` runs and removes it after", async () => {
		const record = await ownRecord();

		expect(record).toEqual({
			ownerId: expect.any(String),
			pid: process.pid,
			host: hostname(),
			platform: process.platform,
			createdAt: expect.any(String),
			machineId: process.platform === "linux" ? expect.any(String) : null,
			bootId: process.platform === "linux" ? expect.any(String) : null,
			pidNamespace: process.platform === "linux" ? expect.stringMatching(/^pid:\[\d+\]$/) : null,
			startTime: process.platform === "linux" ? expect.stringMatching(/^\d+$/) : null,
		});
		expect(await readdir(dir)).toEqual([]);
	});

	it.skipIf(process.platform === "win32")("creates the lock file owner-only", async () => {
		const mode = await withLock(path, async () => (await stat(lockPath)).mode & 0o777);
		expect(mode).toBe(0o600);
	});

	it("never takes a live owner's lock: fails with LOCK at its deadline and leaves it", async () => {
		const release = await holdLock();
		const held = readFileSync(lockPath, "utf-8");
		try {
			const start = Date.now();
			const error = await lockError({ timeout: 300 });

			expect(Date.now() - start).toBeGreaterThanOrEqual(290);
			expect(error).toMatchObject({
				code: "LOCK",
				details: {
					path: lockPath,
					verdict: "alive",
					owner: { pid: process.pid, host: hostname(), platform: process.platform },
					manualStep: expect.stringContaining(`delete ${lockPath}`),
				},
			});
			expect(readFileSync(lockPath, "utf-8")).toBe(held);
		} finally {
			await release();
		}
	});

	it("keeps its deadline when the system clock moves back while it waits", async () => {
		const release = await holdLock();
		try {
			const now = Date.now();
			setTimeout(() => vi.spyOn(Date, "now").mockReturnValue(now - 3_600_000), 50);
			const start = performance.now();

			expect(await lockError({ timeout: 300 })).toMatchObject({ code: "LOCK" });
			expect(performance.now() - start).toBeLessThan(2_000);
		} finally {
			await release();
		}
	});

	it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
		"rejects a timeout of %s with DEFINITION and creates nothing",
		async (timeout) => {
			expect(await lockError({ timeout })).toMatchObject({ code: "DEFINITION" });
			expect(await readdir(dir)).toEqual([]);
		},
	);

	it("takes over the lock of an owner whose process is gone", async () => {
		await writeRecord(lockPath, { pid: MISSING_PID });

		const ran = await withLock(path, async () => true, { timeout: 2_000 });

		expect(ran).toBe(true);
		expect(await readdir(dir)).toEqual([]);
	});

	it("lets two waiters on a dead owner's lock hold it one at a time", async () => {
		await writeRecord(lockPath, { pid: MISSING_PID });
		let holders = 0;
		const overlaps: number[] = [];
		const critical = async () => {
			holders++;
			overlaps.push(holders);
			await new Promise((resolve) => setTimeout(resolve, 20));
			holders--;
		};

		await Promise.all([withLock(path, critical), withLock(path, critical)]);

		expect(overlaps).toEqual([1, 1]);
		expect(await readdir(dir)).toEqual([]);
	});

	// A waiter judges the owner dead; before it re-reads under `.recover`, another waiter has
	// recovered that lock and a successor holds the path.
	it("never removes a successor's lock", async () => {
		const successor = JSON.stringify({ ...(await ownRecord()), ownerId: randomUUID() });
		await writeRecord(lockPath, { pid: MISSING_PID });
		const kill = process.kill.bind(process);
		vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
			if (pid === MISSING_PID && !existsSync(`${lockPath}.recover`)) {
				writeFileSync(lockPath, successor);
			}
			return kill(pid, signal);
		});

		const error = await lockError();

		expect(error).toMatchObject({ code: "LOCK", details: { path: lockPath, verdict: "alive" } });
		expect(readFileSync(lockPath, "utf-8")).toBe(successor);
		expect(existsSync(`${lockPath}.recover`)).toBe(false);
	});

	it.each([
		["empty", ""],
		["unparsable", "{"],
		["incomplete", JSON.stringify({ pid: MISSING_PID })],
	])("never takes over an %s record", async (_kind, content) => {
		writeFileSync(lockPath, content);

		expect(await lockError()).toMatchObject({
			code: "LOCK",
			details: { path: lockPath, verdict: "unknown", owner: undefined },
		});
		expect(readFileSync(lockPath, "utf-8")).toBe(content);
	});

	it("never takes over a record from another platform", async () => {
		const platform = process.platform === "linux" ? "darwin" : "linux";
		const record = await writeRecord(lockPath, { pid: MISSING_PID, platform });

		expect(await lockError()).toMatchObject({
			code: "LOCK",
			details: { verdict: "unknown", owner: { platform } },
		});
		expect(readFileSync(lockPath, "utf-8")).toBe(record);
	});

	describe.runIf(process.platform === "linux")("on Linux", () => {
		it("judges a live pid whose start time cannot be read as unknown", async () => {
			await writeRecord(lockPath, {});
			unreadable.add(`/proc/${process.pid}/stat`);

			expect(await lockError()).toMatchObject({ code: "LOCK", details: { verdict: "unknown" } });
		});

		it("takes over a lock whose pid now belongs to another process", async () => {
			await writeRecord(lockPath, { pid: process.pid, startTime: "1" });

			expect(await withLock(path, async () => true, { timeout: 2_000 })).toBe(true);
		});

		it.each([
			["machine id", { machineId: "0".repeat(32) }],
			["boot id", { bootId: randomUUID() }],
			["PID namespace", { pidNamespace: "pid:[1]" }],
			["missing machine id", { machineId: null }],
			["missing start time", { startTime: null }],
		])("never takes over a record with another %s", async (_field, changes) => {
			const record = await writeRecord(lockPath, { pid: MISSING_PID, ...changes });

			expect(await lockError()).toMatchObject({
				code: "LOCK",
				details: { verdict: "unknown" },
			});
			expect(readFileSync(lockPath, "utf-8")).toBe(record);
		});
	});

	// The macOS and Windows rule, exercised on any host; the CI jobs on those hosts run it natively.
	// Not macOS on a Windows host: POSIX directory checks cannot pass on a Windows directory.
	const pidRulePlatforms = process.platform === "win32" ? ["win32"] : ["darwin", "win32"];
	describe.each(pidRulePlatforms)("with the %s rule", (platform) => {
		const actualPlatform = process.platform;
		beforeEach(() => {
			Object.defineProperty(process, "platform", { value: platform });
		});
		afterEach(() => {
			Object.defineProperty(process, "platform", { value: actualPlatform });
		});

		it("takes over a same-host lock whose process is gone", async () => {
			await writeRecord(lockPath, { pid: MISSING_PID });

			expect(await withLock(path, async () => true, { timeout: 2_000 })).toBe(true);
		});

		it("never takes over a lock whose pid exists, whatever process has it now", async () => {
			const record = await writeRecord(lockPath, { pid: process.ppid });

			expect(await lockError()).toMatchObject({
				code: "LOCK",
				details: { verdict: "alive", owner: { pid: process.ppid } },
			});
			expect(readFileSync(lockPath, "utf-8")).toBe(record);
		});

		it.each([
			["another host", { host: `not-${hostname()}` }],
			["another platform", { platform: "linux" }],
		])("never takes over a record from %s", async (_kind, changes) => {
			const record = await writeRecord(lockPath, { pid: MISSING_PID, ...changes });

			expect(await lockError()).toMatchObject({ code: "LOCK", details: { verdict: "unknown" } });
			expect(readFileSync(lockPath, "utf-8")).toBe(record);
		});
	});

	describe("after a recoverer crashed and left `<lock>.recover`", () => {
		it("acquires normally when the lock itself is gone", async () => {
			const recover = await writeRecord(`${lockPath}.recover`, { pid: MISSING_PID });

			expect(await withLock(path, async () => existsSync(lockPath))).toBe(true);
			expect(readFileSync(`${lockPath}.recover`, "utf-8")).toBe(recover);
		});

		it("never recovers a dead owner's lock: fails naming `.recover` at its deadline", async () => {
			const recover = await writeRecord(`${lockPath}.recover`, { pid: MISSING_PID });
			const lock = await writeRecord(lockPath, { pid: MISSING_PID });

			expect(await lockError()).toMatchObject({
				code: "LOCK",
				details: {
					path: `${lockPath}.recover`,
					verdict: "dead",
					owner: { ownerId: JSON.parse(recover).ownerId },
					manualStep: expect.stringContaining(`delete ${lockPath}.recover`),
				},
			});
			expect(readFileSync(lockPath, "utf-8")).toBe(lock);
			expect(readFileSync(`${lockPath}.recover`, "utf-8")).toBe(recover);
		});
	});

	describe("past its deadline", () => {
		const jumpPastDeadline = () => {
			const now = performance.now() + 3_600_000;
			vi.spyOn(performance, "now").mockReturnValue(now);
		};

		it("starts no recovery once the deadline passed while judging a dead owner", async () => {
			const lock = await writeRecord(lockPath, { pid: MISSING_PID });
			const kill = process.kill.bind(process);
			vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
				if (pid === MISSING_PID) jumpPastDeadline();
				return kill(pid, signal);
			});

			expect(await lockError({ timeout: 1_000 })).toMatchObject({
				code: "LOCK",
				details: { path: lockPath, verdict: "dead" },
			});
			expect(readFileSync(lockPath, "utf-8")).toBe(lock);
			expect(existsSync(`${lockPath}.recover`)).toBe(false);
		});

		it("names a leftover `.recover`, not the dead owner's lock, when the deadline passed while judging", async () => {
			const recover = await writeRecord(`${lockPath}.recover`, { pid: MISSING_PID });
			const lock = await writeRecord(lockPath, { pid: MISSING_PID });
			const kill = process.kill.bind(process);
			vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
				if (pid === MISSING_PID && !vi.isMockFunction(performance.now)) jumpPastDeadline();
				return kill(pid, signal);
			});

			expect(await lockError({ timeout: 1_000 })).toMatchObject({
				code: "LOCK",
				details: {
					path: `${lockPath}.recover`,
					verdict: "dead",
					owner: { ownerId: JSON.parse(recover).ownerId },
				},
			});
			expect(readFileSync(lockPath, "utf-8")).toBe(lock);
			expect(readFileSync(`${lockPath}.recover`, "utf-8")).toBe(recover);
		});

		it("makes no new attempt once the deadline passed during a recovery", async () => {
			await writeRecord(lockPath, { pid: MISSING_PID });
			const kill = process.kill.bind(process);
			vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
				// The second check of the dead owner runs while `.recover` is held.
				if (pid === MISSING_PID && existsSync(`${lockPath}.recover`)) jumpPastDeadline();
				return kill(pid, signal);
			});

			expect(await lockError({ timeout: 1_000 })).toMatchObject({
				code: "LOCK",
				details: { path: lockPath, verdict: "unknown" },
			});
			expect(await readdir(dir)).toEqual([]);
		});
	});

	describe("a failed close of a record this call created", () => {
		it("removes the lock and fails with IO", async () => {
			closeFailures.set(lockPath, "EIO");

			expect(await lockError()).toMatchObject({ code: "IO", cause: { code: "EIO" } });
			expect(await readdir(dir)).toEqual([]);
		});

		it("removes `.recover` and fails with IO, leaving the dead lock", async () => {
			const lock = await writeRecord(lockPath, { pid: MISSING_PID });
			closeFailures.set(`${lockPath}.recover`, "EIO");

			expect(await lockError()).toMatchObject({ code: "IO", cause: { code: "EIO" } });
			expect(readFileSync(lockPath, "utf-8")).toBe(lock);
			expect(existsSync(`${lockPath}.recover`)).toBe(false);
		});
	});

	describe("a lock it cannot remove", () => {
		it("fails with IO after `fn` succeeded", async () => {
			rmFailures.set(lockPath, 3);

			await expect(withLock(path, async () => "done")).rejects.toMatchObject({
				code: "IO",
				details: { path: lockPath, operation: "delete" },
				cause: { code: "EBUSY" },
			});
		});

		it("rethrows the error of `fn` instead", async () => {
			rmFailures.set(lockPath, 3);
			const failure = new Error("fn failed");

			await expect(withLock(path, () => Promise.reject(failure))).rejects.toBe(failure);
		});

		it("fails with IO when `.recover` cannot be removed", async () => {
			await writeRecord(lockPath, { pid: MISSING_PID });
			rmFailures.set(`${lockPath}.recover`, 3);

			expect(await lockError()).toMatchObject({
				code: "IO",
				details: { path: `${lockPath}.recover`, operation: "delete" },
			});
		});
	});

	it("judges an owner whose process cannot be probed as unknown", async () => {
		await writeRecord(lockPath, { pid: MISSING_PID });
		vi.spyOn(process, "kill").mockImplementation(() => {
			throw Object.assign(new Error("EINVAL"), { code: "EINVAL" });
		});

		expect(await lockError()).toMatchObject({ code: "LOCK", details: { verdict: "unknown" } });
	});

	describe("abort", () => {
		it("rejects with the signal's reason while waiting for a live owner", async () => {
			const release = await holdLock();
			const held = readFileSync(lockPath, "utf-8");
			try {
				const reason = new Error("stop");
				const controller = new AbortController();
				setTimeout(() => controller.abort(reason), 50);

				expect(await lockError({ signal: controller.signal, timeout: 10_000 })).toBe(reason);
				expect(readFileSync(lockPath, "utf-8")).toBe(held);
			} finally {
				await release();
			}
		});

		it("rejects with the signal's reason while waiting for `.recover`", async () => {
			const recover = await writeRecord(`${lockPath}.recover`, { pid: MISSING_PID });
			const lock = await writeRecord(lockPath, { pid: MISSING_PID });
			const reason = new Error("stop");
			const controller = new AbortController();
			setTimeout(() => controller.abort(reason), 50);
			expect(await lockError({ signal: controller.signal, timeout: 10_000 })).toBe(reason);
			expect(readFileSync(lockPath, "utf-8")).toBe(lock);
			expect(readFileSync(`${lockPath}.recover`, "utf-8")).toBe(recover);
		});

		it.skipIf(process.platform === "win32")(
			"rejects with the signal's reason when aborted while the directory is checked",
			async () => {
				const reason = new Error("stop");
				const controller = new AbortController();
				duringLstat.set(dir, () => controller.abort(reason));
				try {
					expect(await lockError({ signal: controller.signal })).toBe(reason);
				} finally {
					duringLstat.clear();
				}
				expect(await readdir(dir)).toEqual([]);
			},
		);

		it("rejects with the signal's reason when aborted while judging a dead owner", async () => {
			const lock = await writeRecord(lockPath, { pid: MISSING_PID });
			const reason = new Error("stop");
			const controller = new AbortController();
			const kill = process.kill.bind(process);
			vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
				if (pid === MISSING_PID) controller.abort(reason);
				return kill(pid, signal);
			});

			expect(await lockError({ signal: controller.signal, timeout: 10_000 })).toBe(reason);
			expect(readFileSync(lockPath, "utf-8")).toBe(lock);
			expect(existsSync(`${lockPath}.recover`)).toBe(false);
		});

		it("creates nothing when the signal is already aborted", async () => {
			const reason = new Error("stop");

			expect(await lockError({ signal: AbortSignal.abort(reason) })).toBe(reason);
			expect(await readdir(dir)).toEqual([]);
		});

		it("creates no missing directory when the signal is already aborted", async () => {
			const reason = new Error("stop");
			const fn = vi.fn(async () => {});

			await expect(
				withLock(join(dir, "new", "nested", "doc.json"), fn, { signal: AbortSignal.abort(reason) }),
			).rejects.toBe(reason);
			expect(fn).not.toHaveBeenCalled();
			expect(await readdir(dir)).toEqual([]);
		});
	});

	describe.skipIf(process.platform === "win32")("directory validation", () => {
		it.each([0o775, 0o757, 0o722])(
			"refuses a directory group or other users can write to (%o) and creates nothing in it",
			async (mode) => {
				await chmod(dir, mode);

				expect(await lockError()).toMatchObject({
					code: "PATH",
					details: { path: dir, reason: "directory" },
				});
				expect(await readdir(dir)).toEqual([]);
			},
		);

		// A default store, such as updateNotifier()'s, creates the app's directory with mode 0755.
		it("accepts a directory others can read but not write to", async () => {
			await chmod(dir, 0o755);

			await expect(withLock(path, async () => "done")).resolves.toBe("done");
		});

		it("refuses a directory owned by another user", async () => {
			const uid = process.getuid?.() ?? 0;
			vi.spyOn(process, "getuid").mockReturnValue(uid + 1);

			expect(await lockError()).toMatchObject({ code: "PATH", details: { reason: "directory" } });
			expect(await readdir(dir)).toEqual([]);
		});

		it("refuses a directory that is a symbolic link", async () => {
			const real = join(dir, "real");
			await mkdir(real, { mode: 0o700 });
			await symlink(real, join(dir, "link"));
			path = join(dir, "link", "doc.json");

			expect(await lockError()).toMatchObject({
				code: "PATH",
				details: { path: join(dir, "link"), reason: "directory" },
			});
			expect(await readdir(real)).toEqual([]);
		});

		it("refuses a missing directory that another process creates open before the lock", async () => {
			const nested = join(dir, "nested");
			path = join(nested, "doc.json");
			duringLstat.set(nested, () => {
				duringLstat.delete(nested);
				mkdirSync(nested);
				chmodSync(nested, 0o775);
			});

			expect(await lockError()).toMatchObject({
				code: "PATH",
				details: { path: nested, reason: "directory" },
			});
			expect(await readdir(nested)).toEqual([]);
		});

		it("creates a missing directory owner-only", async () => {
			path = join(dir, "nested", "doc.json");
			const previous = process.umask(0o000);
			try {
				await withLock(path, async () => {});
			} finally {
				process.umask(previous);
			}

			expect((await stat(join(dir, "nested"))).mode & 0o777).toBe(0o700);
		});
	});
});

// ────────────────────────────────────────────────────────────────────────────
// A strict store's fs operations, in order
// ────────────────────────────────────────────────────────────────────────────

describe("a strict store", () => {
	const strictStore = () =>
		createStore({
			dirPath: dir,
			name: "doc",
			fields: { n: { type: "number", default: 0 } },
			strict: true,
		});

	/** The traced calls on this test's directory, with paths relative to it. */
	const trace = () =>
		fsTrace
			.filter((entry) => entry.includes(dir))
			.map((entry) => entry.replace(`${dir}${sep}`, "").replace(dir, "."));

	beforeEach(() => {
		fsTrace.length = 0;
	});

	it.skipIf(process.platform === "win32")(
		"validates the directory, locks, then writes and flushes before releasing",
		async () => {
			await strictStore().write({ n: 1 });

			const temp = trace()
				.find((entry) => entry.endsWith(".tmp wx"))
				?.split(" ")[1];
			expect(temp).toMatch(/^\.doc-[\w-]+\.tmp$/);
			expect(trace()).toEqual([
				"lstat .",
				"open doc.json.lock wx",
				"write doc.json.lock",
				"lstat doc.json",
				`open ${temp} wx`,
				`write ${temp}`,
				`sync ${temp}`,
				`chmod ${temp}`,
				"rename doc.json",
				"open . r",
				"sync .",
				"rm doc.json.lock",
			]);
		},
	);

	it.skipIf(process.platform === "win32")(
		"flushes the directory after a reset, before releasing and resolving",
		async () => {
			const store = strictStore();
			await store.write({ n: 1 });
			fsTrace.length = 0;

			await store.reset();
			fsTrace.push(`resolved ${dir}`);

			expect(trace()).toEqual([
				// Whether the directory exists: a reset never creates it.
				"lstat .",
				"lstat .",
				"open doc.json.lock wx",
				"write doc.json.lock",
				"lstat doc.json",
				"rm doc.json",
				"open . r",
				"sync .",
				"rm doc.json.lock",
				"resolved .",
			]);
		},
	);

	it("completes a reset that found no directory, leaving a store created after the check", async () => {
		const nested = join(dir, "nested");
		const file = join(nested, "doc.json");
		duringLstat.set(nested, () => {
			duringLstat.delete(nested);
			// Another process creates the store while the reset is paused after its check.
			mkdirSync(nested, { mode: 0o700 });
			writeFileSync(file, JSON.stringify({ n: 1 }));
		});

		await createStore({
			dirPath: nested,
			name: "doc",
			fields: { n: { type: "number", default: 0 } },
			strict: true,
		}).reset();

		expect(readFileSync(file, "utf-8")).toBe(JSON.stringify({ n: 1 }));
		expect(trace()).toEqual(["lstat nested"]);
	});

	it.skipIf(process.platform === "win32")(
		"rejects a reset with IO when the directory flush fails, and releases the lock",
		async () => {
			const store = strictStore();
			await store.write({ n: 1 });
			syncFailures.set(dir, "EIO");

			await expect(store.reset()).rejects.toMatchObject({
				code: "IO",
				details: { operation: "delete" },
				cause: { code: "EIO" },
			});
			expect(await readdir(dir)).toEqual([]);
		},
	);

	describe("on Windows", () => {
		const platform = process.platform;
		beforeEach(() => {
			Object.defineProperty(process, "platform", { value: "win32" });
		});
		afterEach(() => {
			Object.defineProperty(process, "platform", { value: platform });
		});

		it("skips the directory checks, the modes, and the directory flush", async () => {
			const store = strictStore();
			await store.write({ n: 1 });
			const temp = trace()
				.find((entry) => entry.endsWith(".tmp wx"))
				?.split(" ")[1];
			await store.reset();

			expect(trace()).toEqual([
				"open doc.json.lock wx",
				"write doc.json.lock",
				"lstat doc.json",
				`open ${temp} wx`,
				`write ${temp}`,
				`sync ${temp}`,
				"rename doc.json",
				"rm doc.json.lock",
				"lstat .",
				"open doc.json.lock wx",
				"write doc.json.lock",
				"lstat doc.json",
				"rm doc.json",
				"rm doc.json.lock",
			]);
		});
	});
});
