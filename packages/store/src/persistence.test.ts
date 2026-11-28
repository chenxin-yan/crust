/**
 * @module-tag windows
 * @module-tag macos
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
	chmod,
	chown,
	lstat,
	lutimes,
	mkdir,
	readdir,
	readFile,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { deleteJson, readJson, withFileLock, writeJson } from "./persistence.ts";

// Error codes the next `rename` calls fail with, as when another program holds the target open.
const renameFailures = vi.hoisted((): string[] => []);
// Error codes the next `rm` calls fail with, as when another program holds the lock file open.
const rmFailures = vi.hoisted((): string[] => []);
// Error codes the next `sync` of a handle opened on the keyed path fails with.
const syncFailures = vi.hoisted(() => new Map<string, string>());
// Replaces `read` and `stat` of a handle opened on the keyed path, to model short reads and growth.
const handleOverrides = vi.hoisted(
	() =>
		new Map<
			string,
			{
				read?: (buffer: Buffer, offset: number, length: number) => number;
				size?: number;
			}
		>(),
);
// Error codes the next `close` of a handle opened on the keyed path fails with, after closing.
const closeFailures = vi.hoisted(() => new Map<string, string>());
// Durability-relevant fs calls in order, as `<call> <path>`; the fsync order is asserted on it.
const fsTrace = vi.hoisted((): string[] => []);
vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	const rename = vi.fn(async (from: string, to: string) => {
		fsTrace.push(`rename ${to}`);
		const code = renameFailures.shift();
		if (code !== undefined) throw Object.assign(new Error(code), { code });
		return actual.rename(from, to);
	});
	// Unprivileged tests cannot give a file another owner, so the owner copy is observed here.
	const chown = vi.fn(actual.chown);
	const chmod: typeof actual.chmod = async (path, mode) => {
		fsTrace.push(`chmod ${String(path)}`);
		return actual.chmod(path, mode);
	};
	const rm: typeof actual.rm = async (path, options) => {
		fsTrace.push(`rm ${String(path)}`);
		const code = rmFailures.shift();
		if (code !== undefined) throw Object.assign(new Error(code), { code });
		return actual.rm(path, options);
	};
	const open = vi.fn(async (...args: Parameters<typeof actual.open>) => {
		const path = String(args[0]);
		const handle = await actual.open(...args);
		fsTrace.push(`open ${path} ${String(args[1] ?? "r")}`);
		const sync = handle.sync.bind(handle);
		handle.sync = async () => {
			fsTrace.push(`sync ${path}`);
			const code = syncFailures.get(path);
			syncFailures.delete(path);
			if (code !== undefined) throw Object.assign(new Error(code), { code });
			return sync();
		};
		const close = handle.close.bind(handle);
		handle.close = async () => {
			await close();
			const code = closeFailures.get(path);
			closeFailures.delete(path);
			if (code !== undefined) throw Object.assign(new Error(code), { code });
		};
		const override = handleOverrides.get(path);
		if (override?.size !== undefined) {
			const stat = handle.stat.bind(handle);
			const size = override.size;
			handle.stat = (async () => Object.assign(await stat(), { size })) as typeof handle.stat;
		}
		const read = override?.read;
		if (read !== undefined) {
			handle.read = (async (buffer: Buffer, offset: number, length: number) => ({
				bytesRead: read(buffer, offset, length),
				buffer,
			})) as typeof handle.read;
		}
		return handle;
	});
	const mocked = { rename, chown, chmod, rm, open };
	const fs = { ...actual, ...mocked };
	// The store loads built-ins with process.getBuiltinModule, which vi.mock does not reach.
	const getBuiltinModule = process.getBuiltinModule.bind(process);
	process.getBuiltinModule = (id: string) =>
		id === "node:fs/promises" ? fs : getBuiltinModule(id);
	return { ...fs, default: fs };
});

// ────────────────────────────────────────────────────────────────────────────
// Test helpers
// ────────────────────────────────────────────────────────────────────────────

/** Creates a unique temp directory for each test to avoid cross-test pollution. */
function createTempDir(): string {
	return join(tmpdir(), `crust-store-test-${randomUUID()}`);
}

// ────────────────────────────────────────────────────────────────────────────
// readJson
// ────────────────────────────────────────────────────────────────────────────

describe("readJson", () => {
	let tempDir: string;
	let filePath: string;

	beforeEach(async () => {
		tempDir = createTempDir();
		await mkdir(tempDir, { recursive: true });
		filePath = join(tempDir, "config.json");
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("should throw CrustStoreError PARSE on malformed JSON", async () => {
		await writeFile(filePath, "{ invalid json }}}");

		await expect(readJson(filePath)).rejects.toMatchObject({
			name: "CrustStoreError",
			code: "PARSE",
			message: `Malformed JSON in store file: ${filePath}`,
			details: { path: filePath },
			cause: expect.any(SyntaxError),
		});
	});

	it("fills one buffer across short reads, asking no more than it may keep", async () => {
		const text = JSON.stringify({ items: "x".repeat(3000) });
		await writeFile(filePath, text);
		const buffers = new Set<ArrayBufferLike>();
		let position = 0;
		handleOverrides.set(filePath, {
			read: (buffer, offset, length) => {
				buffers.add(buffer.buffer);
				expect(offset + length).toBeLessThanOrEqual(text.length + 1);
				// One byte at a time, as a slow filesystem might answer.
				if (position === text.length || length === 0) return 0;
				buffer[offset] = text.charCodeAt(position++);
				return 1;
			},
		});
		try {
			expect(await readJson(filePath)).toEqual(JSON.parse(text));
			expect(buffers.size).toBe(1);
		} finally {
			handleOverrides.clear();
		}
	});

	it("stops one byte past 16 MiB when the file grows after it was inspected", async () => {
		await writeFile(filePath, "{}");
		let requested = 0;
		handleOverrides.set(filePath, {
			size: 2,
			read: (buffer, offset, length) => {
				requested += length;
				buffer.fill(32, offset, offset + length);
				return length;
			},
		});
		try {
			await expect(readJson(filePath)).rejects.toMatchObject({
				code: "PATH",
				message: `Store file is larger than 16 MiB: ${filePath}`,
			});
			expect(requested).toBe(16 * 1024 * 1024 + 1);
		} finally {
			handleOverrides.clear();
		}
	});

	// POSIX-only: on Windows chmod cannot make a file unreadable.
	it.skipIf(process.platform === "win32")(
		"should throw CrustStoreError IO on permission denied",
		async () => {
			await writeFile(filePath, JSON.stringify({ ok: true }));
			await chmod(filePath, 0o000);

			try {
				await expect(readJson(filePath)).rejects.toMatchObject({
					name: "CrustStoreError",
					code: "IO",
					details: { path: filePath, operation: "read" },
					cause: expect.anything(),
				});
			} finally {
				// Restore permissions for cleanup
				await chmod(filePath, 0o644);
			}
		},
	);
});

// ────────────────────────────────────────────────────────────────────────────
// writeJson
// ────────────────────────────────────────────────────────────────────────────

describe("writeJson", () => {
	let tempDir: string;
	let filePath: string;

	beforeEach(() => {
		tempDir = createTempDir();
		filePath = join(tempDir, "config.json");
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("should create parent directory if missing", async () => {
		const nested = join(tempDir, "deep", "nested", "config.json");

		await writeJson(nested, JSON.stringify({ created: true }));

		expect(existsSync(nested)).toBe(true);
		const raw = await readFile(nested, "utf-8");
		expect(JSON.parse(raw)).toEqual({ created: true });
	});

	// POSIX permission bits only. On Windows the store ignores modes (it uses
	// ACLs, not Unix bits), so these exact-mode assertions do not apply.
	describe.skipIf(process.platform === "win32")("permission bits", () => {
		it("should create the file with the requested mode regardless of umask", async () => {
			await mkdir(tempDir);
			const previous = process.umask(0o777);
			try {
				await writeJson(filePath, JSON.stringify({ secret: true }), { fileMode: 0o600 });

				const { mode } = await stat(filePath);
				// Mask off the file-type bits, keep permission bits only.
				expect(mode & 0o777).toBe(0o600);
			} finally {
				process.umask(previous);
			}
		});

		it("should apply directoryMode when it creates the directory", async () => {
			await mkdir(tempDir);
			const nested = join(tempDir, "secret-dir", "config.json");
			const previous = process.umask(0o777);
			try {
				await writeJson(nested, JSON.stringify({ data: true }), { directoryMode: 0o700 });

				const { mode } = await stat(join(tempDir, "secret-dir"));
				expect(mode & 0o777).toBe(0o700);
			} finally {
				process.umask(previous);
			}
		});

		it("should leave a pre-existing directory's mode untouched", async () => {
			await mkdir(tempDir, { recursive: true });
			await chmod(tempDir, 0o755);

			await writeJson(filePath, JSON.stringify({ data: true }), { directoryMode: 0o700 });

			const { mode } = await stat(tempDir);
			expect(mode & 0o777).toBe(0o755);
		});

		it("keeps the mode of the file it replaces when no fileMode is set", async () => {
			await writeJson(filePath, JSON.stringify({ data: 1 }));
			await chmod(filePath, 0o600);

			await writeJson(filePath, JSON.stringify({ data: 2 }));

			expect((await stat(filePath)).mode & 0o7777).toBe(0o600);
		});

		it("gives the replacement the owner of the file it replaces", async () => {
			await writeJson(filePath, JSON.stringify({ data: 1 }));
			const { uid, gid } = await stat(filePath);
			vi.mocked(chown).mockClear();

			await writeJson(filePath, JSON.stringify({ data: 2 }));

			expect(chown).toHaveBeenCalledWith(expect.stringMatching(/\.tmp$/), uid, gid);
		});

		it("ignores a refused owner copy when not running as root", async () => {
			await writeJson(filePath, JSON.stringify({ data: 1 }));
			vi.mocked(chown).mockRejectedValueOnce(Object.assign(new Error("EPERM"), { code: "EPERM" }));
			const getuid = vi.spyOn(process, "getuid").mockReturnValue(1000);
			try {
				await writeJson(filePath, JSON.stringify({ data: 2 }));
			} finally {
				getuid.mockRestore();
			}

			expect(JSON.parse(await readFile(filePath, "utf-8"))).toEqual({ data: 2 });
		});
	});

	it.skipIf(process.platform === "win32")(
		"replaces a symlinked store file and leaves the link's target alone",
		async () => {
			const target = join(tempDir, "target.json");
			await mkdir(tempDir);
			await writeFile(target, "{}");
			await symlink(target, filePath);

			await writeJson(filePath, JSON.stringify({ data: true }));

			expect((await lstat(filePath)).isFile()).toBe(true);
			expect(await readFile(target, "utf-8")).toBe("{}");
		},
	);

	// Killing a process cannot show power-loss durability; the order of the flushes can.
	it.skipIf(process.platform === "win32")(
		"creates the temp file exclusively, flushes it before the rename and the directory after",
		async () => {
			await mkdir(tempDir);
			fsTrace.length = 0;

			await writeJson(filePath, JSON.stringify({ data: true }), { fileMode: 0o600 });

			const tempPath = fsTrace[0]?.split(" ")[1] ?? "";
			expect(tempPath).toMatch(/[\\/]\.config-[\w-]+\.tmp$/);
			expect(fsTrace).toEqual([
				`open ${tempPath} wx`,
				`sync ${tempPath}`,
				`chmod ${tempPath}`,
				`rename ${filePath}`,
				`open ${tempDir} r`,
				`sync ${tempDir}`,
			]);
		},
	);

	// A new directory's entry lives in its parent, so each parent it was created in is flushed too.
	it.skipIf(process.platform === "win32")(
		"flushes the parent of every directory it creates before the first write",
		async () => {
			await mkdir(tempDir);
			const nested = join(tempDir, "a", "b", "config.json");
			fsTrace.length = 0;

			await writeJson(nested, JSON.stringify({ data: true }));

			const tempPath = fsTrace.find((entry) => entry.endsWith(" wx"))?.split(" ")[1] ?? "";
			expect(fsTrace).toEqual([
				`open ${join(tempDir, "a")} r`,
				`sync ${join(tempDir, "a")}`,
				`open ${tempDir} r`,
				`sync ${tempDir}`,
				`open ${tempPath} wx`,
				`sync ${tempPath}`,
				`rename ${nested}`,
				`open ${join(tempDir, "a", "b")} r`,
				`sync ${join(tempDir, "a", "b")}`,
			]);
		},
	);

	it.skipIf(process.platform === "win32")(
		"rejects with IO when the directory flush after the rename fails",
		async () => {
			await mkdir(tempDir);
			syncFailures.set(tempDir, "EIO");

			await expect(writeJson(filePath, JSON.stringify({ data: true }))).rejects.toMatchObject({
				code: "IO",
				details: { path: filePath, operation: "write" },
				cause: { code: "EIO" },
			});
		},
	);

	it.skipIf(process.platform === "win32")(
		"does not retry a failed rename outside Windows",
		async () => {
			renameFailures.push("EPERM");

			await expect(writeJson(filePath, JSON.stringify({ data: true }))).rejects.toMatchObject({
				code: "IO",
				message: `Failed to finalize store file: ${filePath}`,
				cause: { code: "EPERM" },
			});
			expect(await readdir(tempDir)).toEqual([]);
		},
	);

	describe("on Windows", () => {
		const platform = process.platform;
		beforeEach(() => {
			Object.defineProperty(process, "platform", { value: "win32" });
		});
		afterEach(() => {
			Object.defineProperty(process, "platform", { value: platform });
			renameFailures.length = 0;
		});

		it("retries a rename that another program's open handle blocks", async () => {
			renameFailures.push("EPERM", "EBUSY", "EACCES");

			await writeJson(filePath, JSON.stringify({ data: true }));

			expect(renameFailures).toEqual([]);
			expect(JSON.parse(await readFile(filePath, "utf-8"))).toEqual({ data: true });
			expect(await readdir(tempDir)).toEqual(["config.json"]);
		});

		it("skips the modes and the directory flush", async () => {
			await mkdir(tempDir);
			fsTrace.length = 0;

			await writeJson(filePath, JSON.stringify({ data: true }), { fileMode: 0o600 });

			const tempPath = fsTrace[0]?.split(" ")[1] ?? "";
			expect(fsTrace).toEqual([`open ${tempPath} wx`, `sync ${tempPath}`, `rename ${filePath}`]);
		});

		it("does not retry other rename errors", async () => {
			renameFailures.push("ENOENT", "EPERM");

			await expect(writeJson(filePath, JSON.stringify({ data: true }))).rejects.toMatchObject({
				cause: { code: "ENOENT" },
			});
		});
	});

	it("should throw CrustStoreError IO when directory creation fails", async () => {
		await mkdir(tempDir);
		const parentFile = join(tempDir, "not-a-directory");
		await writeFile(parentFile, "sentinel");
		const badPath = join(parentFile, "impossible", "config.json");

		await expect(writeJson(badPath, JSON.stringify({ data: true }))).rejects.toMatchObject({
			name: "CrustStoreError",
			code: "IO",
			details: { operation: "write" },
			cause: expect.anything(),
		});
	});
});

// ────────────────────────────────────────────────────────────────────────────
// deleteJson
// ────────────────────────────────────────────────────────────────────────────

describe("withFileLock", () => {
	it("refuses a relative path before locking anything", async () => {
		const fn = vi.fn(async () => "ran");
		await expect(withFileLock("state.json", fn, { operation: "write" })).rejects.toMatchObject({
			code: "PATH",
			message: "filePath must be an absolute path",
		});
		// A drive path is absolute only on Windows; elsewhere it names a file in the working directory.
		if (process.platform !== "win32") {
			await expect(withFileLock("C:/state.json", fn, { operation: "write" })).rejects.toMatchObject(
				{ code: "PATH" },
			);
		}
		expect(fn).not.toHaveBeenCalled();
	});

	// A lock left behind would stall this process's next mutation until it looks stale.
	it("removes its lock when the first delete is refused", async () => {
		const tempDir = createTempDir();
		await mkdir(tempDir, { recursive: true });
		const filePath = join(tempDir, "config.json");
		try {
			await withFileLock(
				filePath,
				async () => {
					rmFailures.push("EBUSY");
				},
				{ operation: "write" },
			);

			expect(rmFailures).toEqual([]);
			expect(existsSync(`${filePath}.lock`)).toBe(false);
		} finally {
			rmFailures.length = 0;
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	it("takes no lock when the host name cannot be read", async () => {
		const tempDir = createTempDir();
		await mkdir(tempDir, { recursive: true });
		const filePath = join(tempDir, "config.json");
		const os = process.getBuiltinModule("node:os");
		const hostname = vi.spyOn(os, "hostname").mockImplementation(() => {
			throw new Error("no host name");
		});
		const fn = vi.fn(async () => {});
		try {
			await expect(withFileLock(filePath, fn, { operation: "write" })).rejects.toMatchObject({
				code: "IO",
				details: { path: filePath, operation: "write" },
				cause: { message: "no host name" },
			});
			expect(fn).not.toHaveBeenCalled();
			expect(existsSync(`${filePath}.lock`)).toBe(false);
		} finally {
			hostname.mockRestore();
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	it("removes the lock it created when closing it fails", async () => {
		const tempDir = createTempDir();
		await mkdir(tempDir, { recursive: true });
		const filePath = join(tempDir, "config.json");
		closeFailures.set(`${filePath}.lock`, "EIO");
		const fn = vi.fn(async () => {});
		try {
			await expect(withFileLock(filePath, fn, { operation: "write" })).rejects.toMatchObject({
				code: "IO",
				cause: { code: "EIO" },
			});
			expect(fn).not.toHaveBeenCalled();
			expect(existsSync(`${filePath}.lock`)).toBe(false);
		} finally {
			closeFailures.clear();
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	// A cloned folder can hold a link at the lock path; following it, the lock never looked stale.
	it.skipIf(process.platform === "win32")(
		"takes over an old link to a missing target at the lock path",
		async () => {
			const tempDir = createTempDir();
			await mkdir(tempDir, { recursive: true });
			const filePath = join(tempDir, "config.json");
			const lockPath = `${filePath}.lock`;
			await symlink(join(tempDir, "missing"), lockPath);
			const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
			await lutimes(lockPath, hourAgo, hourAgo);
			try {
				await expect(
					withFileLock(filePath, async () => "ran", {
						operation: "write",
						signal: AbortSignal.timeout(2000),
					}),
				).resolves.toBe("ran");
				await expect(lstat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
			} finally {
				await rm(tempDir, { recursive: true, force: true });
			}
		},
	);
});

describe("deleteJson", () => {
	let tempDir: string;
	let filePath: string;

	beforeEach(async () => {
		tempDir = createTempDir();
		await mkdir(tempDir, { recursive: true });
		filePath = join(tempDir, "config.json");
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	// A reset that resolved must not come back after a power loss.
	it.skipIf(process.platform === "win32")("flushes the directory after the delete", async () => {
		await writeFile(filePath, "{}");
		fsTrace.length = 0;

		await deleteJson(filePath);

		expect(fsTrace).toEqual([`rm ${filePath}`, `open ${tempDir} r`, `sync ${tempDir}`]);
		expect(existsSync(filePath)).toBe(false);
	});

	it.skipIf(process.platform === "win32")(
		"rejects with IO when the directory flush after the delete fails",
		async () => {
			await writeFile(filePath, "{}");
			syncFailures.set(tempDir, "EIO");

			await expect(deleteJson(filePath)).rejects.toMatchObject({
				code: "IO",
				details: { path: filePath, operation: "delete" },
				cause: { code: "EIO" },
			});
		},
	);

	it("does not flush the directory on Windows", async () => {
		const platform = process.platform;
		Object.defineProperty(process, "platform", { value: "win32" });
		try {
			await writeFile(filePath, "{}");
			fsTrace.length = 0;

			await deleteJson(filePath);

			expect(fsTrace).toEqual([`rm ${filePath}`]);
		} finally {
			Object.defineProperty(process, "platform", { value: platform });
		}
	});

	// POSIX-only: on Windows chmod does not stop deletion from a directory.
	it.skipIf(process.platform === "win32")(
		"should throw CrustStoreError IO on permission denied",
		async () => {
			await writeFile(filePath, JSON.stringify({ data: true }));
			// Remove write permission from the directory to prevent deletion
			await chmod(tempDir, 0o444);

			try {
				await expect(deleteJson(filePath)).rejects.toMatchObject({
					name: "CrustStoreError",
					code: "IO",
					details: { path: filePath, operation: "delete" },
					cause: expect.anything(),
				});
			} finally {
				// Restore permissions for cleanup
				await chmod(tempDir, 0o755);
			}
		},
	);
});
