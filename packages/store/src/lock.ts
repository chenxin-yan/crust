// ────────────────────────────────────────────────────────────────────────────
// @crustjs/store — withLock, the strict cross-process lock
// ────────────────────────────────────────────────────────────────────────────

import { lstat, open, readFile, readlink, rm } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { isErrnoException } from "@crustjs/utils/error";

import { CrustStoreError, type LockErrorDetails, type LockOwner } from "./errors.ts";
import { abortableSleep, BUSY_CODES, ensureDirectory, MAX_RETRY_DELAY_MS } from "./persistence.ts";

/** How long {@link withLock} waits for a lock by default. */
const DEFAULT_LOCK_TIMEOUT_MS = 40_000;

/**
 * Platforms whose dead-owner rule is "same platform and host, and the pid is gone (`ESRCH`)".
 * Linux has its own, stricter rule; any other platform never takes a lock over.
 */
const PID_RULE_PLATFORMS: ReadonlySet<string> = new Set(["darwin", "win32"]);

/**
 * NaN or Infinity would leave the deadline unreachable.
 *
 * @throws {CrustStoreError} `DEFINITION` unless `timeout` is undefined or a finite number >= 0.
 */
export function checkLockTimeout(option: string, timeout: number | undefined): void {
	if (timeout === undefined || (Number.isFinite(timeout) && timeout >= 0)) return;
	throw new CrustStoreError(
		"DEFINITION",
		`"${option}" must be a finite number of milliseconds, at least 0: got ${String(timeout)}`,
	);
}

/** Options for {@link withLock}. */
export interface LockOptions {
	/**
	 * Stops waiting for the lock: the call rejects with `signal.reason` and leaves every file
	 * untouched. Not observed once the lock is held.
	 */
	readonly signal?: AbortSignal;
	/**
	 * Milliseconds to wait for the lock before failing with `LOCK`. Expiry never takes the
	 * lock over.
	 *
	 * @default 40000
	 */
	readonly timeout?: number;
}

/**
 * The contents of a lock file and of its `.recover` file. The Linux identity fields are `null`
 * on other platforms, or when they cannot be read.
 */
interface LockRecord extends LockOwner {
	machineId: string | null;
	bootId: string | null;
	pidNamespace: string | null;
	/** Field 22 of `/proc/<pid>/stat`, which tells a reused pid from the process that wrote the record. */
	startTime: string | null;
}

/** What a waiter is waiting for: a lock or `.recover` file and its owner's state. */
interface Blocker {
	path: string;
	verdict: LockErrorDetails["verdict"];
	owner: LockRecord | undefined;
}

const readTrimmed = (path: string): Promise<string | null> =>
	readFile(path, "utf-8").then(
		(text) => text.trim() || null,
		() => null,
	);

async function readStartTime(pid: number | "self"): Promise<string | null> {
	const stat = await readTrimmed(`/proc/${pid}/stat`);
	// Field 2, the command name, may contain spaces and parentheses: count from the last ")".
	const end = stat?.lastIndexOf(")") ?? -1;
	return stat === null || end < 0 ? null : (stat.slice(end + 2).split(" ")[19] ?? null);
}

/** This process's record, without the per-acquisition `ownerId` and `createdAt`. */
async function ownRecord(): Promise<Omit<LockRecord, "ownerId" | "createdAt">> {
	const linux = process.platform === "linux";
	return {
		pid: process.pid,
		host: hostname(),
		platform: process.platform,
		machineId: linux
			? ((await readTrimmed("/etc/machine-id")) ?? (await readTrimmed("/var/lib/dbus/machine-id")))
			: null,
		bootId: linux ? await readTrimmed("/proc/sys/kernel/random/boot_id") : null,
		pidNamespace: linux ? await readlink("/proc/self/ns/pid").catch(() => null) : null,
		startTime: linux ? await readStartTime("self") : null,
	};
}

const isNullableString = (value: unknown) => value === null || typeof value === "string";

/** The record at `path`: `undefined` when the file is absent, `"unreadable"` when it is not a record. */
async function readRecord(path: string): Promise<LockRecord | "unreadable" | undefined> {
	let text: string;
	try {
		text = await readFile(path, "utf-8");
	} catch (err: unknown) {
		return isErrnoException(err) && err.code === "ENOENT" ? undefined : "unreadable";
	}
	try {
		const record: Partial<Record<keyof LockRecord, unknown>> | null = JSON.parse(text);
		if (
			typeof record?.ownerId === "string" &&
			typeof record.pid === "number" &&
			Number.isSafeInteger(record.pid) &&
			record.pid > 0 &&
			typeof record.host === "string" &&
			typeof record.platform === "string" &&
			typeof record.createdAt === "string" &&
			isNullableString(record.machineId) &&
			isNullableString(record.bootId) &&
			isNullableString(record.pidNamespace) &&
			isNullableString(record.startTime)
		) {
			// SAFETY: every field of LockRecord was checked above.
			return record as LockRecord;
		}
	} catch {
		// An empty or partly written file: its owner is unknown.
	}
	return "unreadable";
}

/** Whether a process with `pid` exists; `unknown` when the probe fails for another reason. */
function probeProcess(pid: number): "exists" | "gone" | "unknown" {
	try {
		process.kill(pid, 0);
		return "exists";
	} catch (err: unknown) {
		if (!isErrnoException(err)) return "unknown";
		if (err.code === "ESRCH") return "gone";
		// EPERM: the process exists but belongs to another user.
		return err.code === "EPERM" ? "exists" : "unknown";
	}
}

/**
 * Whether the owner of `record` provably no longer runs (`dead`), runs (`alive`), or
 * cannot be judged from here (`unknown`). Only `dead` allows a takeover.
 */
async function judge(
	record: LockRecord | "unreadable",
	self: Omit<LockRecord, "ownerId" | "createdAt">,
): Promise<Blocker["verdict"]> {
	if (record === "unreadable" || record.platform !== self.platform) return "unknown";
	if (self.platform === "linux") {
		// A pid identifies a process only within one machine, boot, and PID namespace.
		const { machineId, bootId, pidNamespace, startTime } = record;
		if (machineId === null || bootId === null || pidNamespace === null || startTime === null) {
			return "unknown";
		}
		if (
			machineId !== self.machineId ||
			bootId !== self.bootId ||
			pidNamespace !== self.pidNamespace
		) {
			return "unknown";
		}
		const probe = probeProcess(record.pid);
		if (probe !== "exists") return probe === "gone" ? "dead" : "unknown";
		const current = await readStartTime(record.pid);
		if (current === null) return "unknown";
		return current === startTime ? "alive" : "dead";
	}
	// Assumes no two machines with the same hostname share the directory.
	if (!PID_RULE_PLATFORMS.has(self.platform) || record.host !== self.host) return "unknown";
	const probe = probeProcess(record.pid);
	return probe === "gone" ? "dead" : probe === "exists" ? "alive" : "unknown";
}

/** Creates `path` exclusively, holding `record`; `false` when it already exists. */
async function createRecord(path: string, record: LockRecord): Promise<boolean> {
	let handle;
	try {
		handle = await open(path, "wx", 0o600);
	} catch (err: unknown) {
		if (isErrnoException(err) && err.code === "EEXIST") return false;
		throw err;
	}
	try {
		await handle.writeFile(JSON.stringify(record));
		await handle.close();
	} catch (err: unknown) {
		await handle.close().catch(() => {});
		// This call created the file: a record left behind would block every waiter, and an empty
		// one reads as `unknown` until deleted by hand.
		await rm(path, { force: true }).catch(() => {});
		throw err;
	}
	return true;
}

/**
 * Removes `path` if it still holds `ownerId`'s record.
 *
 * @throws {CrustStoreError} `IO` when the record cannot be removed.
 */
async function release(path: string, ownerId: string): Promise<void> {
	let error: unknown;
	// A refused delete is tried again: a lock left behind blocks every waiter while this process lives.
	for (let attempt = 0; attempt < 3; attempt++) {
		const record = await readRecord(path);
		if (record === undefined || record === "unreadable" || record.ownerId !== ownerId) return;
		try {
			await rm(path, { force: true });
			return;
		} catch (err: unknown) {
			error = err;
		}
		await sleep(10);
	}
	throw new CrustStoreError(
		"IO",
		`Failed to release lock: ${path}`,
		{ path, operation: "delete" },
		error,
	);
}

/** Runs `fn`, then releases `path`; an error of `fn` wins over a failed release. */
async function releasing<T>(path: string, ownerId: string, fn: () => Promise<T>): Promise<T> {
	let result: T;
	try {
		result = await fn();
	} catch (err: unknown) {
		await release(path, ownerId).catch(() => {});
		throw err;
	}
	await release(path, ownerId);
	return result;
}

/**
 * Removes the lock at `lockPath` if its owner is dead, serialized by `<lockPath>.recover`.
 *
 * @returns What blocks the waiter, or `undefined` to try acquiring again right away.
 */
async function recoverOrBlock(
	lockPath: string,
	self: Omit<LockRecord, "ownerId" | "createdAt">,
	deadline: number,
	signal: AbortSignal | undefined,
): Promise<Blocker | undefined> {
	const owner = await readRecord(lockPath);
	if (owner === undefined) return undefined;
	const verdict = await judge(owner, self);
	if (owner === "unreadable" || verdict !== "dead") {
		return { path: lockPath, verdict, owner: owner === "unreadable" ? undefined : owner };
	}
	signal?.throwIfAborted();
	// No recovery starts past the deadline: the waiter fails, naming the dead owner's lock.
	if (performance.now() >= deadline) return { path: lockPath, verdict, owner };

	const recoverPath = `${lockPath}.recover`;
	const recoverer = { ...self, ownerId: crypto.randomUUID(), createdAt: new Date().toISOString() };
	if (!(await createRecord(recoverPath, recoverer))) {
		// Another waiter is recovering, or one crashed doing so: `.recover` is never removed
		// automatically, so a leftover one blocks recovery until it is deleted by hand.
		const current = await readRecord(recoverPath);
		if (current === undefined) return undefined;
		return {
			path: recoverPath,
			verdict: await judge(current, self),
			owner: current === "unreadable" ? undefined : current,
		};
	}
	await releasing(recoverPath, recoverer.ownerId, async () => {
		// Since the verdict, another waiter may have recovered this lock and a successor taken
		// the path: only the record that was judged dead is removed.
		const current = await readRecord(lockPath);
		if (
			current !== undefined &&
			current !== "unreadable" &&
			current.ownerId === owner.ownerId &&
			(await judge(current, self)) === "dead"
		) {
			await rm(lockPath, { force: true });
		}
	});
	return undefined;
}

/**
 * POSIX: creates a missing directory with mode `0700`, then refuses a directory that is a symbolic
 * link, belongs to another user, or grants group or other permissions, before any file is created
 * in it.
 */
async function validateDirectory(path: string): Promise<void> {
	if (process.platform === "win32") return;
	const dir = dirname(path);
	let stats;
	try {
		stats = await lstat(dir);
	} catch (err: unknown) {
		if (isErrnoException(err) && err.code === "ENOENT") {
			// Checked again once created: another process may have created it first, with its own mode.
			await ensureDirectory(path, 0o700);
			return validateDirectory(path);
		}
		throw new CrustStoreError(
			"IO",
			`Failed to inspect store directory: ${dir}`,
			{ path, operation: "write" },
			err,
		);
	}
	if (stats.isDirectory() && stats.uid === process.getuid?.() && (stats.mode & 0o077) === 0) {
		return;
	}
	throw new CrustStoreError(
		"PATH",
		`Refusing unsafe store directory: ${dir}. A strict store needs a real directory (not a symbolic link) owned by the current user, with no group or other permissions (mode 0700), so it cannot share a directory with a store whose directory is group- or world-accessible.`,
		{ path: dir, reason: "directory" },
	);
}

function timeoutError(blocker: Blocker): CrustStoreError<"LOCK"> {
	const { path, verdict, owner } = blocker;
	const manualStep = `Stop every process that uses ${dirname(path)} and keep new ones from starting, including on other machines or containers that share it; only then delete ${path}. If you cannot be sure of that, leave the file in place.`;
	return new CrustStoreError(
		"LOCK",
		`Timed out waiting for ${path} (owner ${verdict}). ${manualStep}`,
		{
			path,
			verdict,
			owner:
				owner === undefined
					? undefined
					: {
							ownerId: owner.ownerId,
							pid: owner.pid,
							host: owner.host,
							platform: owner.platform,
							createdAt: owner.createdAt,
						},
			manualStep,
		},
	);
}

// On Windows a create or delete that races another process's delete of the same file fails with
// an access error. TODO: Bun reports the delete's EPERM as EFAULT; drop EFAULT here once
// https://github.com/oven-sh/bun/issues/48811 is fixed.
const isWindowsContention = (err: unknown): boolean =>
	process.platform === "win32" &&
	isErrnoException(err) &&
	(err.code === "EFAULT" || BUSY_CODES.has(err.code ?? ""));

/**
 * Runs `fn` while holding `<path>.lock`, a strict advisory lock shared by every process that
 * uses this function, or a `strict` store, on the same path.
 *
 * The lock is never taken from an owner that may still run, however long it holds it. A waiter
 * takes over only a provably dead owner, serialized through `<path>.lock.recover`:
 *
 * - Linux: the owner wrote its record on the same machine, boot and PID namespace, and its
 *   pid is gone or now belongs to a process with another start time.
 * - macOS and Windows: the owner wrote its record on the same platform and hostname, and its pid
 *   is gone. This assumes no two machines with the same hostname share the directory.
 *
 * Any other owner is waited on until `timeout`, then the call fails with `LOCK`, whose
 * details name the file, its owner, and the manual step. On POSIX, the directory must be a real
 * directory owned by the current user with no group or other permissions; a missing one is
 * created with mode `0700`.
 *
 * @throws {CrustStoreError} `LOCK` when the lock is not acquired before `timeout`.
 * @throws {CrustStoreError} `DEFINITION` when `timeout` is not a finite number of at least 0.
 * @throws {CrustStoreError} `PATH` when the directory is unsafe (POSIX).
 * @throws {CrustStoreError} `IO` when a lock or `.recover` file cannot be created or removed. An
 *   error of `fn` wins over a failed removal of the lock.
 */
export async function withLock<T>(
	path: string,
	fn: () => Promise<T>,
	options: LockOptions = {},
): Promise<T> {
	const { signal } = options;
	checkLockTimeout("timeout", options.timeout);
	const lockPath = `${path}.lock`;
	// Monotonic, so setting the system clock back does not extend the wait.
	const deadline = performance.now() + (options.timeout ?? DEFAULT_LOCK_TIMEOUT_MS);
	const self = await ownRecord();
	let ownerId: string;
	let blocker: Blocker = { path: lockPath, verdict: "unknown", owner: undefined };
	for (let delay = 1, first = true; ; delay = Math.min(delay * 2, MAX_RETRY_DELAY_MS)) {
		await validateDirectory(path);
		signal?.throwIfAborted();
		// The first attempt always runs; no later one starts past the deadline.
		if (!first && performance.now() >= deadline) throw timeoutError(blocker);
		first = false;
		const record = { ...self, ownerId: crypto.randomUUID(), createdAt: new Date().toISOString() };
		try {
			if (await createRecord(lockPath, record)) {
				ownerId = record.ownerId;
				break;
			}
			const found = await recoverOrBlock(lockPath, self, deadline, signal);
			if (found === undefined) continue;
			blocker = found;
		} catch (err: unknown) {
			if (err instanceof CrustStoreError || (signal?.aborted && err === signal.reason)) throw err;
			if (isErrnoException(err) && err.code === "ENOENT") {
				await ensureDirectory(path, 0o700);
				continue;
			}
			if (!isWindowsContention(err)) {
				throw new CrustStoreError(
					"IO",
					`Failed to lock: ${path}`,
					{ path, operation: "write" },
					err,
				);
			}
			blocker = { path: lockPath, verdict: "unknown", owner: undefined };
		}
		const remaining = deadline - performance.now();
		if (remaining <= 0) throw timeoutError(blocker);
		await abortableSleep(Math.min(delay * (1 + Math.random()), remaining), signal);
	}
	return releasing(lockPath, ownerId, fn);
}
