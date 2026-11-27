// ────────────────────────────────────────────────────────────────────────────
// @crustjs/store — JSON persistence primitives
// ────────────────────────────────────────────────────────────────────────────

import type { FileHandle } from "node:fs/promises";

import { isErrnoException } from "@crustjs/utils/error";
import type { JsonValue } from "@crustjs/utils/json";

import { CrustStoreError, type IOErrorDetails } from "./errors.ts";

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
 * The largest store file read or written. A store file may be one the user or another program
 * put there, and it is read whole into memory; 16 MiB is far above any settings, state or cache
 * document, and is the limit Crust already sets on a user-supplied file (`api preview --body @file`).
 */
export const MAX_FILE_BYTES: number = 16 * 1024 * 1024;

/**
 * Reads and parses a JSON store file from disk.
 *
 * Returns `undefined` when the file does not exist (ENOENT), allowing callers
 * to fall back to defaults. Malformed JSON throws a `CrustStoreError` with `PARSE`
 * code — the store never silently recovers corrupt data. Only a regular file (or a
 * symbolic link to one) is read, never more than {@link MAX_FILE_BYTES}, and a
 * leading byte order mark is ignored.
 *
 * @param filePath - Absolute path to the JSON store file.
 * @returns Parsed JSON value, or `undefined` if the file does not exist.
 * @throws {CrustStoreError} `PATH` if the path is not a regular file (a directory, FIFO or device),
 *   or the file is larger than the limit.
 * @throws {CrustStoreError} `PARSE` if the file contains malformed JSON.
 * @throws {CrustStoreError} `IO` on filesystem read failures other than ENOENT.
 */
export async function readJson(
	filePath: string,
	parse: (text: string) => unknown = JSON.parse,
): Promise<JsonValue | undefined> {
	const notRegular = () =>
		new CrustStoreError("PATH", `Store file is not a regular file: ${filePath}`, {
			path: filePath,
		});
	// PATH, not PARSE: the file was not read, so nothing says it is corrupt and may be replaced.
	const tooLarge = () =>
		new CrustStoreError("PATH", `Store file is larger than 16 MiB: ${filePath}`, {
			path: filePath,
		});
	const readError = (err: unknown) =>
		new CrustStoreError(
			"IO",
			`Failed to read store file: ${filePath}`,
			{
				path: filePath,
				operation: "read",
			},
			err,
		);

	const fs = process.getBuiltinModule("node:fs/promises");
	let handle: FileHandle;
	try {
		// Non-blocking, so opening a FIFO without a writer returns at once; Windows has no such flag.
		handle = await fs.open(filePath, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0));
	} catch (err: unknown) {
		// File not found is a normal case — nothing persisted yet
		if (isErrnoException(err) && err.code === "ENOENT") {
			return undefined;
		}
		if (isErrnoException(err) && err.code === "EISDIR") throw notRegular();
		throw readError(err);
	}

	let raw: string;
	try {
		const stats = await handle.stat();
		if (!stats.isFile()) throw notRegular();
		if (stats.size > MAX_FILE_BYTES) throw tooLarge();
		// Read to the end rather than trusting the size: the file may grow while it is read. One buffer,
		// grown only when full, and never more than one byte past the limit is asked for.
		let buffer = Buffer.allocUnsafe(stats.size + 1);
		let length = 0;
		for (;;) {
			if (length === buffer.length) {
				if (length > MAX_FILE_BYTES) break;
				const grown = Buffer.allocUnsafe(Math.min(length * 2, MAX_FILE_BYTES + 1));
				buffer.copy(grown, 0, 0, length);
				buffer = grown;
			}
			const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
			if (bytesRead === 0) break;
			length += bytesRead;
		}
		if (length > MAX_FILE_BYTES) throw tooLarge();
		// Editors on Windows may save a byte order mark, which JSON.parse rejects.
		raw = buffer.toString("utf-8", 0, length).replace(/^\uFEFF/u, "");
	} catch (err: unknown) {
		throw err instanceof CrustStoreError ? err : readError(err);
	} finally {
		await handle.close().catch(() => {});
	}

	try {
		// SAFETY: a format's `parse` returns what the file holds; the store's fields check it.
		return parse(raw) as JsonValue;
	} catch (err: unknown) {
		throw new CrustStoreError(
			"PARSE",
			`Malformed ${parse === JSON.parse ? "JSON in store" : "store"} file: ${filePath}`,
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
 * exactly when this call created it. On POSIX, every directory it creates is flushed into
 * its parent, so the store file's directory survives a power loss.
 */
export async function ensureDirectory(filePath: string, mode: number | undefined): Promise<void> {
	const { chmod, mkdir } = process.getBuiltinModule("node:fs/promises");
	const { dirname } = process.getBuiltinModule("node:path");
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
	// A new directory's entry lives in its parent: flush the parent of each directory created.
	if (createdDir === undefined) return;
	for (let created = dir; ; created = dirname(created)) {
		await syncDirectory(created, "write");
		if (created === createdDir || dirname(created) === created) break;
	}
}

/**
 * Refuses a store file that is a symbolic link (on Windows, whatever `lstat` reports as one),
 * so nothing is read or written through it. A missing file passes.
 *
 * @throws {CrustStoreError} `PATH` when the file is a symbolic link.
 */
export async function refuseSymlink(
	filePath: string,
	operation: IOErrorDetails["operation"],
): Promise<void> {
	let stats;
	try {
		stats = await process.getBuiltinModule("node:fs/promises").lstat(filePath);
	} catch (err: unknown) {
		if (isErrnoException(err) && err.code === "ENOENT") return;
		throw new CrustStoreError(
			"IO",
			`Failed to inspect store file: ${filePath}`,
			{ path: filePath, operation },
			err,
		);
	}
	if (stats.isSymbolicLink()) {
		throw new CrustStoreError(
			"PATH",
			`Refusing store file that is a symbolic link: ${filePath}. A strict store never reads or writes through a link; remove the link yourself.`,
			{ path: filePath, reason: "symlink" },
		);
	}
}

// ────────────────────────────────────────────────────────────────────────────
// writeJson — Atomic JSON file write (temp file + rename)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Atomically writes JSON text to disk using a temp-file-and-rename strategy.
 *
 * Steps:
 * 1. Creates the parent directory if it does not exist.
 * 2. Writes the text to a temporary file in the same directory and
 *    flushes it to disk (`fsync`), so a crash after the rename cannot leave an
 *    empty or partial file in place. On POSIX the temp file gets the replaced
 *    file's owner and, unless `fileMode` is set, its mode.
 * 3. Renames the temp file to the target path (atomic on local filesystems).
 *    On Windows, a rename blocked by another program's open handle (`EPERM`,
 *    `EACCES`, `EBUSY`) is retried for up to 2 seconds.
 * 4. On POSIX, flushes the directory (`fsync`), so the rename survives a power loss.
 *    Windows has no directory flush.
 *
 * The temp file is created exclusively (`wx`).
 *
 * If any step fails, the function cleans up the temp file (best-effort) and
 * throws a `CrustStoreError` with `IO` code.
 *
 * @param filePath - Absolute path to the target JSON store file.
 * @param json - The serialized document to persist.
 * @param options - Optional file/directory permission bits ({@link WriteJsonOptions}).
 * @throws {CrustStoreError} `IO` on filesystem write failures.
 */
export async function writeJson(
	filePath: string,
	json: string,
	options: WriteJsonOptions = {},
): Promise<void> {
	const { chmod, chown, open, rm, stat } = process.getBuiltinModule("node:fs/promises");
	const { basename, dirname, join } = process.getBuiltinModule("node:path");
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
		const handle = await open(tempPath, "wx", fileMode);
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

	await syncDirectory(filePath, "write");
}

/**
 * Flushes the directory that holds `filePath`, so a completed rename, delete, or `mkdir` of
 * `filePath` survives a power loss. POSIX only: Windows cannot open a directory for flushing.
 * A missing directory has nothing to flush.
 */
async function syncDirectory(filePath: string, operation: "write" | "delete"): Promise<void> {
	if (isWindows()) return;
	const dir = process.getBuiltinModule("node:path").dirname(filePath);
	try {
		const handle = await process.getBuiltinModule("node:fs/promises").open(dir, "r");
		try {
			await handle.sync();
		} finally {
			await handle.close();
		}
	} catch (err: unknown) {
		if (isErrnoException(err) && err.code === "ENOENT") return;
		throw new CrustStoreError(
			"IO",
			`Failed to flush store directory: ${dir}`,
			{ path: filePath, operation },
			err,
		);
	}
}

/** How long a rename blocked by another program's open handle is retried on Windows. */
const RENAME_RETRY_MS = 2_000;
export const MAX_RETRY_DELAY_MS = 100;
export const BUSY_CODES: ReadonlySet<string> = new Set(["EPERM", "EACCES", "EBUSY"]);

/** Sleeps `ms`; an abort rejects with `signal.reason`. */
export async function abortableSleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
	await process
		.getBuiltinModule("node:timers/promises")
		.setTimeout(ms, undefined, { signal })
		.catch(() => signal?.throwIfAborted());
}

/**
 * Renames `tempPath` over `filePath`.
 *
 * Windows refuses to replace a file that any process holds open, including another
 * process reading this store, an antivirus scanner, or an indexer; such handles are
 * usually brief.
 */
async function commit(tempPath: string, filePath: string): Promise<void> {
	const { rename } = process.getBuiltinModule("node:fs/promises");
	const start = Date.now();
	for (let delay = 1; ; delay = Math.min(delay * 2, MAX_RETRY_DELAY_MS)) {
		try {
			return await rename(tempPath, filePath);
		} catch (err: unknown) {
			const busy = isWindows() && isErrnoException(err) && BUSY_CODES.has(err.code ?? "");
			if (!busy || Date.now() - start >= RENAME_RETRY_MS) throw err;
		}
		await process.getBuiltinModule("node:timers/promises").setTimeout(delay);
	}
}

// ────────────────────────────────────────────────────────────────────────────
// deleteJson — Store file deletion
// ────────────────────────────────────────────────────────────────────────────

/**
 * Deletes a persisted store file from disk.
 *
 * Silently succeeds when the file does not exist (ENOENT) — deleting an
 * already-absent file is not an error. On POSIX the directory is then flushed,
 * so a completed delete survives a power loss.
 *
 * @param filePath - Absolute path to the JSON store file to delete.
 * @throws {CrustStoreError} `IO` on filesystem deletion failures other than ENOENT.
 */
export async function deleteJson(filePath: string): Promise<void> {
	try {
		await process.getBuiltinModule("node:fs/promises").rm(filePath, { force: true });
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
	await syncDirectory(filePath, "delete");
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
	/** Stops waiting for the lock: rejects with `signal.reason`. Not observed once the lock is held. */
	readonly signal?: AbortSignal;
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

/** The pid a lock file names, or `undefined` when it has none: missing, not yet written, or another host's. */
async function readLockPid(lockPath: string): Promise<number | undefined> {
	try {
		const fs = process.getBuiltinModule("node:fs/promises");
		// A lock is a file of its own: a link or a device at the path, as a cloned folder can hold, is not read.
		if (!(await fs.lstat(lockPath)).isFile()) return undefined;
		const owner: { pid?: unknown; host?: unknown } | null = JSON.parse(
			await fs.readFile(lockPath, "utf-8"),
		);
		// A pid only identifies a process on the host that wrote it.
		return owner?.host === process.getBuiltinModule("node:os").hostname() &&
			typeof owner.pid === "number"
			? owner.pid
			: undefined;
	} catch {
		return undefined;
	}
}

/** Whether the lock was left behind: its process is gone, or it is older than {@link STALE_LOCK_MS}. */
async function isStaleLock(lockPath: string): Promise<boolean> {
	const pid = await readLockPid(lockPath);
	// The owner may have released the lock and exited since that read, and the path may now hold
	// a successor's lock: only a lock that still names the dead process was left behind.
	if (pid !== undefined && !isProcessAlive(pid) && (await readLockPid(lockPath)) === pid) {
		return true;
	}
	return process
		.getBuiltinModule("node:fs/promises")
		.lstat(lockPath)
		.then(
			(lock) => Date.now() - lock.mtimeMs > STALE_LOCK_MS,
			() => false,
		);
}

/**
 * Runs `fn` while holding `<filePath>.lock`, an advisory lock shared by every
 * process that uses this function on the same file. A store that is not `strict` holds it
 * around each mutation of its file. It does not reenter: `fn` must not take it again.
 *
 * The lock file is created exclusively (`wx`) and holds the owner's pid and host.
 * Waiters retry with a growing, jittered delay and remove a lock whose process
 * is gone or that is older than 10 seconds. After `fn` settles the lock is removed,
 * unless a takeover has put another process's lock at the path.
 *
 * shortcut: checking a lock and removing it are two steps, so two waiters that find the
 * same abandoned lock at the same instant can both take it, and a mutation running past
 * 10 seconds loses its lock; either costs lost updates, never a corrupt file. A store that
 * cannot accept that sets `strict`, which locks with `withLock` instead.
 *
 * `filePath` must be absolute, like a store's `dirPath`: a relative one would follow the working
 * directory while the call waits.
 *
 * @throws {CrustStoreError} `PATH` when `filePath` is not absolute.
 * @throws {CrustStoreError} `IO` when the lock file cannot be created or an abandoned one removed.
 */
export async function withFileLock<T>(
	filePath: string,
	fn: () => Promise<T>,
	options: FileLockOptions,
): Promise<T> {
	// The host's rule, since the path is opened here: `C:/state.json` is relative outside Windows.
	if (!process.getBuiltinModule("node:path").isAbsolute(filePath)) {
		throw new CrustStoreError("PATH", "filePath must be an absolute path", { path: filePath });
	}
	const { open, rm } = process.getBuiltinModule("node:fs/promises");
	const lockPath = `${filePath}.lock`;
	const lockError = (err: unknown) =>
		new CrustStoreError(
			"IO",
			`Failed to lock store file: ${filePath}`,
			{ path: filePath, operation: options.operation },
			err,
		);
	// Before the lock exists, so a failure here leaves nothing to clean up.
	let owner: string;
	try {
		const host = process.getBuiltinModule("node:os").hostname();
		owner = JSON.stringify({ pid: process.pid, host });
	} catch (err: unknown) {
		throw lockError(err);
	}
	// On Windows a create or delete that races another process's delete of the same file
	// fails with an access error. That is contention, until it outlasts a stale lock.
	// TODO: Bun reports the delete's EPERM as EFAULT; drop EFAULT here once
	// https://github.com/oven-sh/bun/issues/48811 is fixed.
	let refusedSince: number | undefined;
	const isContention = (err: unknown): boolean => {
		const code = isWindows() && isErrnoException(err) ? (err.code ?? "") : "";
		if (code !== "EFAULT" && !BUSY_CODES.has(code)) return false;
		refusedSince ??= Date.now();
		return Date.now() - refusedSince < STALE_LOCK_MS;
	};
	// An unnamed lock of ours is only taken over by age, so it is still ours to remove.
	let named = true;
	for (let delay = 1; ; delay = Math.min(delay * 2, MAX_RETRY_DELAY_MS)) {
		options.signal?.throwIfAborted();
		try {
			const handle = await open(lockPath, "wx");
			try {
				// Creating the file took the lock; one without an owner is only recovered by age.
				await handle.writeFile(owner).catch(() => {
					named = false;
				});
				await handle.close();
			} catch (err: unknown) {
				// The lock is ours but unusable: release it, so it never stalls the next mutation.
				await handle.close().catch(() => {});
				await rm(lockPath, { force: true }).catch(() => {});
				throw err;
			}
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
		if (!removed) await abortableSleep(delay * (1 + Math.random()), options.signal);
	}
	try {
		return await fn();
	} finally {
		// After a takeover the path may hold another process's lock: remove only our own. A refused
		// delete is tried again, since a lock left behind stalls this process's next mutation
		// for 10 seconds; each try checks the owner first.
		for (let attempt = 0; attempt < 3; attempt++) {
			if (named && (await readLockPid(lockPath)) !== process.pid) break;
			const done = await rm(lockPath, { force: true }).then(
				() => true,
				() => !named,
			);
			if (done) break;
			await process.getBuiltinModule("node:timers/promises").setTimeout(10);
		}
	}
}
