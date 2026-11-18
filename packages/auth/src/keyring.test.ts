import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { withLock } from "@crustjs/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
	fakeKeyring,
	holdLock,
	json,
	login,
	loginTokens,
	noKeyring,
	tokenResponse,
	tokenWorld,
} from "../tests/helpers.ts";
import { credentialStore, credentialStoreInternals } from "./credentials.ts";
import {
	AbortError,
	CredentialKeyError,
	CredentialStoreCorruptError,
	LoginRequiredError,
	OAuthError,
	RefreshFailedError,
	RefreshOutcomeUnknownError,
	StaleCommitError,
} from "./errors.ts";
import { keyrings } from "./keyring.ts";
import { refreshFlights } from "./token-source.ts";
import type { AuthWarning, CredentialStoreOptions } from "./types.ts";

const roots: string[] = [];
const deadlineMs = keyrings.deadlineMs;

beforeEach(() => {
	// Past-the-deadline cases wait for the deadline: keep it short.
	keyrings.deadlineMs = 200;
});

afterEach(() => {
	keyrings.deadlineMs = deadlineMs;
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	vi.doUnmock("@napi-rs/keyring");
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** {@link tokenWorld} with the keyring on, removed after the test. */
function world(options: Parameters<typeof tokenWorld>[0] = {}) {
	const created = tokenWorld({ keyring: {}, ...options });
	roots.push(created.root);
	return created;
}

/** Another store of the same file with its own options: another process, or a restart. */
const reopen = (w: ReturnType<typeof world>, keyring?: CredentialStoreOptions["keyring"]) =>
	credentialStore({ app: w.app, lockTimeout: 5_000, keyring });

const gate = () => {
	const { promise, resolve } = Promise.withResolvers<void>();
	return { wait: promise, open: () => resolve() };
};

describe("keyring backends", () => {
	it("on Bun uses Bun.secrets and asks it to keep the key on this computer (persist: local)", async () => {
		const secrets = {
			get: vi.fn(async (_options: object) => null),
			set: vi.fn(async (_options: object) => {}),
		};
		vi.stubGlobal("Bun", { secrets });
		const backend = await keyrings.load();
		expect(backend?.kind).toBe("bun-secrets");
		await expect(backend!.get("acme", "credentials-key")).resolves.toBeUndefined();
		await backend!.set("acme", "credentials-key", "value");
		expect(secrets.get).toHaveBeenCalledWith({ service: "acme", name: "credentials-key" });
		expect(secrets.set).toHaveBeenCalledWith({
			service: "acme",
			name: "credentials-key",
			value: "value",
			persist: "local",
		});
	});

	it("on Node uses @napi-rs/keyring pinned to the Secret Service on Linux, never keyutils", async () => {
		const created: unknown[][] = [];
		vi.doMock("@napi-rs/keyring", () => ({
			AsyncEntry: class {
				constructor(...args: unknown[]) {
					created.push(args);
				}
				getPassword = async () => null;
				setPassword = async () => {};
			},
		}));
		const backend = await keyrings.load();
		expect(backend?.kind).toBe("napi-keyring");
		await expect(backend!.get("acme", "credentials-key")).resolves.toBeUndefined();
		await backend!.set("acme", "credentials-key", "value");
		expect(created).toEqual([
			["acme", "credentials-key", { linux: { store: "secret-service" } }],
			["acme", "credentials-key", { linux: { store: "secret-service" } }],
		]);
	});

	it("without @napi-rs/keyring there is no keyring, and secrets go to the file with one warning", async () => {
		vi.doMock("@napi-rs/keyring", () => {
			throw new Error("Cannot find package '@napi-rs/keyring'");
		});
		await expect(keyrings.load()).resolves.toBeUndefined();
		const warnings: AuthWarning[] = [];
		const w = world({ keyring: { onWarning: (warning) => warnings.push(warning) } });
		await login(w.source());
		await login(w.source({ identity: { ...w.identity, profile: "work" } }));
		expect(w.document().encryption).toEqual({ kind: "plaintext" });
		expect(w.document().records[w.source().key].secret.accessToken).toBe("AT1");
		expect(warnings).toEqual([{ code: "plaintext-storage" }]);
		await expect(w.store.status()).resolves.toEqual({
			kind: "file",
			encryption: "plaintext",
			keyReadable: false,
			plaintextRecords: 2,
		});
	});
});

describe("the file key", () => {
	it("is created by the first encrypted write, once; later refreshes, logins and logouts never write it", async () => {
		const keyring = fakeKeyring();
		let next = 1;
		const w = world({ token: () => tokenResponse(`AT${++next}`, `RT${next}`, 1) });
		const source = w.source();
		await login(source);
		expect(keyring.writes()).toBe(1);
		const entry = keyring.entry(w.app)!;
		expect(Buffer.from(entry.key, "base64url")).toHaveLength(32);
		expect(w.document().encryption).toEqual({
			kind: "aes-256-gcm",
			keyId: entry.keyId,
			keyring: "bun-secrets",
		});
		for (let round = 0; round < 34; round += 1) {
			await source.get();
			await login(w.source({ identity: { ...w.identity, profile: `p${round}` } }));
			await w.source({ identity: { ...w.identity, profile: `p${round}` } }).logout();
		}
		// A restarted process reads the key again; it writes nothing either.
		await expect(w.source({ store: reopen(w, {}) }).get()).resolves.toMatchObject({
			value: expect.stringMatching(/^AT/),
		});
		expect(keyring.writes()).toBe(1);
		expect(
			keyring.calls.every((call) => call.service === w.app && call.name === "credentials-key"),
		).toBe(true);
	});

	it("two first logins at once create one key under the key-init lock, and both records decrypt", async () => {
		const keyring = fakeKeyring();
		const held = gate();
		keyring.state.writeGate = held.wait;
		const w = world();
		const a = w.source();
		const b = w.source({ identity: { ...w.identity, profile: "work" }, store: reopen(w, {}) });
		const logins = [
			login(a, { accessToken: "AT_A", expiresAt: undefined }),
			login(b, { accessToken: "AT_B", expiresAt: undefined }),
		];
		await vi.waitFor(() => expect(keyring.writes()).toBe(1));
		held.open();
		await Promise.all(logins);
		expect(keyring.writes()).toBe(1);
		expect(w.document().encryption.keyId).toBe(keyring.entry(w.app)!.keyId);
		await expect(a.get()).resolves.toMatchObject({ value: "AT_A" });
		await expect(b.get()).resolves.toMatchObject({ value: "AT_B" });
	});

	it("a key write past the deadline fails that login as unavailable; the next creator waits for it and reuses the key", async () => {
		const keyring = fakeKeyring();
		const held = gate();
		keyring.state.writeGate = held.wait;
		const w = world();
		const first = await login(w.source()).catch((error: unknown) => error);
		expect(first).toBeInstanceOf(CredentialKeyError);
		expect(first).toMatchObject({ reason: "unavailable" });
		expect(w.document().records).toEqual({});
		expect(w.document().encryption).toEqual({ kind: "plaintext" });
		// Never the plaintext fallback: the keyring is there.
		const second = login(w.source({ store: reopen(w, {}) }));
		let settled = false;
		void second.finally(() => {
			settled = true;
		});
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(settled).toBe(false);
		held.open();
		await second;
		expect(keyring.writes()).toBe(1);
		expect(w.document().encryption.keyId).toBe(keyring.entry(w.app)!.keyId);
	});

	it("a store that saw no key re-reads under the lock and reuses the key another created", async () => {
		const keyring = fakeKeyring();
		const w = world();
		const late = reopen(w, {});
		await expect(late.status()).resolves.toMatchObject({ kind: "bun-secrets", keyReadable: false });
		await login(w.source());
		await login(w.source({ store: late, identity: { ...w.identity, profile: "work" } }));
		expect(keyring.writes()).toBe(1);
	});

	it("is read by every backend call within the deadline: a hung read counts as no keyring", async () => {
		const keyring = fakeKeyring();
		keyring.state.get = "hang";
		const warnings: AuthWarning[] = [];
		const w = world({ keyring: { onWarning: (warning) => warnings.push(warning) } });
		const started = performance.now();
		await login(w.source());
		expect(performance.now() - started).toBeLessThan(2_000);
		expect(w.document().encryption).toEqual({ kind: "plaintext" });
		expect(warnings).toEqual([{ code: "plaintext-storage" }]);
		expect(keyring.writes()).toBe(0);
	});
});

describe("encrypted records", () => {
	it("keep only the tokens encrypted; lifecycle fields stay readable", async () => {
		fakeKeyring();
		const w = world();
		const source = w.source();
		await login(source, {
			accessToken: "SENTINEL_AT",
			refreshToken: "SENTINEL_RT",
			scope: "read",
			expiresAt: undefined,
		});
		const text = readFileSync(w.file, "utf8");
		expect(text).not.toContain("SENTINEL");
		const stored = w.document().records[source.key];
		expect(Object.keys(stored.secret).sort()).toEqual(["ciphertext", "iv"]);
		expect(stored).toMatchObject({
			scope: "read",
			tokenType: "Bearer",
			identity: { profile: "default" },
		});
		await expect(source.get({})).resolves.toMatchObject({ value: "SENTINEL_AT" });
	});

	it.each([
		["moved to another record", "move"],
		["with a flipped byte", "flip"],
		["of another generation", "generation"],
	])("fail closed when the ciphertext is %s", async (_name, change) => {
		fakeKeyring();
		const w = world();
		const source = w.source();
		const work = w.source({ identity: { ...w.identity, profile: "work" } });
		await login(source, { accessToken: "AT_DEFAULT", expiresAt: undefined });
		await login(work, { accessToken: "AT_WORK", expiresAt: undefined });
		await credentialStoreInternals(w.store).update((document) => {
			const records = { ...document!.records };
			type Sealed = { secret: { iv: string; ciphertext: string } };
			const own = records[work.key] as Sealed;
			const other = records[source.key] as Sealed;
			const bytes = Buffer.from(own.secret.ciphertext, "base64url");
			bytes[0]! ^= 1;
			records[work.key] =
				change === "move"
					? { ...own, secret: other.secret }
					: change === "flip"
						? { ...own, secret: { ...own.secret, ciphertext: bytes.toString("base64url") } }
						: { ...own, generation: "g-other" };
			return { ...document!, records };
		});
		const error = await work.get().catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(CredentialStoreCorruptError);
		expect(error).toMatchObject({ key: work.key });
		await expect(source.get()).resolves.toMatchObject({ value: "AT_DEFAULT" });
	});
});

describe("a key that can't be used", () => {
	it.each(["error", "hang"] as const)(
		"an unreadable key (read %s) fails reads and refreshes with CredentialKeyError, writing nothing",
		async (failure) => {
			const keyring = fakeKeyring();
			const w = world();
			await login(w.source());
			const before = readFileSync(w.file, "utf8");
			keyring.state.get = failure;
			for (const call of [
				() => w.source({ store: reopen(w, {}) }).get(),
				() => w.source({ store: reopen(w, {}) }).forceRefresh(),
				() => login(w.source({ store: reopen(w, {}) })),
			]) {
				const error = await call().catch((caught: unknown) => caught);
				expect(error).toBeInstanceOf(CredentialKeyError);
				expect(error).toMatchObject({ code: "credential-key", reason: "unreadable" });
			}
			expect(readFileSync(w.file, "utf8")).toBe(before);
			expect(keyring.writes()).toBe(1);
			expect(w.tokenRequests()).toHaveLength(0);
		},
	);

	it("a deleted key asks for a login, writing nothing; plaintext records still read; the next login creates one key and discards the old records", async () => {
		const keyring = fakeKeyring();
		const w = world();
		// B logged in before the keyring was available: its record stays plaintext.
		const plain = w.source({ identity: { ...w.identity, profile: "plain" }, store: reopen(w) });
		await login(plain, { accessToken: "AT_PLAIN", expiresAt: undefined });
		const work = w.source({ identity: { ...w.identity, profile: "work" } });
		await login(work, { expiresAt: undefined });
		await login(w.source({ identity: { ...w.identity, profile: "home" } }));
		const oldKeyId = w.document().encryption.keyId;
		keyring.entries.clear();
		const before = readFileSync(w.file, "utf8");
		const store = reopen(w, {});
		const error = await w
			.source({ store, identity: { ...w.identity, profile: "work" } })
			.get()
			.catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(LoginRequiredError);
		expect(error).toMatchObject({ reason: "key-missing" });
		expect(readFileSync(w.file, "utf8")).toBe(before);
		expect(keyring.writes()).toBe(1);
		await expect(
			w.source({ store, identity: { ...w.identity, profile: "plain" } }).get(),
		).resolves.toMatchObject({ value: "AT_PLAIN" });

		const committed = await login(w.source({ store }), {
			accessToken: "AT_NEW",
			expiresAt: undefined,
		});
		expect(committed.discarded).toBe(2);
		expect(keyring.writes()).toBe(2);
		const document = w.document();
		expect(document.encryption.keyId).not.toBe(oldKeyId);
		expect(document.encryption.keyId).toBe(keyring.entry(w.app)!.keyId);
		expect(document.records[work.key]).toMatchObject({ tombstone: true });
		await expect(w.source({ store }).get()).resolves.toMatchObject({ value: "AT_NEW" });
		await expect(
			w.source({ store, identity: { ...w.identity, profile: "plain" } }).get(),
		).resolves.toMatchObject({ value: "AT_PLAIN" });
	});

	it("a key of another id asks for a login; the next login reuses it, writes no key, and discards exactly the old key's records", async () => {
		const keyring = fakeKeyring();
		const w = world();
		const plain = w.source({ identity: { ...w.identity, profile: "plain" }, store: reopen(w) });
		await login(plain, { accessToken: "AT_PLAIN", expiresAt: undefined });
		const work = w.source({ identity: { ...w.identity, profile: "work" } });
		await login(work, { expiresAt: undefined });
		// Another key replaced the one the file names (a creator killed during its write).
		const other = {
			keyId: "other-key",
			key: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url"),
		};
		keyring.entries.set(`${w.app}\0credentials-key`, JSON.stringify(other));
		const before = readFileSync(w.file, "utf8");
		const store = reopen(w, {});
		const error = await w
			.source({ store, identity: { ...w.identity, profile: "work" } })
			.get()
			.catch((caught: unknown) => caught);
		expect(error).toMatchObject({ code: "login-required", reason: "key-mismatch" });
		expect(readFileSync(w.file, "utf8")).toBe(before);

		const committed = await login(w.source({ store }), {
			accessToken: "AT_NEW",
			expiresAt: undefined,
		});
		expect(committed.discarded).toBe(1);
		expect(keyring.writes()).toBe(1);
		expect(w.document().encryption).toEqual({
			kind: "aes-256-gcm",
			keyId: "other-key",
			keyring: "bun-secrets",
		});
		expect(w.document().records[work.key]).toMatchObject({ tombstone: true });
		expect(w.document().records[plain.key].secret.accessToken).toBe("AT_PLAIN");
		await expect(w.source({ store }).get()).resolves.toMatchObject({ value: "AT_NEW" });
	});

	it("a file with a key never takes plaintext: without a keyring, reads and logins fail closed", async () => {
		const keyring = fakeKeyring();
		const w = world();
		await login(w.source({ identity: { ...w.identity, profile: "work" } }));
		const before = readFileSync(w.file, "utf8");
		keyring.state.get = "error";
		for (const store of [reopen(w), reopen(w, {}), reopen(w, { strict: true })]) {
			await expect(login(w.source({ store }))).rejects.toMatchObject({ reason: "unreadable" });
		}
		noKeyring();
		await expect(login(w.source({ store: reopen(w, {}) }))).rejects.toMatchObject({
			reason: "unreadable",
		});
		expect(readFileSync(w.file, "utf8")).toBe(before);
	});

	it.each([
		["unreadable", "error"],
		["missing", "missing"],
	])(
		"logout with an %s key still writes the tombstone and skips revocation",
		async (_name, failure) => {
			const keyring = fakeKeyring();
			const w = world({ metadata: { revocation_endpoint: "https://as.example/revoke" } });
			const source = w.source();
			await login(source);
			if (failure === "missing") keyring.entries.clear();
			else keyring.state.get = "error";
			await expect(w.source({ store: reopen(w, {}) }).logout()).resolves.toEqual({
				local: "deleted",
				remote: "skipped",
			});
			expect(w.document().records[source.key]).toMatchObject({ tombstone: true });
			expect(w.requests.filter((request) => request.url.endsWith("/revoke"))).toHaveLength(0);
		},
	);

	it("logout with a readable key revokes the decrypted tokens", async () => {
		fakeKeyring();
		const revoke = `https://revoke-${process.pid}.example/revoke`;
		const w = world({
			metadata: { revocation_endpoint: revoke },
			routes: { [revoke]: () => new Response(null, { status: 200 }) },
		});
		await login(w.source());
		await expect(w.source({ store: reopen(w, {}) }).logout()).resolves.toEqual({
			local: "deleted",
			remote: "revoked",
		});
		const sent = w.requests.filter((request) => request.url === revoke);
		expect(sent.map((request) => request.body.get("token"))).toEqual(["RT1", "AT1"]);
	});

	it("a key-replacing login stales an open ticket and an in-flight refresh of a discarded record", async () => {
		const keyring = fakeKeyring();
		const held = gate();
		const w = world({
			token: async () => {
				await held.wait;
				return tokenResponse("AT2", "RT2");
			},
		});
		const a = w.source({ identity: { ...w.identity, profile: "a" } });
		await login(a);
		const ticket = await a.beginLogin();
		const refreshing = a.get().catch((error: unknown) => error);
		await vi.waitFor(() => expect(w.tokenRequests()).toHaveLength(1));
		keyring.entries.clear();
		const committed = await login(
			w.source({ store: reopen(w, {}), identity: { ...w.identity, profile: "b" } }),
		);
		expect(committed.discarded).toBe(1);
		held.open();
		expect(await refreshing).toMatchObject({ reason: "store-changed" });
		await expect(ticket.commit(loginTokens())).rejects.toBeInstanceOf(StaleCommitError);
		expect(w.document().records[a.key]).toMatchObject({ tombstone: true });
		expect(refreshFlights.size).toBe(0);
	}, 15_000);
});

describe("no keyring", () => {
	it("strict refuses to store a secret in plaintext and writes nothing", async () => {
		noKeyring();
		const warnings: AuthWarning[] = [];
		const w = world({ keyring: { strict: true, onWarning: (warning) => warnings.push(warning) } });
		const error = await login(w.source()).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(CredentialKeyError);
		expect(error).toMatchObject({ reason: "unavailable" });
		expect(w.document().records).toEqual({});
		expect(warnings).toEqual([]);
	});

	it("a store without the keyring option never touches a keyring and stores plaintext silently", async () => {
		const keyring = fakeKeyring();
		const w = world({ keyring: undefined });
		await login(w.source());
		expect(keyring.calls).toEqual([]);
		await expect(w.store.status()).resolves.toEqual({
			kind: "file",
			encryption: "plaintext",
			keyReadable: false,
			plaintextRecords: 1,
		});
	});

	it("rejects keyring options that are not options", () => {
		for (const keyring of [{ strict: "yes" }, { onWarning: "print" }, "on"]) {
			expect(() =>
				credentialStore({ app: "acme", keyring: keyring as CredentialStoreOptions["keyring"] }),
			).toThrow(expect.objectContaining({ code: "oauth-config" }));
		}
	});
});

describe("encryption on the next write", () => {
	it("encrypts a login into a plaintext file, keeps other records plaintext, and the next refresh encrypts them", async () => {
		const keyring = fakeKeyring();
		const w = world({ token: () => tokenResponse("SENTINEL_B2", "SENTINEL_RB2") });
		const plainStore = reopen(w);
		const b = w.source({ store: plainStore, identity: { ...w.identity, profile: "b" } });
		await login(b, { accessToken: "SENTINEL_B1", refreshToken: "SENTINEL_RB1" });
		await login(w.source({ store: plainStore, identity: { ...w.identity, profile: "a" } }));
		await expect(w.store.status()).resolves.toMatchObject({
			kind: "bun-secrets",
			plaintextRecords: 2,
		});

		const a = w.source({ identity: { ...w.identity, profile: "a" } });
		await login(a, { accessToken: "AT_A", expiresAt: undefined });
		const keyId = keyring.entry(w.app)!.keyId;
		expect(w.document().encryption).toEqual({ kind: "aes-256-gcm", keyId, keyring: "bun-secrets" });
		expect(w.document().records[a.key].secret).toHaveProperty("ciphertext");
		expect(w.document().records[b.key].secret.accessToken).toBe("SENTINEL_B1");
		await expect(w.store.status()).resolves.toEqual({
			kind: "bun-secrets",
			encryption: "aes-256-gcm",
			keyReadable: true,
			plaintextRecords: 1,
		});

		await expect(
			w.source({ identity: { ...w.identity, profile: "b" } }).get(),
		).resolves.toMatchObject({
			value: "SENTINEL_B2",
		});
		expect(readFileSync(w.file, "utf8")).not.toContain("SENTINEL");
		await expect(w.store.status()).resolves.toMatchObject({ plaintextRecords: 0 });
		expect(keyring.writes()).toBe(1);
	});

	it.each(["first", "second"])(
		"two first encrypted writes into a file without a key both commit, the %s one first",
		async (order) => {
			const keyring = fakeKeyring();
			const w = world();
			const a = w.source({ identity: { ...w.identity, profile: "a" } });
			const b = w.source({ identity: { ...w.identity, profile: "b" }, store: reopen(w, {}) });
			const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
			const gates = [gate(), gate()];
			let calls = 0;
			// Both encrypt under the same key before either commits.
			vi.spyOn(crypto.subtle, "encrypt").mockImplementation(async (...args) => {
				await gates[calls++]!.wait;
				return encrypt(...args);
			});
			const logins = [
				login(a, { accessToken: "AT_A", expiresAt: undefined }),
				login(b, { accessToken: "AT_B", expiresAt: undefined }),
			];
			await vi.waitFor(() => expect(calls).toBe(2));
			expect(w.document().encryption).toEqual({ kind: "plaintext" });
			const [early, late] = order === "first" ? gates : gates.toReversed();
			early!.open();
			await vi.waitFor(() => expect(w.document().encryption.kind).toBe("aes-256-gcm"));
			late!.open();
			await Promise.all(logins);
			vi.mocked(crypto.subtle.encrypt).mockRestore();
			expect(keyring.writes()).toBe(1);
			await expect(a.get()).resolves.toMatchObject({ value: "AT_A" });
			await expect(b.get()).resolves.toMatchObject({ value: "AT_B" });
		},
	);

	it("a refresh reads or creates the key before its mark, and encrypts the response before its commit", async () => {
		const keyring = fakeKeyring();
		const steps: string[] = [];
		const w = world({
			token: () => {
				steps.push("request");
				return tokenResponse("AT2", "RT2");
			},
		});
		const source = w.source({ store: reopen(w) });
		await login(source);
		const encrypted = w.source();
		const internals = credentialStoreInternals(w.store);
		const update = internals.update;
		vi.spyOn(internals, "update").mockImplementation((change, signal) => {
			steps.push("update");
			return update(change, signal);
		});
		const backend = { ...keyring.backend };
		vi.spyOn(keyring.backend, "get").mockImplementation((...args) => {
			steps.push("key read");
			return backend.get(...args);
		});
		vi.spyOn(keyring.backend, "set").mockImplementation((...args) => {
			steps.push("key write");
			return backend.set(...args);
		});
		const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
		vi.spyOn(crypto.subtle, "encrypt").mockImplementation((...args) => {
			steps.push("encrypt");
			return encrypt(...args);
		});
		await expect(encrypted.get()).resolves.toMatchObject({ value: "AT2" });
		expect(steps).toEqual([
			"key read",
			"key read",
			"key write",
			"key read",
			"update",
			"request",
			"encrypt",
			"update",
		]);
	});

	it("a key failure before the mark sends nothing and leaves no mark", async () => {
		const keyring = fakeKeyring();
		const w = world();
		await login(w.source({ store: reopen(w) }));
		keyring.state.writeGate = new Promise<void>(() => {});
		await expect(w.source().get()).rejects.toMatchObject({ reason: "unavailable" });
		expect(w.tokenRequests()).toHaveLength(0);
		expect(w.document().records[w.source().key].refreshInProgress).toBeUndefined();
	});

	it("an encryption failure after the request returns no token and keeps the mark, also for a restart", async () => {
		fakeKeyring();
		const w = world();
		const source = w.source();
		await login(source);
		vi.spyOn(crypto.subtle, "encrypt").mockRejectedValueOnce(new Error("SENTINEL encrypt failed"));
		const error = await source.get().catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(RefreshOutcomeUnknownError);
		expect(String((error as Error).cause)).not.toContain("SENTINEL");
		expect(w.document().records[source.key].refreshInProgress).toBeDefined();
		await expect(source.get()).rejects.toBeInstanceOf(RefreshOutcomeUnknownError);
		await expect(w.source({ store: reopen(w, {}) }).get()).rejects.toBeInstanceOf(
			RefreshOutcomeUnknownError,
		);
		expect(w.tokenRequests()).toHaveLength(1);
	});

	it("a proven non-rotation clears the mark although another writer set the file's key meanwhile", async () => {
		fakeKeyring();
		const held = gate();
		const w = world({
			token: async () => {
				await held.wait;
				return json({ error: "invalid_scope" }, 400);
			},
		});
		const plain = reopen(w);
		const source = w.source({ store: plain });
		await login(source, { accessToken: "AT_OLD" });
		const refreshing = source.get().catch((error: unknown) => error);
		await vi.waitFor(() => expect(w.tokenRequests()).toHaveLength(1));
		await login(w.source({ identity: { ...w.identity, profile: "other" } }));
		held.open();
		expect(await refreshing).toBeInstanceOf(OAuthError);
		const stored = w.document().records[source.key];
		expect(stored.refreshInProgress).toBeUndefined();
		expect(stored.secret.accessToken).toBe("AT_OLD");
	});

	it("a refresh that prepared plaintext writes nothing once the file has a key, and keeps its mark", async () => {
		fakeKeyring();
		const held = gate();
		const w = world({
			token: async () => {
				await held.wait;
				return tokenResponse("AT2", "RT2");
			},
		});
		const plain = reopen(w);
		const source = w.source({ store: plain });
		await login(source);
		const refreshing = source.get().catch((error: unknown) => error);
		await vi.waitFor(() => expect(w.tokenRequests()).toHaveLength(1));
		await login(w.source({ identity: { ...w.identity, profile: "other" } }));
		held.open();
		expect(await refreshing).toMatchObject({ code: "login-required", reason: "store-changed" });
		expect(w.document().records[source.key].refreshInProgress).toBeDefined();
		expect(w.document().records[source.key].secret.accessToken).toBe("AT1");
		await expect(source.get()).rejects.toBeInstanceOf(RefreshOutcomeUnknownError);
		await expect(w.source({ store: reopen(w) }).get()).rejects.toBeInstanceOf(
			RefreshOutcomeUnknownError,
		);
		expect(w.tokenRequests()).toHaveLength(1);
	});

	it("the same change found by the mark's recheck sends nothing and writes no mark", async () => {
		fakeKeyring();
		const w = world();
		const plain = reopen(w);
		const source = w.source({ store: plain });
		await login(source);
		const internals = credentialStoreInternals(plain);
		const update = internals.update;
		// Another process sets the file's key between this refresh's key choice and its mark.
		vi.spyOn(internals, "update").mockImplementationOnce(async (change, signal) => {
			await login(w.source({ identity: { ...w.identity, profile: "other" } }));
			return update(change, signal);
		});
		await expect(source.get()).rejects.toBeInstanceOf(RefreshFailedError);
		expect(w.tokenRequests()).toHaveLength(0);
		expect(w.document().records[source.key].refreshInProgress).toBeUndefined();
	});

	it("a login's commit lands next to another credential's logout and refresh made while it encrypted", async () => {
		fakeKeyring();
		const w = world({ token: () => tokenResponse("AT_B2", "RT_B2") });
		const a = w.source({ identity: { ...w.identity, profile: "a" } });
		const b = w.source({ identity: { ...w.identity, profile: "b" } });
		const c = w.source({ identity: { ...w.identity, profile: "c" } });
		await login(b);
		await login(c, { expiresAt: undefined });
		const ticket = await a.beginLogin();
		const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
		const held = gate();
		vi.spyOn(crypto.subtle, "encrypt").mockImplementationOnce(async (...args) => {
			await held.wait;
			return encrypt(...args);
		});
		const committing = ticket.commit(loginTokens({ accessToken: "AT_A", expiresAt: undefined }));
		await vi.waitFor(() => expect(crypto.subtle.encrypt).toHaveBeenCalled());
		await c.logout();
		await expect(
			w.source({ identity: { ...w.identity, profile: "b" }, store: reopen(w, {}) }).get(),
		).resolves.toMatchObject({ value: "AT_B2" });
		held.open();
		await committing;
		await expect(a.get()).resolves.toMatchObject({ value: "AT_A" });
		await expect(b.get()).resolves.toMatchObject({ value: "AT_B2" });
		expect(w.document().records[c.key]).toMatchObject({ tombstone: true });
	});

	it("a login that encrypted under a key a replacing login discarded writes nothing", async () => {
		const keyring = fakeKeyring();
		const w = world();
		const a = w.source({ identity: { ...w.identity, profile: "a" } });
		await login(w.source({ identity: { ...w.identity, profile: "z" } }));
		const ticket = await a.beginLogin();
		const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
		const held = gate();
		vi.spyOn(crypto.subtle, "encrypt").mockImplementationOnce(async (...args) => {
			await held.wait;
			return encrypt(...args);
		});
		const committing = ticket.commit(loginTokens()).catch((error: unknown) => error);
		await vi.waitFor(() => expect(crypto.subtle.encrypt).toHaveBeenCalled());
		keyring.entries.clear();
		await login(w.source({ store: reopen(w, {}), identity: { ...w.identity, profile: "b" } }));
		held.open();
		expect(await committing).toBeInstanceOf(StaleCommitError);
		expect(w.document().records[a.key]).toBeUndefined();
	});
});

describe("status", () => {
	it("reports a readable key without writing", async () => {
		const keyring = fakeKeyring();
		const w = world();
		await expect(w.store.status()).resolves.toEqual({
			kind: "bun-secrets",
			encryption: "plaintext",
			keyReadable: false,
			plaintextRecords: 0,
		});
		await login(w.source());
		await expect(reopen(w, {}).status()).resolves.toEqual({
			kind: "bun-secrets",
			encryption: "aes-256-gcm",
			keyReadable: true,
			plaintextRecords: 0,
		});
		keyring.state.get = "error";
		await expect(reopen(w, {}).status()).resolves.toMatchObject({
			kind: "bun-secrets",
			keyReadable: false,
		});
		expect(keyring.writes()).toBe(1);
	});
});

describe("an empty keyring entry", () => {
	it("is an unreadable key, never an absent one: reads, refreshes and logins fail and write nothing", async () => {
		const keyring = fakeKeyring();
		const w = world();
		await login(w.source());
		await login(w.source({ identity: { ...w.identity, profile: "work" } }), {
			expiresAt: undefined,
		});
		keyring.entries.set(`${w.app}\0credentials-key`, "");
		const before = readFileSync(w.file, "utf8");
		for (const call of [
			() => w.source({ store: reopen(w, {}), identity: { ...w.identity, profile: "work" } }).get(),
			() => w.source({ store: reopen(w, {}) }).forceRefresh(),
			() => login(w.source({ store: reopen(w, {}) })),
		]) {
			await expect(call()).rejects.toMatchObject({ code: "credential-key", reason: "unreadable" });
		}
		expect(readFileSync(w.file, "utf8")).toBe(before);
		expect(keyring.writes()).toBe(1);
		expect(w.tokenRequests()).toHaveLength(0);
	});
});

describe("cancellation", () => {
	it("an abort during a login's keyring read stops waiting and never writes a key", async () => {
		const keyring = fakeKeyring();
		keyrings.deadlineMs = 5_000;
		const held = gate();
		keyring.state.readGate = held.wait;
		const w = world();
		const ticket = await w.source().beginLogin();
		const controller = new AbortController();
		const commit = ticket.commit(loginTokens(), { signal: controller.signal });
		await vi.waitFor(() => expect(keyring.calls).toHaveLength(1));
		controller.abort();
		// The keyring answers "no key" right after the abort.
		held.open();
		await expect(commit).rejects.toBeInstanceOf(AbortError);
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(keyring.writes()).toBe(0);
		expect(w.document().records).toEqual({});
	});

	it("an abort while a login waits for the key-init lock stops waiting and never writes a key", async () => {
		const keyring = fakeKeyring();
		const w = world();
		const lock = await holdLock((fn) => withLock(join(w.dir, "key-init"), fn));
		const ticket = await w.source().beginLogin();
		const controller = new AbortController();
		const commit = ticket.commit(loginTokens(), { signal: controller.signal });
		await vi.waitFor(() => expect(keyring.calls).toHaveLength(1));
		await new Promise((resolve) => setTimeout(resolve, 50));
		controller.abort();
		await expect(commit).rejects.toBeInstanceOf(AbortError);
		await lock.release();
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(keyring.writes()).toBe(0);
		expect(keyring.calls).toHaveLength(1);
	});

	it("a refresh whose callers all left during its keyring read writes no key, no mark and sends nothing", async () => {
		const keyring = fakeKeyring();
		const w = world();
		await login(w.source({ store: reopen(w) }));
		const held = gate();
		keyring.state.readGate = held.wait;
		const controller = new AbortController();
		const pending = w.source().get({ signal: controller.signal });
		await vi.waitFor(() => expect(keyring.calls).toHaveLength(1));
		controller.abort();
		await expect(pending).rejects.toBeInstanceOf(AbortError);
		held.open();
		await vi.waitFor(() => expect(refreshFlights.size).toBe(0), { timeout: 10_000 });
		expect(keyring.writes()).toBe(0);
		expect(w.tokenRequests()).toHaveLength(0);
		expect(w.document().records[w.source().key].refreshInProgress).toBeUndefined();
	});

	it("an abort during the keyring read of get() or status() rejects at once", async () => {
		const keyring = fakeKeyring();
		keyrings.deadlineMs = 5_000;
		const w = world();
		await login(w.source(), { expiresAt: undefined });
		keyring.state.get = "hang";
		const store = reopen(w, {});
		for (const call of [
			(signal: AbortSignal) => w.source({ store }).get({ signal }),
			(signal: AbortSignal) => store.status({ signal }),
		]) {
			const controller = new AbortController();
			const started = performance.now();
			const pending = call(controller.signal);
			setTimeout(() => controller.abort(), 50);
			await expect(pending).rejects.toBeInstanceOf(AbortError);
			expect(performance.now() - started).toBeLessThan(1_000);
		}
	});
});

describe("the other runtime's keyring", () => {
	it("a file whose key Bun.secrets holds asks Node for a login with key-other-keyring; that login replaces the key", async () => {
		const bun = fakeKeyring("bun-secrets");
		const w = world();
		await login(w.source({ store: reopen(w), identity: { ...w.identity, profile: "plain" } }), {
			accessToken: "AT_PLAIN",
			expiresAt: undefined,
		});
		await login(w.source(), { expiresAt: undefined });
		const keyId = bun.entry(w.app)!.keyId;
		expect(w.document().encryption).toEqual({ kind: "aes-256-gcm", keyId, keyring: "bun-secrets" });
		const before = readFileSync(w.file, "utf8");
		// The same app under Node: @napi-rs/keyring addresses another native entry.
		const node = fakeKeyring("napi-keyring");
		const store = reopen(w, {});
		for (const call of [
			() => w.source({ store }).get(),
			() => w.source({ store }).forceRefresh(),
		]) {
			await expect(call()).rejects.toMatchObject({
				code: "login-required",
				reason: "key-other-keyring",
			});
		}
		await expect(store.status()).resolves.toEqual({
			kind: "bun-secrets",
			encryption: "aes-256-gcm",
			keyReadable: false,
			plaintextRecords: 1,
		});
		expect(readFileSync(w.file, "utf8")).toBe(before);
		expect(node.writes()).toBe(0);
		const committed = await login(w.source({ store }), {
			accessToken: "AT_NODE",
			expiresAt: undefined,
		});
		expect(committed.discarded).toBe(1);
		expect(w.document().encryption).toEqual({
			kind: "aes-256-gcm",
			keyId: node.entry(w.app)!.keyId,
			keyring: "napi-keyring",
		});
		await expect(w.source({ store }).get()).resolves.toMatchObject({ value: "AT_NODE" });
		await expect(
			w.source({ store, identity: { ...w.identity, profile: "plain" } }).get(),
		).resolves.toMatchObject({ value: "AT_PLAIN" });
	});

	it("a key both runtimes reach (one macOS Keychain item) keeps working under the other runtime", async () => {
		const bun = fakeKeyring("bun-secrets");
		const w = world();
		await login(w.source(), { accessToken: "AT_BUN", expiresAt: undefined });
		const node = fakeKeyring("napi-keyring");
		for (const [name, value] of bun.entries) node.entries.set(name, value);
		await expect(w.source({ store: reopen(w, {}) }).get()).resolves.toMatchObject({
			value: "AT_BUN",
		});
		await expect(reopen(w, {}).status()).resolves.toMatchObject({
			kind: "bun-secrets",
			keyReadable: true,
		});
		expect(node.writes()).toBe(0);
	});

	it("a file that records no keyring keeps key-missing", async () => {
		fakeKeyring("bun-secrets");
		const w = world();
		await login(w.source());
		const raw = JSON.parse(readFileSync(w.file, "utf8"));
		delete raw.encryption.keyring;
		writeFileSync(w.file, JSON.stringify(raw));
		fakeKeyring("napi-keyring");
		await expect(w.source({ store: reopen(w, {}) }).get()).rejects.toMatchObject({
			reason: "key-missing",
		});
	});

	it("an unknown keyring in the file is a corrupt file", async () => {
		fakeKeyring();
		const w = world();
		await login(w.source());
		const raw = JSON.parse(readFileSync(w.file, "utf8"));
		raw.encryption.keyring = "rot13";
		writeFileSync(w.file, JSON.stringify(raw));
		await expect(w.source({ store: reopen(w, {}) }).get()).rejects.toBeInstanceOf(
			CredentialStoreCorruptError,
		);
	});
});
