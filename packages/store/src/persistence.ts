// ────────────────────────────────────────────────────────────────────────────
// @crustjs/store — JSON persistence primitives
// ────────────────────────────────────────────────────────────────────────────

import { randomUUID } from "node:crypto";
import {
	chmod,
	mkdir,
	readFile,
	rename,
	rm,
	unlink,
	writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { CrustStoreError } from "./errors.ts";

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
	mode?: number;

	/**
	 * Unix permission bits for the parent directory (e.g. `0o700`).
	 *
	 * Applied only when this write actually creates the directory; a
	 * pre-existing directory is left untouched so callers retain control of it.
	 */
	dirMode?: number;
}

// ────────────────────────────────────────────────────────────────────────────
// readJson — Async JSON file read + parse
// ────────────────────────────────────────────────────────────────────────────

/**
 * Reads and parses a JSON config file from disk.
 *
 * Returns `undefined` when the file does not exist (ENOENT), allowing callers
 * to fall back to defaults. Malformed JSON throws a `CrustStoreError` with `PARSE`
 * code — the store never silently recovers corrupt data.
 *
 * @param filePath - Absolute path to the JSON config file.
 * @returns Parsed JSON value, or `undefined` if the file does not exist.
 * @throws {CrustStoreError} `PARSE` if the file contains malformed JSON.
 * @throws {CrustStoreError} `IO` on filesystem read failures other than ENOENT.
 */
export async function readJson(filePath: string): Promise<unknown | undefined> {
	let raw: string;

	try {
		raw = await readFile(filePath, "utf-8");
	} catch (err: unknown) {
		// File not found is a normal case — no persisted config yet
		if (isEnoent(err)) {
			return undefined;
		}

		throw new CrustStoreError("IO", `Failed to read config file: ${filePath}`, {
			path: filePath,
			operation: "read",
		}).withCause(err);
	}

	try {
		return JSON.parse(raw);
	} catch (err: unknown) {
		throw new CrustStoreError(
			"PARSE",
			`Malformed JSON in config file: ${filePath}`,
			{ path: filePath },
		).withCause(err);
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
 * @param filePath - Absolute path to the target JSON config file.
 * @param data - The value to serialize and persist.
 * @param options - Optional file/directory permission bits ({@link WriteJsonOptions}).
 * @throws {CrustStoreError} `IO` on filesystem write failures.
 */
export async function writeJson(
	filePath: string,
	data: unknown,
	options: WriteJsonOptions = {},
): Promise<void> {
	const { mode, dirMode } = options;
	const dir = dirname(filePath);
	const tempPath = join(dir, `.config-${randomUUID()}.tmp`);

	let createdDir: string | undefined;
	try {
		// Ensure parent directory exists. mkdir returns the first directory it
		// created (or undefined if the directory already existed).
		createdDir = await mkdir(dir, { recursive: true, mode: dirMode });
	} catch (err: unknown) {
		throw new CrustStoreError(
			"IO",
			`Failed to create config directory: ${dir}`,
			{
				path: filePath,
				operation: "write",
			},
		).withCause(err);
	}

	// Enforce `dirMode` exactly when we created the directory. mkdir's `mode` is
	// masked by `umask`, so a chmod is needed to guarantee the requested bits.
	if (dirMode !== undefined && createdDir !== undefined) {
		try {
			await chmod(dir, dirMode);
		} catch (err: unknown) {
			throw new CrustStoreError(
				"IO",
				`Failed to set permissions on config directory: ${dir}`,
				{
					path: filePath,
					operation: "write",
				},
			).withCause(err);
		}
	}

	try {
		const json = JSON.stringify(data, null, "\t");
		await writeFile(tempPath, json, { encoding: "utf-8", mode });
		// Enforce `mode` exactly regardless of `umask`. Done on the temp inode
		// before rename, which preserves the mode — so the final file is never
		// momentarily world-readable.
		if (mode !== undefined) await chmod(tempPath, mode);
	} catch (err: unknown) {
		// Best-effort cleanup of temp file
		await cleanupTempFile(tempPath);

		throw new CrustStoreError(
			"IO",
			`Failed to write config file: ${filePath}`,
			{
				path: filePath,
				operation: "write",
			},
		).withCause(err);
	}

	try {
		await rename(tempPath, filePath);
	} catch (err: unknown) {
		// Best-effort cleanup of temp file
		await cleanupTempFile(tempPath);

		throw new CrustStoreError(
			"IO",
			`Failed to finalize config file: ${filePath}`,
			{
				path: filePath,
				operation: "write",
			},
		).withCause(err);
	}
}

// ────────────────────────────────────────────────────────────────────────────
// deleteJson — Config file deletion
// ────────────────────────────────────────────────────────────────────────────

/**
 * Deletes a persisted config file from disk.
 *
 * Silently succeeds when the file does not exist (ENOENT) — deleting an
 * already-absent config is not an error.
 *
 * @param filePath - Absolute path to the JSON config file to delete.
 * @throws {CrustStoreError} `IO` on filesystem deletion failures other than ENOENT.
 */
export async function deleteJson(filePath: string): Promise<void> {
	try {
		await unlink(filePath);
	} catch (err: unknown) {
		// File already absent — not an error for reset() semantics
		if (isEnoent(err)) {
			return;
		}

		throw new CrustStoreError(
			"IO",
			`Failed to delete config file: ${filePath}`,
			{
				path: filePath,
				operation: "delete",
			},
		).withCause(err);
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Checks whether a thrown error is a filesystem "file not found" error.
 */
function isEnoent(err: unknown): boolean {
	return (
		err !== null &&
		typeof err === "object" &&
		"code" in err &&
		(err as { code: unknown }).code === "ENOENT"
	);
}

/**
 * Best-effort cleanup of a temp file — failures are intentionally swallowed
 * since the primary error is more important to surface.
 */
async function cleanupTempFile(tempPath: string): Promise<void> {
	try {
		await rm(tempPath, { force: true });
	} catch {
		// Intentionally swallowed — cleanup is best-effort
	}
}
