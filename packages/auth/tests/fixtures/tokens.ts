// A child process for tests/processes.test.ts, run under Node and Bun with XDG_STATE_HOME set:
// - `refresh <issuer> <app>`: prints the access token `get()` returns, or the error code;
// - `hold <issuer> <app>`: takes the credential's identity lock, prints "locked" and waits;
// - `runtime`: real sockets: a refused token request on the runtime's own fetch, and a 401
//   retry and a cross-origin redirect through @crustjs/openapi. Prints one JSON report.
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { Crust, defineCommand } from "@crustjs/core";
import { apiClient, apiCommand, bearerAuth } from "@crustjs/openapi";

import { credentialStoreInternals } from "../../src/credentials.ts";
import {
	createTokenSource,
	credentialStore,
	defineServers,
	fromStore,
	resolveCredential,
} from "../../src/oauth.ts";

const [mode, issuerArg, app = "acme"] = process.argv.slice(2);

function sourceFor(issuer: string) {
	const config = defineServers({
		servers: [{ issuer, clientId: "cli", allowInsecureLoopback: true }],
	});
	const store = credentialStore({ app, lockTimeout: 20_000 });
	return {
		store,
		source: createTokenSource({
			config,
			identity: { issuer, clientId: "cli", apiOrigins: [issuer] },
			store,
		}),
	};
}

async function listen(handler: (request: IncomingMessage, response: ServerResponse) => void) {
	const server = createServer(handler).listen(0, "127.0.0.1");
	await once(server, "listening");
	return { server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
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
				auth: bearerAuth((options) => resolveCredential([fromStore(source)], options)),
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
	as.server.closeAllConnections();
	as.server.close();
	offsite.server.close();
	const refused = await source.get().catch((error: { code?: string }) => error.code);
	const document = await credentialStoreInternals(store).read();
	const record = document?.records[source.key] as { refreshInProgress?: unknown } | undefined;
	console.log(
		JSON.stringify({ api, refused, markCleared: record?.refreshInProgress === undefined }),
	);
}
