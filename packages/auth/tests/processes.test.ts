/**
 * @module-tag windows
 * @module-tag macos
 */
// Token sources in separate Node and Bun processes over one credentials file, with real
// lock files and a real authorization server on the loopback.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { defineServers } from "../src/config.ts";
import { credentialStore } from "../src/credentials.ts";
import { createTokenSource } from "../src/token-source.ts";
import { loginTokens } from "./helpers.ts";

const script = join(import.meta.dirname, "fixtures", "tokens.ts");
const cleanup: (() => void)[] = [];

afterEach(() => {
	vi.unstubAllEnvs();
	for (const step of cleanup.splice(0)) step();
});

/**
 * A loopback authorization server and API. The token endpoint answers after `delayMs`, or
 * once `release()` is called while it is held (`hold()`); `/api/me` answers 401 to `AT1`.
 */
async function authorizationServer(
	delayMs: number,
	tokenBody: () => unknown = () => ({
		access_token: "AT2",
		refresh_token: "RT2",
		token_type: "Bearer",
		expires_in: 3600,
	}),
) {
	const refreshTokens: string[] = [];
	const apiSeen: (string | null)[] = [];
	let tokenGate: Promise<void> | undefined;
	let apiGate: Promise<void> | undefined;
	const server: Server = createServer((request, response) => {
		void (async () => {
			const send = (body: unknown, status = 200) =>
				response
					.writeHead(status, { "content-type": "application/json" })
					.end(JSON.stringify(body));
			if (request.url === "/token") {
				let body = "";
				for await (const chunk of request) body += chunk;
				refreshTokens.push(new URLSearchParams(body).get("refresh_token") ?? "");
				await tokenGate;
				const answer = tokenBody() as { error?: string };
				setTimeout(() => send(answer, answer.error ? 400 : 200), delayMs);
			} else if (request.url === "/api/me") {
				apiSeen.push(request.headers.authorization ?? null);
				await apiGate;
				send({}, request.headers.authorization === "Bearer AT1" ? 401 : 200);
			} else {
				send({
					issuer,
					token_endpoint: `${issuer}/token`,
					code_challenge_methods_supported: ["S256"],
				});
			}
		})();
	}).listen(0, "127.0.0.1");
	await once(server, "listening");
	const issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	cleanup.push(() => {
		server.closeAllConnections();
		server.close();
	});
	const gate = () => Promise.withResolvers<void>();
	return {
		issuer,
		posts: () => refreshTokens.length,
		refreshTokens,
		apiSeen,
		/** Holds token responses until the returned function is called. */
		holdTokens() {
			const held = gate();
			tokenGate = held.promise;
			return () => held.resolve();
		},
		/** Holds API responses until the returned function is called. */
		holdApi() {
			const held = gate();
			apiGate = held.promise;
			return () => held.resolve();
		},
	};
}

/** Resolves when `check` passes, polling for up to 30 seconds. */
const until = (check: () => boolean) =>
	vi.waitFor(() => expect(check()).toBe(true), { timeout: 30_000, interval: 20 });

/** Fails with what `process_` printed unless it is still running after `ms`, as one waiting for a lock is. */
async function expectWaiting(process_: ChildProcess, printed: Promise<string>, ms: number) {
	await new Promise((resolve) => setTimeout(resolve, ms));
	if (process_.exitCode !== null || process_.signalCode !== null) {
		expect(await printed).toBe("(still waiting for the lock)");
	}
}

/** A credentials file with a login for `issuer` (expired unless `expiresAt`), and its token source. */
async function loggedIn(issuer: string, expiresAt?: number) {
	const root = mkdtempSync(join(tmpdir(), "crust-auth-"));
	cleanup.push(() => rmSync(root, { recursive: true, force: true }));
	// The state directory on POSIX and on Windows, for this process and its children.
	vi.stubEnv("XDG_STATE_HOME", root);
	vi.stubEnv("LOCALAPPDATA", root);
	const config = defineServers({
		servers: [{ issuer, clientId: "cli", allowInsecureLoopback: true }],
	});
	const source = createTokenSource({
		config,
		identity: { issuer, clientId: "cli", apiOrigins: [issuer] },
		store: credentialStore({ app: "acme", lockTimeout: 20_000 }),
	});
	await (
		await source.beginLogin()
	).commit(loginTokens(expiresAt === undefined ? {} : { expiresAt }));
	return { root, source };
}

function child(runtime: string, args: string[], root: string): ChildProcess {
	const process_ = spawn(runtime, [script, ...args], {
		env: { ...process.env, XDG_STATE_HOME: root, LOCALAPPDATA: root },
		stdio: ["ignore", "pipe", "pipe"],
	});
	const timer = setTimeout(() => process_.kill("SIGKILL"), 60_000);
	process_.once("exit", () => clearTimeout(timer));
	cleanup.push(() => process_.kill("SIGKILL"));
	return process_;
}

/** `credentials.json` of the app `acme`, wherever the platform keeps its state directory. */
const credentialsFile = () => credentialStore({ app: "acme" }).path;

/** How many keyring writes the file-backed keyring of the fixture saw. */
const keyWrites = (keyring: string) =>
	readFileSync(`${keyring}.writes`, "utf8").trim().split("\n").length;

async function output(process_: ChildProcess): Promise<string> {
	let text = "";
	let errors = "";
	process_.stdout!.on("data", (chunk: Buffer) => (text += chunk));
	process_.stderr!.on("data", (chunk: Buffer) => (errors += chunk));
	if (process_.exitCode === null && process_.signalCode === null) await once(process_, "exit");
	return text.trim() || errors.trim();
}

describe.each(["node", "bun"])("on %s", (runtime) => {
	it("two processes refreshing one credential send one request", async () => {
		const as = await authorizationServer(300);
		const { root } = await loggedIn(as.issuer);
		const [a, b] = [
			child(runtime, ["refresh", as.issuer], root),
			child(runtime, ["refresh", as.issuer], root),
		];
		expect(await Promise.all([output(a), output(b)])).toEqual(["AT2", "AT2"]);
		expect(as.posts()).toBe(1);
	}, 90_000);

	it("a process that starts after another's mark waits on the lock and gets its token", async () => {
		const as = await authorizationServer(0);
		const release = as.holdTokens();
		const { root } = await loggedIn(as.issuer);
		const a = child(runtime, ["refresh", as.issuer], root);
		const outputA = output(a);
		await until(() => as.posts() === 1);
		const b = child(runtime, ["refresh", as.issuer], root);
		const outputB = output(b);
		await expectWaiting(b, outputB, 1_000);
		release();
		expect(await Promise.all([outputA, outputB])).toEqual(["AT2", "AT2"]);
		expect(as.posts()).toBe(1);
	}, 90_000);

	it("a process waiting behind a refused refresh is told to log in, and its request proves nothing rotated", async () => {
		const as = await authorizationServer(0, () => ({ error: "invalid_grant" }));
		const release = as.holdTokens();
		const { root } = await loggedIn(as.issuer);
		const a = child(runtime, ["refresh", as.issuer], root);
		const outputA = output(a);
		await until(() => as.posts() === 1);
		const b = child(runtime, ["refresh", as.issuer], root);
		const outputB = output(b);
		await expectWaiting(b, outputB, 1_000);
		release();
		// A cleared its mark on proof of no rotation, so B's turn is "the next call", which retries.
		expect(await Promise.all([outputA, outputB])).toEqual(["login-required", "login-required"]);
		expect(as.refreshTokens).toEqual(["RT1", "RT1"]);
	}, 90_000);

	it("a process killed after its mark leaves the refresh uncertain for the next one", async () => {
		const as = await authorizationServer(0);
		as.holdTokens();
		const { root } = await loggedIn(as.issuer);
		const a = child(runtime, ["refresh", as.issuer], root);
		await until(() => as.posts() === 1);
		a.kill("SIGKILL");
		await once(a, "exit");
		const b = child(runtime, ["refresh", as.issuer], root);
		expect(await output(b)).toBe("refresh-outcome-unknown");
		expect(as.posts()).toBe(1);
	}, 90_000);

	it("a 401 retry racing another process's refresh waits and retries with its token", async () => {
		const as = await authorizationServer(0);
		const { root } = await loggedIn(as.issuer, Date.now() + 3_600_000);
		const releaseApi = as.holdApi();
		const b = child(runtime, ["api", as.issuer], root);
		const outputB = output(b);
		await until(() => as.apiSeen.length === 1);
		const releaseTokens = as.holdTokens();
		const a = child(runtime, ["force", as.issuer], root);
		const outputA = output(a);
		await until(() => as.posts() === 1);
		releaseApi();
		await expectWaiting(b, outputB, 1_000);
		expect(as.apiSeen).toEqual(["Bearer AT1"]);
		releaseTokens();
		expect(await Promise.all([outputA, outputB])).toEqual(["AT2", "200"]);
		expect(as.apiSeen).toEqual(["Bearer AT1", "Bearer AT2"]);
		expect(as.posts()).toBe(1);
	}, 90_000);

	it("recovers the lock of a killed owner", async () => {
		const as = await authorizationServer(0);
		const { root, source } = await loggedIn(as.issuer);
		const holder = child(runtime, ["hold", as.issuer], root);
		await new Promise<void>((resolve) => holder.stdout!.once("data", () => resolve()));
		holder.kill("SIGKILL");
		await once(holder, "exit");
		await expect(source.get()).resolves.toMatchObject({ value: "AT2" });
		expect(as.posts()).toBe(1);
	}, 90_000);

	it("two first logins at once create one keyring key; each process decrypts its login", async () => {
		const as = await authorizationServer(0);
		const { root } = await loggedIn(as.issuer);
		const keyring = join(root, "keyring");
		const [a, b] = ["a", "b"].map((profile) =>
			child(runtime, ["login", as.issuer, "acme", profile, keyring, "300"], root),
		);
		expect(await Promise.all([output(a!), output(b!)])).toEqual(["ok", "ok"]);
		expect(keyWrites(keyring)).toBe(1);
		const document = JSON.parse(readFileSync(credentialsFile(), "utf8"));
		expect(document.encryption).toEqual({
			kind: "aes-256-gcm",
			keyId: JSON.parse(readFileSync(keyring, "utf8")).keyId,
			keyring: "bun-secrets",
		});
		// The default profile logged in before the keyring and stayed plaintext; its expired
		// login's refresh encrypts it.
		const plain = Object.entries(document.records).find(([key]) => key.startsWith("default#"));
		expect(plain![1]).toMatchObject({ secret: { accessToken: "AT1" } });
		const readers = ["a", "b", "default"].map((profile) =>
			child(runtime, ["read", as.issuer, "acme", profile, keyring], root),
		);
		expect(await Promise.all(readers.map(output))).toEqual(["AT_a", "AT_b", "AT2"]);
		expect(readFileSync(credentialsFile(), "utf8")).not.toMatch(/"AT|"RT/);
	}, 90_000);

	it("a process killed before its login's write leaves the file intact, and the next login writes no second key", async () => {
		const as = await authorizationServer(0);
		const { root } = await loggedIn(as.issuer);
		const keyring = join(root, "keyring");
		const file = credentialsFile();
		const before = readFileSync(file, "utf8");
		const killed = child(runtime, ["login-hang", as.issuer, "acme", "a", keyring], root);
		await new Promise<void>((resolve) => killed.stdout!.once("data", () => resolve()));
		killed.kill("SIGKILL");
		await once(killed, "exit");
		expect(readFileSync(file, "utf8")).toBe(before);
		expect(existsSync(keyring)).toBe(true);
		const next = child(runtime, ["login", as.issuer, "acme", "a", keyring], root);
		expect(await output(next)).toBe("ok");
		expect(keyWrites(keyring)).toBe(1);
		const reader = child(runtime, ["read", as.issuer, "acme", "a", keyring], root);
		expect(await output(reader)).toBe("AT_a");
	}, 90_000);

	it("a key write past one process's deadline fails its login; a process waiting for it reuses that key", async () => {
		const as = await authorizationServer(0);
		const { root } = await loggedIn(as.issuer);
		const keyring = join(root, "keyring");
		const login = (profile: string, delay: string) =>
			child(runtime, ["login", as.issuer, "acme", profile, keyring, delay, "500"], root);
		const a = login("a", "3000");
		const outputA = output(a);
		await until(() => existsSync(`${keyring}.writes`));
		// A is still running and holds the key-init lock until its write lands.
		const outputB = output(login("b", "0"));
		expect(await outputA).toBe("credential-key");
		expect(await outputB).toBe("ok");
		expect(keyWrites(keyring)).toBe(1);
		const reader = child(runtime, ["read", as.issuer, "acme", "b", keyring], root);
		expect(await output(reader)).toBe("AT_b");
	}, 90_000);

	it("a creator killed during its key write: a late write replaces the key, and one login restores service", async () => {
		const as = await authorizationServer(0);
		const { root } = await loggedIn(as.issuer);
		const keyring = join(root, "keyring");
		const killed = child(runtime, ["login", as.issuer, "acme", "a", keyring, "hang"], root);
		await until(() => existsSync(`${keyring}.late`));
		killed.kill("SIGKILL");
		await once(killed, "exit");
		const run = async (args: string[]) =>
			output(child(runtime, [args[0]!, as.issuer, "acme", "b", keyring, ...args.slice(1)], root));
		// The next process takes over the dead creator's lock and creates its own key.
		expect(await run(["login"])).toBe("ok");
		expect(await run(["read"])).toBe("AT_b");
		// The killed creator's write lands after all.
		copyFileSync(`${keyring}.late`, keyring);
		expect(await run(["read"])).toBe("login-required:key-mismatch");
		expect(await run(["login"])).toBe("ok");
		expect(await run(["read"])).toBe("AT_b");
		expect(keyWrites(keyring)).toBe(2);
	}, 90_000);

	it("retries a 401 over real sockets and proves a refused connection sent nothing", () => {
		const root = mkdtempSync(join(tmpdir(), "crust-auth-"));
		cleanup.push(() => rmSync(root, { recursive: true, force: true }));
		const run = spawnSync(runtime, [script, "runtime"], {
			encoding: "utf8",
			timeout: 60_000,
			env: { ...process.env, XDG_STATE_HOME: root, LOCALAPPDATA: root },
		});
		expect(run.error).toBeUndefined();
		expect(run.stderr).toBe("");
		expect(JSON.parse(run.stdout)).toEqual({
			api: {
				result: { me: 200, moved: { authorization: null } },
				seen: ["Bearer AT1", "Bearer AT2"],
				tokenPosts: 1,
			},
			refused: "refresh-failed",
			markCleared: true,
		});
	}, 90_000);
});
