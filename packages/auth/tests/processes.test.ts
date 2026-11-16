/** @module-tag macos */
// Token sources in separate Node and Bun processes over one credentials file, with real
// lock files and a real authorization server on the loopback.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
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

/** A loopback authorization server whose token endpoint answers after `delayMs`. */
async function authorizationServer(delayMs: number) {
	let posts = 0;
	const server: Server = createServer((request, response) => {
		const send = (body: unknown) =>
			response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
		if (request.url === "/token") {
			posts += 1;
			setTimeout(
				() =>
					send({
						access_token: "AT2",
						refresh_token: "RT2",
						token_type: "Bearer",
						expires_in: 3600,
					}),
				delayMs,
			);
			return;
		}
		send({ issuer, token_endpoint: `${issuer}/token`, code_challenge_methods_supported: ["S256"] });
	}).listen(0, "127.0.0.1");
	await once(server, "listening");
	const issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	cleanup.push(() => {
		server.closeAllConnections();
		server.close();
	});
	return { issuer, posts: () => posts };
}

/** A credentials file with an expired login for `issuer`, and its token source. */
async function loggedIn(issuer: string) {
	const root = mkdtempSync(join(tmpdir(), "crust-auth-"));
	cleanup.push(() => rmSync(root, { recursive: true, force: true }));
	vi.stubEnv("XDG_STATE_HOME", root);
	const config = defineServers({
		servers: [{ issuer, clientId: "cli", allowInsecureLoopback: true }],
	});
	const source = createTokenSource({
		config,
		identity: { issuer, clientId: "cli", apiOrigins: [issuer] },
		store: credentialStore({ app: "acme", lockTimeout: 20_000 }),
	});
	await (await source.beginLogin()).commit(loginTokens());
	return { root, source };
}

function child(runtime: string, args: string[], root: string): ChildProcess {
	const process_ = spawn(runtime, [script, ...args], {
		env: { ...process.env, XDG_STATE_HOME: root },
		stdio: ["ignore", "pipe", "pipe"],
	});
	const timer = setTimeout(() => process_.kill("SIGKILL"), 60_000);
	process_.once("exit", () => clearTimeout(timer));
	cleanup.push(() => process_.kill("SIGKILL"));
	return process_;
}

async function output(process_: ChildProcess): Promise<string> {
	let text = "";
	process_.stdout!.on("data", (chunk: Buffer) => (text += chunk));
	await once(process_, "exit");
	return text.trim();
}

describe.each(["node", "bun"])("on %s", (runtime) => {
	it("SEC-Q4 SEC-F3 SEC-DEC-13 two processes refreshing one credential send one request", async () => {
		const as = await authorizationServer(300);
		const { root } = await loggedIn(as.issuer);
		const [a, b] = [
			child(runtime, ["refresh", as.issuer], root),
			child(runtime, ["refresh", as.issuer], root),
		];
		expect(await Promise.all([output(a), output(b)])).toEqual(["AT2", "AT2"]);
		expect(as.posts()).toBe(1);
	}, 90_000);

	it("SEC-Q4 recovers the lock of a killed owner", async () => {
		const as = await authorizationServer(0);
		const { root, source } = await loggedIn(as.issuer);
		const holder = child(runtime, ["hold", as.issuer], root);
		await new Promise<void>((resolve) => holder.stdout!.once("data", () => resolve()));
		holder.kill("SIGKILL");
		await once(holder, "exit");
		await expect(source.get()).resolves.toMatchObject({ value: "AT2" });
		expect(as.posts()).toBe(1);
	}, 90_000);

	it("SEC-F5 SEC-J2 SEC-J4 retries a 401 over real sockets and proves a refused connection sent nothing", () => {
		const root = mkdtempSync(join(tmpdir(), "crust-auth-"));
		cleanup.push(() => rmSync(root, { recursive: true, force: true }));
		const run = spawnSync(runtime, [script, "runtime"], {
			encoding: "utf8",
			timeout: 60_000,
			env: { ...process.env, XDG_STATE_HOME: root },
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
