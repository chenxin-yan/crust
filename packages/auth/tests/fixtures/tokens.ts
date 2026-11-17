// A child process for tests/processes.test.ts, run under Node and Bun with XDG_STATE_HOME set:
// - `refresh <issuer> <app>`: prints the access token `get()` returns, or the error code;
// - `force <issuer> <app>`: the same for `forceRefresh()`;
// - `api <issuer> <app>`: GET <issuer>/api/me through bearerAuth() and a stored login; prints
//   the status, or the error code;
// - `hold <issuer> <app>`: takes the credential's identity lock, prints "locked" and waits;
// - `login <issuer> <app> <profile> <keyring file> <write delay ms>`: logs in with the keyring on,
//   over a keyring kept in a file (each write appends a line to `<file>.writes` first); prints
//   "ok", or the error code;
// - `login-hang <issuer> <app> <profile> <keyring file>`: the same, but prints "writing" and
//   waits forever once the login's file write is about to start;
// - `read <issuer> <app> <profile> <keyring file>`: prints the access token `get()` returns, or
//   the error code;
// - `runtime`: real sockets: a refused token request on the runtime's own fetch, and a 401
//   retry and a cross-origin redirect through @crustjs/openapi. Prints one JSON report.
import { once } from "node:events";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { type AddressInfo, connect } from "node:net";

import { Crust, defineCommand } from "@crustjs/core";
import { apiClient, apiCommand, type BearerCredential, bearerAuth } from "@crustjs/openapi";

import { credentialStoreInternals } from "../../src/credentials.ts";
import { keyrings } from "../../src/keyring.ts";
import { createTokenSource, credentialStore, defineServers } from "../../src/oauth.ts";
import type { AccessToken, TokenSource } from "../../src/types.ts";

const [mode, issuerArg, app = "acme", profile = "default", keyringFile, writeDelay = "0"] =
	process.argv.slice(2);

if (keyringFile) {
	keyrings.load = async () => ({
		kind: "bun-secrets",
		async get() {
			try {
				return readFileSync(keyringFile, "utf8") || undefined;
			} catch {
				return undefined;
			}
		},
		async set(_service, _name, value) {
			appendFileSync(`${keyringFile}.writes`, `${process.pid}\n`);
			await new Promise((resolve) => setTimeout(resolve, Number(writeDelay)));
			writeFileSync(keyringFile, value);
		},
	});
}

function sourceFor(issuer: string) {
	const config = defineServers({
		servers: [{ issuer, clientId: "cli", allowInsecureLoopback: true }],
	});
	const store = credentialStore({
		app,
		lockTimeout: 20_000,
		keyring: keyringFile ? {} : undefined,
	});
	return {
		store,
		source: createTokenSource({
			config,
			identity: { issuer, clientId: "cli", apiOrigins: [issuer], profile },
			store,
		}),
	};
}

async function listen(handler: (request: IncomingMessage, response: ServerResponse) => void) {
	// No keep-alive: a pooled connection the server already closed makes the next request fail
	// with a reset, possibly after it was written (seen with Bun 1.4.4 under load), not a refusal.
	const server = createServer((request, response) => {
		response.setHeader("connection", "close");
		handler(request, response);
	}).listen(0, "127.0.0.1");
	await once(server, "listening");
	const { port } = server.address() as AddressInfo;
	return { server, port, origin: `http://127.0.0.1:${port}` };
}

/** Closes `server` and proves its port now refuses a TCP connect. */
async function shutDown(server: ReturnType<typeof createServer>, port: number) {
	server.closeAllConnections();
	await new Promise((resolve) => server.close(resolve));
	const socket = connect(port, "127.0.0.1");
	try {
		await once(socket, "connect");
		throw new Error(`port ${port} still accepts connections after close`);
	} catch (error) {
		if ((error as { code?: string }).code !== "ECONNREFUSED") throw error;
	} finally {
		socket.destroy();
	}
}

/** `bearerAuth()` over a token source, as the auth docs connect one. */
function bearer(source: TokenSource) {
	return bearerAuth(async ({ signal, baseUrl }) => {
		const credential = (stored: AccessToken): BearerCredential => ({
			value: stored.value,
			refresh: async (options) =>
				credential(
					await source.forceRefresh({ ...options, ifGeneration: stored.generation, baseUrl }),
				),
		});
		return credential(await source.get({ signal, baseUrl }));
	});
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
	response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

if (mode === "refresh") {
	const { source } = sourceFor(issuerArg!);
	try {
		console.log((await source.get()).value);
	} catch (error) {
		console.log((error as { code?: string }).code ?? String(error));
	}
} else if (mode === "force") {
	const { source } = sourceFor(issuerArg!);
	try {
		console.log((await source.forceRefresh()).value);
	} catch (error) {
		console.log((error as { code?: string }).code ?? String(error));
	}
} else if (mode === "api") {
	const { source } = sourceFor(issuerArg!);
	const cli = new Crust("acme")
		.extend(
			apiCommand({
				spec: { openapi: "3.1.0", paths: {} },
				baseUrl: `${issuerArg}/api`,
				auth: bearer(source),
			}),
		)
		.add(
			defineCommand("call", {}, (command) =>
				command
					.use(apiClient)
					.action(async ({ ctx }) => (await (await ctx.api).fetch("/me")).status),
			),
		);
	const outcome = await cli.run(["call"]);
	console.log(
		outcome.status === "completed"
			? outcome.result
			: outcome.status === "failed"
				? ((outcome.error as { code?: string }).code ?? String(outcome.error))
				: outcome.status,
	);
} else if (mode === "login" || mode === "login-hang") {
	const { store, source } = sourceFor(issuerArg!);
	if (mode === "login-hang") {
		credentialStoreInternals(store).update = async () => {
			console.log("writing");
			return new Promise(() => {});
		};
	}
	try {
		await (
			await source.beginLogin()
		).commit({
			accessToken: `AT_${profile}`,
			refreshToken: `RT_${profile}`,
			tokenType: "Bearer",
			expiresAt: undefined,
			scope: undefined,
		});
		console.log("ok");
	} catch (error) {
		console.log((error as { code?: string }).code ?? String(error));
	}
} else if (mode === "read") {
	const { source } = sourceFor(issuerArg!);
	try {
		console.log((await source.get()).value);
	} catch (error) {
		console.log((error as { code?: string }).code ?? String(error));
	}
} else if (mode === "hold") {
	const { store, source } = sourceFor(issuerArg!);
	await credentialStoreInternals(store).lockIdentity(source.key, async () => {
		console.log("locked");
		await new Promise(() => {});
	});
} else if (mode === "runtime") {
	// A server on one origin: the authorization server (AT2) and the API (401 for AT1, and a
	// redirect to another origin for /moved).
	const offsite = await listen((request, response) => {
		sendJson(response, 200, { authorization: request.headers.authorization ?? null });
	});
	let tokenPosts = 0;
	const seen: (string | null)[] = [];
	const as = await listen((request, response) => {
		if (request.url === "/token") {
			tokenPosts += 1;
			sendJson(response, 200, { access_token: "AT2", token_type: "Bearer", expires_in: 3600 });
		} else if (request.url?.startsWith("/.well-known/")) {
			sendJson(response, 200, {
				issuer: as.origin,
				token_endpoint: `${as.origin}/token`,
				code_challenge_methods_supported: ["S256"],
			});
		} else if (request.url === "/api/moved") {
			response.writeHead(302, { location: `${offsite.origin}/x` }).end();
		} else {
			seen.push(request.headers.authorization ?? null);
			sendJson(response, request.headers.authorization === "Bearer AT1" ? 401 : 200, {});
		}
	});
	const { store, source } = sourceFor(as.origin);
	const commit = async (expiresAt: number | undefined) =>
		(await source.beginLogin()).commit({
			accessToken: "AT1",
			refreshToken: "RT1",
			tokenType: "Bearer",
			expiresAt,
			scope: undefined,
		});
	await commit(undefined);
	const cli = new Crust("acme")
		.extend(
			apiCommand({
				spec: { openapi: "3.1.0", paths: {} },
				baseUrl: `${as.origin}/api`,
				auth: bearer(source),
			}),
		)
		.add(
			defineCommand("call", {}, (command) =>
				command.use(apiClient).action(async ({ ctx }) => {
					const api = await ctx.api;
					const me = (await api.fetch("/me")).status;
					const moved = await (await api.fetch("/moved")).json();
					return { me, moved };
				}),
			),
		);
	const outcome = await cli.run(["call"]);
	const result = outcome.status === "completed" ? outcome.result : outcome.status;
	const api = { result, seen, tokenPosts };

	// The server is gone, so the runtime's own fetch fails to connect: nothing was sent.
	await commit(Date.now() - 1);
	await shutDown(as.server, as.port);
	await shutDown(offsite.server, offsite.port);
	// Records what the runtime's fetch threw, so an unexpected outcome explains itself.
	const runtimeFetch = globalThis.fetch;
	const fetchErrors: unknown[] = [];
	const fetchStatuses: number[] = [];
	const postsBefore = tokenPosts;
	const started = Date.now();
	globalThis.fetch = Object.assign(
		async (...args: Parameters<typeof fetch>) => {
			try {
				const response = await runtimeFetch(...args);
				fetchStatuses.push(response.status);
				return response;
			} catch (error) {
				fetchErrors.push(error);
				throw error;
			}
		},
		runtimeFetch,
	);
	const refused = await source.get().catch((error: { code?: string }) => error.code);
	const document = await credentialStoreInternals(store).read();
	const record = document?.records[source.key] as { refreshInProgress?: unknown } | undefined;
	const report: Record<string, unknown> = {
		api,
		refused,
		markCleared: record?.refreshInProgress === undefined,
	};
	if (refused !== "refresh-failed") {
		report.diagnostic = {
			ms: Date.now() - started,
			tokenPostsAfterClose: tokenPosts - postsBefore,
			fetchStatuses,
			fetchErrors: fetchErrors.map((error) => {
				const { name, message, code, cause } = error as Error & { code?: unknown };
				const inner = cause as (Error & { code?: unknown }) | undefined;
				return {
					name,
					code,
					message,
					cause: inner && { name: inner.name, code: inner.code, message: inner.message },
				};
			}),
		};
	}
	console.log(JSON.stringify(report));
}
