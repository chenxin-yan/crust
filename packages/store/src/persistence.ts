// ────────────────────────────────────────────────────────────────────────────
// @crustjs/store — JSON persistence primitives
// ────────────────────────────────────────────────────────────────────────────

import {
	chmod,
	mkdir,
	open,
	readdir,
	readFile,
	rename,
	rm,
	stat,
	utimes,
	writeFile,
} from "node:fs/promises";
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

/** Permission and commit options for {@link writeJson}. */
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

	/**
	 * Runs immediately before each attempt to rename the temp file into place;
	 * a rejection aborts the write, leaving the file untouched. Used to confirm the
	 * caller still holds its {@link withFileLock} lock.
	 */
	beforeCommit?: () => Promise<void>;
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
 * 2. Writes serialized JSON to a temporary file in the same directory and
 *    flushes it to disk (`fsync`), so a crash after the rename cannot leave an
 *    empty or partial file in place.
 * 3. Runs `beforeCommit`, then renames the temp file to the target path (atomic
 *    on local filesystems). On Windows, a rename blocked by another program's
 *    open handle (`EPERM`, `EACCES`, `EBUSY`) is retried for a few seconds.
 *
 * If any step fails, the function cleans up the temp file (best-effort) and
 * throws a `CrustStoreError` with `IO` code; a `beforeCommit` rejection is
 * rethrown as is.
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
		const handle = await open(tempPath, "w", fileMode);
		try {
			await handle.writeFile(json, "utf-8");
			await handle.sync();
		} finally {
			await handle.close();
		}
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
		await commit(tempPath, filePath, options.beforeCommit);
	} catch (err: unknown) {
		await rm(tempPath, { force: true }).catch(() => {});
		if (err instanceof CommitAborted) throw err.reason;

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
const RENAME_RETRY_MS = 5_000;
const MAX_RETRY_DELAY_MS = 100;
const BUSY_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);

/** Carries a `beforeCommit` rejection past the rename error wrapping. */
class CommitAborted {
	constructor(readonly reason: unknown) {}
}

/**
 * Renames `tempPath` over `filePath`, checking `beforeCommit` before every attempt.
 *
 * Windows refuses to replace a file another program (antivirus, an indexer, an
 * editor) holds open without delete sharing; such handles are usually brief.
 */
async function commit(
	tempPath: string,
	filePath: string,
	beforeCommit: (() => Promise<void>) | undefined,
): Promise<void> {
	const start = Date.now();
	for (let delay = 1; ; delay = Math.min(delay * 2, MAX_RETRY_DELAY_MS)) {
		await beforeCommit?.().catch((err: unknown) => {
			throw new CommitAborted(err);
		});
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
 * @param beforeCommit - Runs first; a rejection is rethrown and nothing is deleted.
 * @throws {CrustStoreError} `IO` on filesystem deletion failures other than ENOENT.
 */
export async function deleteJson(
	filePath: string,
	beforeCommit?: () => Promise<void>,
): Promise<void> {
	await beforeCommit?.();
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

/**
 * A lock whose heartbeat is older than this is abandoned even when its process
 * looks alive (pid reuse, another host, a frozen holder). A live holder refreshes
 * the lock's mtime every quarter of this, however long its mutation takes.
 */
const STALE_LOCK_MS = 10_000;

interface LockOwner {
	readonly pid: number;
	readonly host: string;
	/** Unique per acquisition, so equal contents mean the same lock, never a successor. */
	readonly token: string;
}

/** Options for {@link withFileLock}. */
export interface FileLockOptions {
	/** `"write"` creates a missing parent directory to hold the lock; `"delete"` runs unlocked instead. */
	readonly operation: "write" | "delete";
	/** Applied when acquiring the lock creates the parent directory, as in {@link writeJson}. */
	readonly directoryMode?: number;
	/** Test seam: how long a lock may go without a heartbeat before it is abandoned. */
	readonly staleMs?: number;
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

function parseOwner(contents: string): Partial<LockOwner> | undefined {
	try {
		const owner: unknown = JSON.parse(contents);
		return typeof owner === "object" && owner !== null ? owner : undefined;
	} catch {
		// Created but not yet written, or cut short by a crash: judged by mtime alone.
		return undefined;
	}
}

/** File contents, or `undefined` once the file is gone. */
async function readLock(lockPath: string): Promise<string | undefined> {
	try {
		return await readFile(lockPath, "utf-8");
	} catch (err: unknown) {
		if (isErrnoException(err) && err.code === "ENOENT") return undefined;
		throw err;
	}
}

/** Whether the lock or reclaim marker at `path`, holding `contents`, was abandoned. */
async function isStaleLock(path: string, contents: string, staleMs: number): Promise<boolean> {
	const owner = parseOwner(contents);
	// A pid only identifies a process on the host that wrote it.
	if (typeof owner?.pid === "number" && owner.host === hostname() && !isProcessAlive(owner.pid)) {
		return true;
	}
	try {
		return Date.now() - (await stat(path)).mtimeMs > staleMs;
	} catch {
		return false;
	}
}

/**
 * Unlinks the lock if it still holds `contents` and `confirm()` agrees. Returns
 * `false`, removing nothing, while another process is deciding this lock's fate.
 *
 * Why no one unlinks a successor's lock: removing a lock (release or stale
 * reclaim) first requires creating `<lock>.<token>.<level>` with `wx`, and only
 * that marker's holder unlinks the lock. Tokens are unique, so while the marker
 * holder re-reads `contents` and unlinks, the path cannot change: nobody else may
 * remove this lock, and nobody can create one while it exists. Markers are never
 * deleted by anyone but their holder; a marker whose holder died is bypassed via
 * the next level, which live processes again race for with `wx`.
 *
 * A marker whose holder died stays until the next lock holder removes it
 * ({@link removeOrphanMarkers}).
 *
 * shortcut: a marker holder stalled for longer than `staleMs` between re-read and
 * unlink can still be bypassed and then unlink a successor. That needs a process
 * frozen within a few syscalls; upgrade to an OS-level lock if it is ever observed.
 */
async function removeLock(
	lockPath: string,
	contents: string,
	staleMs: number,
	confirm: () => Promise<boolean>,
): Promise<boolean> {
	const token = parseOwner(contents)?.token;
	// Unparseable locks share one name; `confirm()` re-checks their age under the marker.
	const id = typeof token === "string" && /^[\w-]+$/.test(token) ? token : "unknown";
	const mine = JSON.stringify({ pid: process.pid, host: hostname() });
	for (let level = 0; ; level++) {
		const marker = `${lockPath}.${id}.${level}`;
		try {
			await writeFile(marker, mine, { flag: "wx" });
		} catch (err: unknown) {
			if (!isErrnoException(err) || err.code !== "EEXIST") throw err;
			const held = await readLock(marker);
			if (held === undefined || !(await isStaleLock(marker, held, staleMs))) return false;
			continue;
		}
		try {
			if ((await readLock(lockPath)) === contents && (await confirm())) {
				await rm(lockPath, { force: true });
			}
		} finally {
			await rm(marker, { force: true });
		}
		return true;
	}
}

/**
 * Removes abandoned reclaim markers (`<lock>.<token>.<level>`), so crashes do
 * not leave files behind.
 *
 * Called while holding the lock with `token`. Any other token's lock is gone for
 * good, so its markers can never authorize an unlink; removing an abandoned
 * one (judged as {@link removeLock} judges it before bypassing) is as safe as
 * the bypass itself.
 */
async function removeOrphanMarkers(lockPath: string, token: string, staleMs: number) {
	const dir = dirname(lockPath);
	const prefix = `${basename(lockPath)}.`;
	for (const name of await readdir(dir)) {
		const id = name.slice(prefix.length);
		if (!name.startsWith(prefix) || !/^[\w-]+\.\d+$/.test(id) || id.startsWith(`${token}.`)) {
			continue;
		}
		const marker = join(dir, name);
		const held = await readLock(marker);
		if (held !== undefined && (await isStaleLock(marker, held, staleMs))) {
			await rm(marker, { force: true });
		}
	}
}

/**
 * Runs `fn` while holding `<filePath>.lock`, an advisory lock shared by every
 * process that uses this function on the same file.
 *
 * The lock file is created exclusively (`wx`) and holds the owner's pid, host,
 * and a unique token; the owner refreshes its mtime while `fn` runs. Waiters
 * retry with a growing, jittered delay and take over a lock whose owner process
 * is gone or whose heartbeat stopped for 10 seconds. The lock is released after
 * `fn` settles, unless another process already took it over.
 *
 * `fn` receives `assertOwned`, which rejects unless the lock still holds this
 * owner's token and was refreshed within half the stale threshold, so no waiter
 * can be taking it over. Call it immediately before committing any change (see
 * `beforeCommit` of {@link writeJson}): a holder that was frozen or suspended past
 * the threshold then fails instead of overwriting its successor's work.
 *
 * @throws {CrustStoreError} `IO` when the lock file cannot be created or inspected.
 */
export async function withFileLock<T>(
	filePath: string,
	fn: (assertOwned: () => Promise<void>) => Promise<T>,
	options: FileLockOptions,
): Promise<T> {
	const lockPath = `${filePath}.lock`;
	const staleMs = options.staleMs ?? STALE_LOCK_MS;
	const lockError = (err: unknown) =>
		new CrustStoreError(
			"IO",
			`Failed to lock store file: ${filePath}`,
			{ path: filePath, operation: options.operation },
			err,
		);
	const owner: LockOwner = { pid: process.pid, host: hostname(), token: crypto.randomUUID() };
	const contents = JSON.stringify(owner);
	let delay = 1;
	for (;;) {
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
				if (options.operation === "delete") return await fn(async () => {});
				await ensureDirectory(filePath, options.directoryMode);
				continue;
			}
			if (!isErrnoException(err) || err.code !== "EEXIST") throw lockError(err);
		}

		try {
			const held = await readLock(lockPath);
			if (held === undefined) continue;
			const heldIsStale = () => isStaleLock(lockPath, held, staleMs);
			if ((await heldIsStale()) && (await removeLock(lockPath, held, staleMs, heldIsStale))) {
				continue;
			}
		} catch (err: unknown) {
			throw lockError(err);
		}
		await sleep(delay * (1 + Math.random()));
		delay = Math.min(delay * 2, MAX_RETRY_DELAY_MS);
	}

	await removeOrphanMarkers(lockPath, owner.token, staleMs).catch(() => {});

	/** Whether the lock holds our token and was refreshed less than `maxAge` ago. */
	const ownsLock = async (maxAge: number): Promise<boolean> => {
		// Stat first: if the read then finds our token, the stat saw our lock too.
		try {
			if (Date.now() - (await stat(lockPath)).mtimeMs >= maxAge) return false;
		} catch (err: unknown) {
			if (isErrnoException(err) && err.code === "ENOENT") return false;
			throw err;
		}
		return (await readLock(lockPath)) === contents;
	};
	const heartbeat = setInterval(() => {
		// Never revive a lock that went stale: a waiter may already be removing it.
		ownsLock(staleMs)
			.then((owned) => {
				if (!owned) return clearInterval(heartbeat);
				const now = new Date();
				return utimes(lockPath, now, now);
			})
			.catch(() => {});
	}, staleMs / 4);
	heartbeat.unref();
	// Half the stale threshold leaves the caller that much time to commit before any waiter may act.
	const assertOwned = async () => {
		const owned = await ownsLock(staleMs / 2).catch((err: unknown) => err);
		if (owned === true) return;
		throw new CrustStoreError(
			"IO",
			`Lost the lock on store file: ${filePath}`,
			{ path: filePath, operation: options.operation },
			owned === false ? undefined : owned,
		);
	};
	try {
		return await fn(assertOwned);
	} finally {
		clearInterval(heartbeat);
		// Waits out a waiter that is judging this lock stale (only after a stalled heartbeat).
		for (delay = 1; ; delay = Math.min(delay * 2, MAX_RETRY_DELAY_MS)) {
			const settled = await removeLock(lockPath, contents, staleMs, async () => true).catch(
				() => true,
			);
			if (settled) break;
			await sleep(delay * (1 + Math.random()));
		}
	}
}
