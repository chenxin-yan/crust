// ────────────────────────────────────────────────────────────────────────────
// @crustjs/store — JSON persistence primitives
// ────────────────────────────────────────────────────────────────────────────

import { chmod, chown, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
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
	 * on Windows. When omitted, a replaced file keeps its current mode, and a new
	 * file gets the platform default.
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

/** Whether a failed `chown` only means an unprivileged process cannot give a file away. */
function isChownErrorOk(err: unknown): boolean {
	if (!isErrnoException(err)) return false;
	if (err.code === "ENOSYS") return true;
	return process.getuid?.() !== 0 && (err.code === "EPERM" || err.code === "EINVAL");
}

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
 * 2. Writes serialized JSON to a temporary file in the same directory and
 *    flushes it to disk (`fsync`), so a crash after the rename cannot leave an
 *    empty or partial file in place. On POSIX the temp file gets the replaced
 *    file's owner and, unless `fileMode` is set, its mode.
 * 3. Renames the temp file to the target path (atomic on local filesystems).
 *    On Windows, a rename blocked by another program's open handle (`EPERM`,
 *    `EACCES`, `EBUSY`) is retried for up to 2 seconds.
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
	const tempPath = join(
		dirname(filePath),
		`.${basename(filePath, ".json")}-${crypto.randomUUID()}.tmp`,
	);

	await ensureDirectory(filePath, options.directoryMode);

	// Like write-file-atomic and atomically: the replacement keeps the replaced file's owner
	// (e.g. under sudo) and mode (e.g. a user's `chmod 600`).
	const existing = isWindows() ? undefined : await stat(filePath).catch(() => undefined);
	const fileMode = isWindows()
		? undefined
		: (options.fileMode ?? (existing === undefined ? undefined : existing.mode & 0o7777));

	try {
		const json = JSON.stringify(data, null, "\t");
		const handle = await open(tempPath, "w", fileMode);
		try {
			await handle.writeFile(json, "utf-8");
			await handle.sync();
		} finally {
			await handle.close();
		}
		// Before the chmod: chown clears setuid/setgid bits.
		if (existing !== undefined) {
			await chown(tempPath, existing.uid, existing.gid).catch((err: unknown) => {
				if (!isChownErrorOk(err)) throw err;
			});
		}
		// Enforce the mode exactly regardless of `umask`. Done on the temp inode
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
		await commit(tempPath, filePath);
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

/** How long a rename blocked by another program's open handle is retried on Windows. */
const RENAME_RETRY_MS = 2_000;
const MAX_RETRY_DELAY_MS = 100;
const BUSY_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);

/**
 * Renames `tempPath` over `filePath`.
 *
 * Windows refuses to replace a file that any process holds open, including another
 * process reading this store, an antivirus scanner, or an indexer; such handles are
 * usually brief.
 */
async function commit(tempPath: string, filePath: string): Promise<void> {
	const start = Date.now();
	for (let delay = 1; ; delay = Math.min(delay * 2, MAX_RETRY_DELAY_MS)) {
		try {
			return await rename(tempPath, filePath);
		} catch (err: unknown) {
			const busy = isWindows() && isErrnoException(err) && BUSY_CODES.has(err.code ?? "");
			if (!busy || Date.now() - start >= RENAME_RETRY_MS) throw err;
		}
		await sleep(delay);
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

/** A lock older than this was left behind: a mutation takes milliseconds. */
const STALE_LOCK_MS = 10_000;

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

/** Whether the lock was left behind: its process is gone, or it is older than {@link STALE_LOCK_MS}. */
async function isStaleLock(lockPath: string): Promise<boolean> {
	try {
		const owner: { pid?: unknown; host?: unknown } | null = JSON.parse(
			await readFile(lockPath, "utf-8"),
		);
		// A pid only identifies a process on the host that wrote it.
		const pid = owner?.host === hostname() ? owner.pid : undefined;
		if (typeof pid === "number" && !isProcessAlive(pid)) return true;
	} catch {
		// Created but not yet written, or already released: judged by age alone.
	}
	return stat(lockPath).then(
		(lock) => Date.now() - lock.mtimeMs > STALE_LOCK_MS,
		() => false,
	);
}

/**
 * Runs `fn` while holding `<filePath>.lock`, an advisory lock shared by every
 * process that uses this function on the same file.
 *
 * The lock file is created exclusively (`wx`) and holds the owner's pid and host.
 * Waiters retry with a growing, jittered delay and remove a lock whose process
 * is gone or that is older than 10 seconds. The lock is removed after `fn` settles.
 *
 * shortcut: two waiters that find the same abandoned lock at the same instant can
 * both take it, and a mutation running past 10 seconds loses its lock; either costs
 * one lost update, never a corrupt file. Use an ownership-checked takeover and a
 * heartbeat if stores ever see sustained parallel writers or slow mutations.
 *
 * @throws {CrustStoreError} `IO` when the lock file cannot be created or an abandoned one removed.
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
	// Windows refuses to create or delete a lock file another process has open or is
	// deleting (EPERM, EBUSY, EACCES; EFAULT from Bun). There that is contention, until it
	// outlasts a stale lock.
	let refusedSince: number | undefined;
	const isContention = (err: unknown): boolean => {
		if (process.platform !== "win32" || !isErrnoException(err)) return false;
		refusedSince ??= Date.now();
		return Date.now() - refusedSince < STALE_LOCK_MS;
	};
	for (let delay = 1; ; delay = Math.min(delay * 2, MAX_RETRY_DELAY_MS)) {
		try {
			const handle = await open(lockPath, "wx");
			// Creating the file took the lock; one without an owner is only recovered by age.
			await handle
				.writeFile(JSON.stringify({ pid: process.pid, host: hostname() }))
				.catch(() => {});
			await handle.close();
			break;
		} catch (err: unknown) {
			if (isErrnoException(err) && err.code === "ENOENT") {
				// No directory means no store file: nothing to delete, nothing to guard.
				if (options.operation === "delete") return await fn();
				await ensureDirectory(filePath, options.directoryMode);
				continue;
			}
			const held = isErrnoException(err) && err.code === "EEXIST";
			if (!held && !isContention(err)) throw lockError(err);
		}
		const removed =
			(await isStaleLock(lockPath)) &&
			(await rm(lockPath, { force: true }).then(
				() => true,
				(err: unknown) => {
					if (!isContention(err)) throw lockError(err);
					return false;
				},
			));
		if (!removed) await sleep(delay * (1 + Math.random()));
	}
	try {
		return await fn();
	} finally {
		await rm(lockPath, { force: true }).catch(() => {});
	}
}
