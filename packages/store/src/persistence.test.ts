import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
	chmod,
	chown,
	lstat,
	mkdir,
	open,
	readdir,
	readFile,
	rename,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { deleteJson, readJson, writeJson } from "./persistence.ts";

// Error codes the next `rename` calls fail with, as when another program holds the target open.
const renameFailures = vi.hoisted((): string[] => []);
vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	const rename = vi.fn(async (from: string, to: string) => {
		const code = renameFailures.shift();
		if (code !== undefined) throw Object.assign(new Error(code), { code });
		return actual.rename(from, to);
	});
	// Unprivileged tests cannot give a file another owner, so the owner copy is observed here.
	const chown = vi.fn(actual.chown);
	return { ...actual, rename, chown, default: { ...actual, rename, chown } };
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

	it("should throw CrustStoreError IO on permission denied", async () => {
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
	});
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

		await writeJson(nested, { created: true });

		expect(existsSync(nested)).toBe(true);
		const raw = await readFile(nested, "utf-8");
		expect(JSON.parse(raw)).toEqual({ created: true });
	});

	it("should produce tab-indented JSON", async () => {
		await writeJson(filePath, { theme: "dark" });

		const raw = await readFile(filePath, "utf-8");
		expect(raw).toBe(JSON.stringify({ theme: "dark" }, null, "\t"));
	});

	// POSIX permission bits only. On Windows the store ignores modes (it uses
	// ACLs, not Unix bits), so these exact-mode assertions do not apply.
	describe.skipIf(process.platform === "win32")("permission bits", () => {
		it("should create the file with the requested mode regardless of umask", async () => {
			await mkdir(tempDir);
			const previous = process.umask(0o777);
			try {
				await writeJson(filePath, { secret: true }, { fileMode: 0o600 });

				const { stat } = await import("node:fs/promises");
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
				await writeJson(nested, { data: true }, { directoryMode: 0o700 });

				const { stat } = await import("node:fs/promises");
				const { mode } = await stat(join(tempDir, "secret-dir"));
				expect(mode & 0o777).toBe(0o700);
			} finally {
				process.umask(previous);
			}
		});

		it("should leave a pre-existing directory's mode untouched", async () => {
			await mkdir(tempDir, { recursive: true });
			await chmod(tempDir, 0o755);

			await writeJson(filePath, { data: true }, { directoryMode: 0o700 });

			const { stat } = await import("node:fs/promises");
			const { mode } = await stat(tempDir);
			expect(mode & 0o777).toBe(0o755);
		});

		it("keeps the mode of the file it replaces when no fileMode is set", async () => {
			await writeJson(filePath, { data: 1 });
			await chmod(filePath, 0o600);

			await writeJson(filePath, { data: 2 });

			expect((await stat(filePath)).mode & 0o7777).toBe(0o600);
		});

		it("gives the replacement the owner of the file it replaces", async () => {
			await writeJson(filePath, { data: 1 });
			const { uid, gid } = await stat(filePath);
			vi.mocked(chown).mockClear();

			await writeJson(filePath, { data: 2 });

			expect(chown).toHaveBeenCalledWith(expect.stringMatching(/\.tmp$/), uid, gid);
		});

		it("ignores a refused owner copy when not running as root", async () => {
			await writeJson(filePath, { data: 1 });
			vi.mocked(chown).mockRejectedValueOnce(Object.assign(new Error("EPERM"), { code: "EPERM" }));
			const getuid = vi.spyOn(process, "getuid").mockReturnValue(1000);
			try {
				await writeJson(filePath, { data: 2 });
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

			await writeJson(filePath, { data: true });

			expect((await lstat(filePath)).isFile()).toBe(true);
			expect(await readFile(target, "utf-8")).toBe("{}");
		},
	);

	it("flushes the temp file to disk before renaming it into place", async () => {
		await mkdir(tempDir);
		const probe = await open(join(tempDir, "probe"), "w");
		const sync = vi.spyOn(Object.getPrototypeOf(probe), "sync");
		await probe.close();
		try {
			await writeJson(filePath, { data: true });

			expect(sync).toHaveBeenCalledTimes(1);
			expect(sync.mock.invocationCallOrder[0]).toBeLessThan(
				vi.mocked(rename).mock.invocationCallOrder.at(-1) ?? 0,
			);
		} finally {
			sync.mockRestore();
		}
	});

	it.skipIf(process.platform === "win32")(
		"does not retry a failed rename outside Windows",
		async () => {
			renameFailures.push("EPERM");

			await expect(writeJson(filePath, { data: true })).rejects.toMatchObject({
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

			await writeJson(filePath, { data: true });

			expect(renameFailures).toEqual([]);
			expect(JSON.parse(await readFile(filePath, "utf-8"))).toEqual({ data: true });
			expect(await readdir(tempDir)).toEqual(["config.json"]);
		});

		it("does not retry other rename errors", async () => {
			renameFailures.push("ENOENT", "EPERM");

			await expect(writeJson(filePath, { data: true })).rejects.toMatchObject({
				cause: { code: "ENOENT" },
			});
		});
	});

	it("should throw CrustStoreError IO when directory creation fails", async () => {
		await mkdir(tempDir);
		const parentFile = join(tempDir, "not-a-directory");
		await writeFile(parentFile, "sentinel");
		const badPath = join(parentFile, "impossible", "config.json");

		await expect(writeJson(badPath, { data: true })).rejects.toMatchObject({
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

	it("should throw CrustStoreError IO on permission denied", async () => {
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
	});
});
