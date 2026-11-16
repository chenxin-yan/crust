import { spawnSync } from "node:child_process";
/**
 * @module-tag windows
 * @module-tag macos
 */
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";

import { withLock } from "@crustjs/store";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { holdLock, login, loginTokens, tokenWorld } from "../tests/helpers.ts";
import { credentialStore, credentialStoreInternals } from "./credentials.ts";
import {
	AbortError,
	CredentialStoreCorruptError,
	LockRecoveryRequiredError,
	LockTimeoutError,
	StaleCommitError,
	UnsafeStorageError,
} from "./errors.ts";

const posix = process.platform !== "win32";
const roots: string[] = [];

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function world(options: Parameters<typeof tokenWorld>[0] = {}) {
	const created = tokenWorld(options);
	roots.push(created.root);
	return created;
}

const mode = (path: string) => statSync(path).mode & 0o777;

describe("credentials file", () => {
	it.skipIf(!posix)(
		"writes a 0600 file in a 0700 directory, also over a 0644 file and with umask 000",
		async () => {
			const w = world();
			mkdirSync(w.dir, { recursive: true, mode: 0o700 });
			chmodSync(w.dir, 0o700);
			writeFileSync(w.file, "{}", { mode: 0o644 });
			const umask = process.umask(0);
			try {
				await login(w.source());
			} finally {
				process.umask(umask);
			}
			expect(mode(w.file)).toBe(0o600);
			expect(mode(w.dir)).toBe(0o700);
			expect(readdirSync(w.dir).filter((name) => !name.endsWith(".json"))).toEqual([]);
		},
	);

	it.skipIf(!posix)(
		"refuses a directory others can write to, or a symbolic link, before creating any file",
		async () => {
			const w = world();
			mkdirSync(w.dir, { recursive: true });
			chmodSync(w.dir, 0o775);
			await expect(login(w.source())).rejects.toBeInstanceOf(UnsafeStorageError);
			expect(readdirSync(w.dir)).toEqual([]);

			const linked = world();
			const target = join(linked.root, "elsewhere");
			mkdirSync(target, { mode: 0o700 });
			symlinkSync(target, linked.dir);
			await expect(login(linked.source())).rejects.toBeInstanceOf(UnsafeStorageError);
			expect(readdirSync(target)).toEqual([]);
		},
	);

	// updateNotifier() keeps its file in the same state directory and creates it with mode 0755.
	it.skipIf(!posix)(
		"logs in when another store of the app created the state directory first",
		async () => {
			const w = world();
			mkdirSync(w.dir, { recursive: true });
			chmodSync(w.dir, 0o755);
			writeFileSync(join(w.dir, "update-notifier.json"), "{}", { mode: 0o644 });
			await login(w.source());
			expect(mode(w.file)).toBe(0o600);
			expect((await w.source().get()).value).toBeTypeOf("string");
		},
	);

	it("lives in the state directory and refuses a symbolic link as the file, on every platform", async () => {
		const w = world();
		expect(w.store.path).toBe(w.file);
		await login(w.source());
		const target = join(w.root, "target.json");
		writeFileSync(target, readFileSync(w.file));
		rmSync(w.file);
		try {
			symlinkSync(target, w.file, "file");
		} catch (error) {
			// Windows without the symlink privilege: nothing to refuse.
			if ((error as NodeJS.ErrnoException).code === "EPERM") return;
			throw error;
		}
		const before = readFileSync(target, "utf8");
		await expect(w.source().get()).rejects.toBeInstanceOf(UnsafeStorageError);
		await expect(login(w.source())).rejects.toBeInstanceOf(UnsafeStorageError);
		expect(readFileSync(target, "utf8")).toBe(before);
	});

	it.skipIf(!posix)("ignores a relative XDG_STATE_HOME", () => {
		vi.stubEnv("XDG_STATE_HOME", "relative/state");
		expect(credentialStore({ app: "acme" }).path).toBe(
			join(homedir(), ".local", "state", "acme", "credentials.json"),
		);
	});

	it("a corrupt file fails every read and change, stays byte for byte, and keeps no cause", async () => {
		const w = world();
		mkdirSync(w.dir, { recursive: true, mode: 0o700 });
		writeFileSync(w.file, "{not json SENTINEL_RT_9", { mode: 0o600 });
		const source = w.source();
		const calls = [
			() => source.get(),
			() => source.forceRefresh(),
			() => source.beginLogin(),
			() => source.logout(),
			() => w.store.resetCredentials({ key: source.key }),
		];
		for (const call of calls) {
			const error = await call().catch((caught: unknown) => caught);
			expect(error).toBeInstanceOf(CredentialStoreCorruptError);
			expect((error as Error).cause).toBeUndefined();
			expect(inspect(error, { showHidden: true, depth: 10 })).not.toContain("SENTINEL");
		}
		// A failed beginLogin released its guard: after a reset, a login works.
		expect(readFileSync(w.file, "utf8")).toBe("{not json SENTINEL_RT_9");
		await w.store.resetCredentials();
		expect(readdirSync(w.dir).filter((name) => name.includes("credentials.json"))).toEqual([]);
		await login(source);
		expect(w.document().storeId).toEqual(expect.any(String));
	});

	it("says a file of a newer version needs an update, and never resets it", async () => {
		const w = world();
		mkdirSync(w.dir, { recursive: true, mode: 0o700 });
		writeFileSync(w.file, JSON.stringify({ version: 99, records: {} }), { mode: 0o600 });
		const error = await w
			.source()
			.get()
			.catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(CredentialStoreCorruptError);
		expect((error as Error).message).toContain("newer version");
		await expect(login(w.source())).rejects.toBeInstanceOf(CredentialStoreCorruptError);
		expect(JSON.parse(readFileSync(w.file, "utf8")).version).toBe(99);
	});

	it("a reset waiting for the lock is cancellable and leaves the file", async () => {
		const w = world();
		await login(w.source());
		const lock = await holdLock((fn) => withLock(w.file, fn));
		const controller = new AbortController();
		const reset = w.store.resetCredentials({ signal: controller.signal });
		await new Promise((resolve) => setTimeout(resolve, 50));
		controller.abort();
		await expect(reset).rejects.toBeInstanceOf(AbortError);
		await lock.release();
		expect(existsSync(w.file)).toBe(true);
	});

	it("an invalid record fails only its own key, and a key reset makes its open login stale", async () => {
		const w = world();
		const source = w.source();
		const work = w.source({ identity: { ...w.identity, profile: "work" } });
		await login(source, { expiresAt: undefined });
		await login(work, { expiresAt: undefined });
		const ticket = await work.beginLogin();
		const internals = credentialStoreInternals(w.store);
		await internals.update((document) => ({
			...document!,
			records: {
				...document!.records,
				[work.key]: { ...(document!.records[work.key] as object), secret: { accessToken: 7 } },
			},
		}));
		await expect(work.get()).rejects.toMatchObject({
			code: "credential-store-corrupt",
			key: work.key,
		});
		await expect(source.get()).resolves.toMatchObject({ value: "AT1" });
		await w.store.resetCredentials({ key: work.key });
		await expect(ticket.commit(loginTokens())).rejects.toBeInstanceOf(StaleCommitError);
		expect(w.document().records[work.key]).toMatchObject({ tombstone: true });
		await expect(login(work)).resolves.toMatchObject({ accessToken: "AT1" });
	});

	it("a key reset waiting for the file's lock is cancellable and writes nothing", async () => {
		const w = world();
		const source = w.source();
		await login(source, { expiresAt: undefined });
		const lock = await holdLock((fn) => withLock(w.file, fn));
		const controller = new AbortController();
		const reset = w.store.resetCredentials({ key: source.key, signal: controller.signal });
		await new Promise((resolve) => setTimeout(resolve, 50));
		controller.abort();
		await expect(reset).rejects.toBeInstanceOf(AbortError);
		await lock.release();
		await expect(source.get()).resolves.toMatchObject({ value: "AT1" });
	});

	it("treats a file with none of the credentials fields as empty, and keeps its other keys", async () => {
		const w = world();
		mkdirSync(w.dir, { recursive: true, mode: 0o700 });
		writeFileSync(w.file, JSON.stringify({ foreign: "keep" }), { mode: 0o600 });
		await expect(w.source().get()).rejects.toMatchObject({ reason: "missing" });
		await login(w.source());
		expect(w.document()).toMatchObject({ foreign: "keep", version: 1 });
	});

	it.each([
		["only version", { version: 1 }],
		["only storeId", { storeId: "s" }],
		["only encryption", { encryption: { kind: "plaintext" } }],
		["only records", { records: {} }],
		[
			"a number storeId",
			{ version: 1, storeId: 7, encryption: { kind: "plaintext" }, records: {} },
		],
		[
			"a string version",
			{ version: "1", storeId: "s", encryption: { kind: "plaintext" }, records: {} },
		],
		[
			"a null version",
			{ version: null, storeId: "s", encryption: { kind: "plaintext" }, records: {} },
		],
		[
			"records as an array",
			{ version: 1, storeId: "s", encryption: { kind: "plaintext" }, records: [] },
		],
		[
			"an unknown encryption",
			{ version: 1, storeId: "s", encryption: { kind: "rot13" }, records: {} },
		],
	])("fails closed on a file with %s", async (_name, document) => {
		const w = world();
		mkdirSync(w.dir, { recursive: true, mode: 0o700 });
		const text = JSON.stringify(document);
		writeFileSync(w.file, text, { mode: 0o600 });
		const source = w.source();
		for (const call of [
			() => source.get(),
			() => source.beginLogin(),
			() => source.logout(),
			() => w.store.resetCredentials({ key: source.key }),
		]) {
			await expect(call()).rejects.toBeInstanceOf(CredentialStoreCorruptError);
		}
		expect(readFileSync(w.file, "utf8")).toBe(text);
	});

	it("skips POSIX modes only on Windows, and the docs say what protects the file there", async () => {
		const docs = readFileSync(
			join(import.meta.dirname, "../../../apps/docs/content/docs/modules/auth.mdx"),
			"utf8",
		);
		expect(docs).toContain("On Windows, the file is protected by the access rules (ACLs)");
		const w = world();
		await login(w.source());
		// Windows reports modes from the read-only attribute only.
		expect(mode(w.file)).toBe(posix ? 0o600 : 0o666);
	});

	it("keeps every credential when 50 logins write the file at once", async () => {
		const w = world({ lockTimeout: 30_000 });
		const sources = Array.from({ length: 50 }, (_, index) =>
			w.source({ identity: { ...w.identity, profile: `p${index}` } }),
		);
		await Promise.all(sources.map((source) => login(source)));
		const records = w.document().records;
		expect(sources.every((source) => records[source.key]?.secret.accessToken === "AT1")).toBe(true);
	});

	it("prints a committed credential and its access token as redacted", async () => {
		const w = world();
		const source = w.source();
		const credential = await login(source, { accessToken: "SENTINEL_AT_9", expiresAt: undefined });
		const token = await source.get();
		for (const value of [credential, token]) {
			expect(JSON.stringify(value)).not.toContain("SENTINEL");
			expect(inspect(value, { depth: 10 })).not.toContain("SENTINEL");
		}
		expect(token.value).toBe("SENTINEL_AT_9");
		expect(readFileSync(w.file, "utf8")).toContain("SENTINEL_AT_9");
	});
});

describe("identity lock", () => {
	it("fails at its deadline while a live process holds the lock, naming the file and the manual step", async () => {
		const w = world({ lockTimeout: 200 });
		const source = w.source();
		await login(source);
		// Another store instance stands for another process: same file, a live owner.
		const other = credentialStoreInternals(credentialStore({ app: w.app }));
		const held = await holdLock((fn) => other.lockIdentity(source.key, fn));
		const error = await source.get().catch((caught: unknown) => caught);
		await held.release();
		expect(error).toBeInstanceOf(LockTimeoutError);
		const timeout = error as LockTimeoutError;
		expect(timeout.path).toMatch(/credentials\.[\w-]+\.lock$/);
		expect(timeout.owner).toMatchObject({ pid: process.pid, platform: process.platform });
		expect(timeout.manualStep).toContain("Stop every process");
		expect(w.tokenRequests()).toHaveLength(0);
	});

	it("a leftover .recover file needs the manual step even when its owner runs", async () => {
		const w = world({ lockTimeout: 300 });
		const source = w.source();
		await login(source);
		// This process's own lock record: as the primary lock with a pid that is gone (a dead
		// owner), and as the .recover file of a live recoverer.
		let path = "";
		let own: Record<string, unknown> = {};
		await credentialStoreInternals(w.store).lockIdentity(source.key, async () => {
			path = join(
				w.dir,
				readdirSync(w.dir).find((name) => name.endsWith(".lock"))!,
			);
			own = JSON.parse(readFileSync(path, "utf8"));
		});
		const gone = spawnSync(process.execPath, ["-e", ""]).pid;
		writeFileSync(path, JSON.stringify({ ...own, ownerId: "dead", pid: gone }));
		writeFileSync(`${path}.recover`, JSON.stringify({ ...own, ownerId: "recoverer" }));
		const error = await source.get().catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(LockRecoveryRequiredError);
		expect(error).toMatchObject({ path: `${path}.recover`, owner: { ownerId: "recoverer" } });
	});

	it("never takes over a lock from another platform, and an abort leaves it in place", async () => {
		const w = world({ lockTimeout: 200 });
		const source = w.source();
		await login(source);
		expect(readdirSync(w.dir).filter((name) => name.endsWith(".lock"))).toEqual([]);
		// The identity lock file of this key, written by a process on another platform.
		const internals = credentialStoreInternals(w.store);
		let path = "";
		await internals.lockIdentity(source.key, async () => {
			path = join(
				w.dir,
				readdirSync(w.dir).find((name) => name.endsWith(".lock"))!,
			);
		});
		const foreign = JSON.stringify({
			ownerId: "foreign",
			pid: 1,
			host: "container",
			platform: process.platform === "linux" ? "aix" : "linux",
			createdAt: new Date().toISOString(),
			machineId: null,
			bootId: null,
			pidNamespace: null,
			startTime: null,
		});
		writeFileSync(path, foreign);
		const error = await source.get().catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(LockRecoveryRequiredError);
		expect(error).toMatchObject({ path, owner: { ownerId: "foreign", host: "container" } });

		const controller = new AbortController();
		const waiting = source.get({ signal: controller.signal });
		controller.abort();
		await expect(waiting).rejects.toBeInstanceOf(AbortError);
		expect(readFileSync(path, "utf8")).toBe(foreign);
		expect(w.tokenRequests()).toHaveLength(0);
	});
});
