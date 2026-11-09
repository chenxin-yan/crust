// ────────────────────────────────────────────────────────────────────────────
// @crustjs/store — JSON persistence primitives
// ────────────────────────────────────────────────────────────────────────────

import { chmod, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { isErrnoException } from "@crustjs/utils/error";
import type { JsonValue } from "@crustjs/utils/json";

import { CrustStoreError } from "./errors.ts";
import type { StoreDocument } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// WriteJsonOptions — File/directory permission control
// ────────────────────────────────────────────────────────────────────────────

/** Permission options for {@link writeJson}. */
export interface WriteJsonOptions {
	/**
	 * Unix permission bits for the persisted file (e.g. `0o600`).
	 *
	 * When set, the file is created with exactly these bits regardless of the
	 * process `umask` — the temp file is `chmod`ed before the atomic rename, so
	 * the final file is never momentarily more permissive. Effectively a no-op
	 * on Windows. When omitted, the platform default applies.
	 */
	fileMode?: number;

	/**
	 * Unix permission bits for the parent directory (e.g. `0o700`).
	 *
	 * Applied only when this write actually creates the directory; a
	 * pre-existing directory is left untouched so callers retain control of it.
	 *
	 * Only the immediate parent receives the exact bits. Any ancestor
	 * directories created in the same `mkdir` call are subject to the process
	 * `umask` (`directoryMode & ~umask`) — relevant only when `directoryMode`
	 * sets bits that a common umask would clear (e.g. `0o755` under `umask 0o027`).
	 */
	directoryMode?: number;
}

// ────────────────────────────────────────────────────────────────────────────
// readJson — Async JSON file read + parse
// ────────────────────────────────────────────────────────────────────────────

/**
 * Reads and parses a JSON store file from disk.
 *
 * Returns `undefined` when the file does not exist (ENOENT), allowing callers
 * to fall back to defaults. Malformed JSON throws a `CrustStoreError` with `PARSE`
 * code — the store never silently recovers corrupt data.
 *
 * @param filePath - Absolute path to the JSON store file.
 * @returns Parsed JSON value, or `undefined` if the file does not exist.
 * @throws {CrustStoreError} `PARSE` if the file contains malformed JSON.
 * @throws {CrustStoreError} `IO` on filesystem read failures other than ENOENT.
 */
export async function readJson(filePath: string): Promise<JsonValue | undefined> {
	let raw: string;

	try {
		raw = await readFile(filePath, "utf-8");
	} catch (err: unknown) {
		// File not found is a normal case — nothing persisted yet
		if (isErrnoException(err) && err.code === "ENOENT") {
			return undefined;
		}

		throw new CrustStoreError(
			"IO",
			`Failed to read store file: ${filePath}`,
			{
				path: filePath,
				operation: "read",
			},
			err,
		);
	}

	try {
		return JSON.parse(raw);
	} catch (err: unknown) {
		throw new CrustStoreError(
			"PARSE",
			`Malformed JSON in store file: ${filePath}`,
			{
				path: filePath,
			},
			err,
		);
	}
}

// Unix permission bits are meaningless on Windows (it uses ACLs, not POSIX
// bits) and chmod there can toggle the read-only attribute or throw. Ignore
// the modes entirely so behavior is a true no-op, as documented.
const isWindows = () => process.platform === "win32";

/**
 * Creates the store file's parent directory if missing, enforcing `directoryMode`
 * exactly when this call created it.
 */
async function ensureDirectory(filePath: string, mode: number | undefined): Promise<void> {
	const directoryMode = isWindows() ? undefined : mode;
	const dir = dirname(filePath);
	let createdDir: string | undefined;
	try {
		// mkdir returns the first directory it created (or undefined if the directory already existed).
		createdDir = await mkdir(dir, { recursive: true, mode: directoryMode });
	} catch (err: unknown) {
		throw new CrustStoreError(
			"IO",
			`Failed to create store directory: ${dir}`,
			{
				path: filePath,
				operation: "write",
			},
			err,
		);
	}

	// mkdir's `mode` is masked by `umask`, so a chmod is needed to guarantee the requested bits.
	if (directoryMode !== undefined && createdDir !== undefined) {
		try {
			await chmod(dir, directoryMode);
		} catch (err: unknown) {
			throw new CrustStoreError(
				"IO",
				`Failed to set permissions on store directory: ${dir}`,
				{
					path: filePath,
					operation: "write",
				},
				err,
			);
		}
	}
}

// ────────────────────────────────────────────────────────────────────────────
// writeJson — Atomic JSON file write (temp file + rename)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Atomically writes a JSON value to disk using a temp-file-and-rename strategy.
 *
 * Steps:
 * 1. Creates the parent directory if it does not exist.
 * 2. Writes serialized JSON to a temporary file in the same directory.
 * 3. Renames the temp file to the target path (atomic on most filesystems).
 *
 * If any step fails, the function cleans up the temp file (best-effort) and
 * throws a `CrustStoreError` with `IO` code.
 *
 * @param filePath - Absolute path to the target JSON store file.
 * @param data - The value to serialize and persist.
 * @param options - Optional file/directory permission bits ({@link WriteJsonOptions}).
 * @throws {CrustStoreError} `IO` on filesystem write failures.
 */
export async function writeJson(
	filePath: string,
	data: Readonly<StoreDocument>,
	options: WriteJsonOptions = {},
): Promise<void> {
	const fileMode = isWindows() ? undefined : options.fileMode;
	const tempPath = join(
		dirname(filePath),
		`.${basename(filePath, ".json")}-${crypto.randomUUID()}.tmp`,
	);

	await ensureDirectory(filePath, options.directoryMode);

	try {
		const json = JSON.stringify(data, null, "\t");
		await writeFile(tempPath, json, { encoding: "utf-8", mode: fileMode });
		// Enforce `fileMode` exactly regardless of `umask`. Done on the temp inode
		// before rename, which preserves the mode — so the final file is never
		// momentarily world-readable.
		if (fileMode !== undefined) await chmod(tempPath, fileMode);
	} catch (err: unknown) {
		await rm(tempPath, { force: true }).catch(() => {});

		throw new CrustStoreError(
			"IO",
			`Failed to write store file: ${filePath}`,
			{
				path: filePath,
				operation: "write",
			},
			err,
		);
	}

	try {
		await rename(tempPath, filePath);
	} catch (err: unknown) {
		await rm(tempPath, { force: true }).catch(() => {});

		throw new CrustStoreError(
			"IO",
			`Failed to finalize store file: ${filePath}`,
			{
				path: filePath,
				operation: "write",
			},
			err,
		);
	}
}

// ────────────────────────────────────────────────────────────────────────────
// deleteJson — Store file deletion
// ────────────────────────────────────────────────────────────────────────────

/**
 * Deletes a persisted store file from disk.
 *
 * Silently succeeds when the file does not exist (ENOENT) — deleting an
 * already-absent file is not an error.
 *
 * @param filePath - Absolute path to the JSON store file to delete.
 * @throws {CrustStoreError} `IO` on filesystem deletion failures other than ENOENT.
 */
export async function deleteJson(filePath: string): Promise<void> {
	try {
		await rm(filePath, { force: true });
	} catch (err: unknown) {
		throw new CrustStoreError(
			"IO",
			`Failed to delete store file: ${filePath}`,
			{
				path: filePath,
				operation: "delete",
			},
			err,
		);
	}
}

// ────────────────────────────────────────────────────────────────────────────
// withFileLock — Cross-process advisory lock
// ────────────────────────────────────────────────────────────────────────────

/** A lock held this long is abandoned even when its process looks alive (pid reuse, a hung holder). */
const STALE_LOCK_MS = 10_000;
const MAX_RETRY_DELAY_MS = 100;

interface LockOwner {
	readonly pid: number;
	readonly host: string;
	readonly time: number;
}

/** Options for {@link withFileLock}. */
export interface FileLockOptions {
	/** `"write"` creates a missing parent directory to hold the lock; `"delete"` runs unlocked instead. */
	readonly operation: "write" | "delete";
	/** Applied when acquiring the lock creates the parent directory, as in {@link writeJson}. */
	readonly directoryMode?: number;
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err: unknown) {
		// EPERM: the process exists but belongs to another user.
		return isErrnoException(err) && err.code === "EPERM";
	}
}

/** Lock file contents, or `undefined` once the lock is gone. */
async function readLock(lockPath: string): Promise<string | undefined> {
	try {
		return await readFile(lockPath, "utf-8");
	} catch (err: unknown) {
		if (isErrnoException(err) && err.code === "ENOENT") return undefined;
		throw err;
	}
}

async function isStaleLock(lockPath: string, contents: string): Promise<boolean> {
	let owner: Partial<LockOwner> | undefined;
	try {
		owner = JSON.parse(contents);
	} catch {
		// Created but not yet written, or cut short by a crash: judged by age below.
	}
	if (typeof owner?.pid === "number" && typeof owner.time === "number") {
		if (Date.now() - owner.time > STALE_LOCK_MS) return true;
		// A pid only identifies a process on the host that wrote it.
		return owner.host === hostname() && !isProcessAlive(owner.pid);
	}
	try {
		return Date.now() - (await stat(lockPath)).mtimeMs > STALE_LOCK_MS;
	} catch {
		return false;
	}
}

/**
 * Runs `fn` while holding `<filePath>.lock`, an advisory lock shared by every
 * process that uses this function on the same file.
 *
 * The lock file is created exclusively (`wx`) and holds the owner's pid, host,
 * and acquisition time. Waiters retry with a growing, jittered delay; a lock
 * whose owner process is gone, or that is older than 10 seconds, is taken over.
 * The lock is released after `fn` settles, unless another process already took
 * it over.
 *
 * @throws {CrustStoreError} `IO` when the lock file cannot be created or inspected.
 */
export async function withFileLock<T>(
	filePath: string,
	fn: () => Promise<T>,
	options: FileLockOptions,
): Promise<T> {
	const lockPath = `${filePath}.lock`;
	const lockError = (err: unknown) =>
		new CrustStoreError(
			"IO",
			`Failed to lock store file: ${filePath}`,
			{ path: filePath, operation: options.operation },
			err,
		);
	let contents: string;
	let delay = 1;
	for (;;) {
		const owner: LockOwner = { pid: process.pid, host: hostname(), time: Date.now() };
		contents = JSON.stringify(owner);
		try {
			const handle = await open(lockPath, "wx");
			try {
				await handle.writeFile(contents);
				await handle.close();
			} catch (err: unknown) {
				// Closed before removal: Windows cannot delete an open file.
				await handle.close().catch(() => {});
				await rm(lockPath, { force: true }).catch(() => {});
				throw lockError(err);
			}
			break;
		} catch (err: unknown) {
			if (err instanceof CrustStoreError) throw err;
			if (isErrnoException(err) && err.code === "ENOENT") {
				// No directory means no store file: nothing to delete, nothing to guard.
				if (options.operation === "delete") return await fn();
				await ensureDirectory(filePath, options.directoryMode);
				continue;
			}
			if (!isErrnoException(err) || err.code !== "EEXIST") throw lockError(err);
		}

		let held: string | undefined;
		try {
			held = await readLock(lockPath);
			if (held !== undefined && (await isStaleLock(lockPath, held))) {
				// shortcut: a waiter that read the stale lock just before another took it over can
				// still remove the new lock in the gap between this re-read and rm; upgrade to a
				// rename-based handoff if stale takeovers ever race in practice.
				if ((await readLock(lockPath)) === held) await rm(lockPath, { force: true });
				continue;
			}
		} catch (err: unknown) {
			throw lockError(err);
		}
		if (held === undefined) continue;
		await sleep(delay * (1 + Math.random()));
		delay = Math.min(delay * 2, MAX_RETRY_DELAY_MS);
	}

	try {
		return await fn();
	} finally {
		// A holder that outlived STALE_LOCK_MS may have been taken over; never delete another owner's lock.
		const held = await readLock(lockPath).catch(() => undefined);
		if (held === contents) await rm(lockPath, { force: true }).catch(() => {});
	}
}
