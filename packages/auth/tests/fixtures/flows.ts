// Runs the browser and device logins against a fake authorization server over real sockets
// and prints one JSON report. tests/runtimes.test.ts runs it under Node and Bun, because
// Bun's node:http close and timeout behavior is not assumed to match Node's.
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { type AddressInfo, connect } from "node:net";

import {
	createAuthorizationSession,
	createTokenClient,
	defineAuth,
	discover,
	startDeviceFlow,
} from "../../src/index.ts";
import { listenLoopback } from "../../src/loopback.ts";

function listen(handler: (request: IncomingMessage, response: ServerResponse) => void) {
	const server = createServer(handler);
	server.listen(0, "127.0.0.1");
	return once(server, "listening").then(() => server);
}

async function readBody(request: IncomingMessage): Promise<URLSearchParams> {
	let body = "";
	for await (const chunk of request) body += chunk;
	return new URLSearchParams(body);
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
	response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

const offsiteRequests: string[] = [];
const offsite = await listen((request, response) => {
	offsiteRequests.push(request.url ?? "");
	sendJson(response, 200, { access_token: "STOLEN", token_type: "Bearer" });
});
const offsiteOrigin = `http://127.0.0.1:${(offsite.address() as AddressInfo).port}`;

const challenges = new Map<string, string>();
const devicePolls: string[] = [];
const deviceScript = ["authorization_pending", "slow_down", "success"];
let issuer = "";
const as = await listen((request, response) => {
	void (async () => {
		const url = new URL(request.url ?? "/", issuer);
		const metadata = (base: string) => ({
			issuer: base,
			authorization_endpoint: `${issuer}/authorize`,
			token_endpoint: base === issuer ? `${issuer}/token` : `${issuer}/redirect-token`,
			device_authorization_endpoint: `${issuer}/device`,
			code_challenge_methods_supported: ["S256"],
			authorization_response_iss_parameter_supported: true,
		});
		switch (url.pathname) {
			case "/.well-known/oauth-authorization-server":
				return sendJson(response, 200, metadata(issuer));
			case "/.well-known/oauth-authorization-server/redirecting":
				return sendJson(response, 200, metadata(`${issuer}/redirecting`));
			case "/.well-known/oauth-authorization-server/moved":
				response.writeHead(307, { location: `${offsiteOrigin}/metadata` }).end();
				return;
			case "/authorize": {
				const code = `code-${challenges.size}`;
				challenges.set(code, url.searchParams.get("code_challenge") ?? "");
				const target = new URL(url.searchParams.get("redirect_uri") ?? "");
				target.search = new URLSearchParams({ code, state: url.searchParams.get("state") ?? "", iss: issuer }).toString();
				response.writeHead(302, { location: target.href }).end();
				return;
			}
			case "/token": {
				const body = await readBody(request);
				if (body.get("grant_type") === "urn:ietf:params:oauth:grant-type:device_code") {
					devicePolls.push(String(Date.now()));
					const step = deviceScript.shift();
					return step === "success"
						? sendJson(response, 200, { access_token: "DEVICE_AT", token_type: "Bearer" })
						: sendJson(response, 400, { error: step });
				}
				const challenge = createHash("sha256").update(body.get("code_verifier") ?? "").digest("base64url");
				return challenge === challenges.get(body.get("code") ?? "")
					? sendJson(response, 200, { access_token: "BROWSER_AT", token_type: "Bearer", expires_in: 60 })
					: sendJson(response, 400, { error: "invalid_grant" });
			}
			case "/redirect-token":
				response.writeHead(307, { location: `${offsiteOrigin}/token` }).end();
				return;
			case "/device":
				return sendJson(response, 200, {
					device_code: "DEVICE",
					user_code: "ABCD-EFGH",
					verification_uri: `${issuer}/activate`,
					expires_in: 600,
					interval: 5,
				});
			default:
				response.writeHead(404).end();
		}
	})();
});
issuer = `http://127.0.0.1:${(as.address() as AddressInfo).port}`;

const config = defineAuth({
	servers: [
		{ issuer, clientId: "cli", allowInsecureLoopback: true },
		{ issuer: `${issuer}/redirecting`, clientId: "cli", allowInsecureLoopback: true, redirectPath: "/r/callback" },
		{ issuer: `${issuer}/moved`, clientId: "cli", allowInsecureLoopback: true, redirectPath: "/m/callback" },
	],
});
const report: Record<string, unknown> = {};

async function refused(port: number): Promise<boolean> {
	const socket = connect(port, "127.0.0.1");
	return new Promise((resolve) => {
		socket.once("connect", () => {
			socket.destroy();
			resolve(false);
		});
		socket.once("error", (error: NodeJS.ErrnoException) => resolve(error.code === "ECONNREFUSED"));
	});
}

const failure = (error: unknown) => ({ code: (error as { code?: string }).code, status: (error as { status?: number }).status });

// Browser login end to end: the browser follows the authorize redirect to the loopback.
{
	const server = await discover(config, issuer);
	const session = await createAuthorizationSession(server);
	const port = Number(new URL(session.redirectUri).port);
	const client = createTokenClient(server);
	const tokens = session.wait(({ code }) => client.exchangeCode(session, code));
	const authorize = await fetch(session.url, { redirect: "manual" });
	const callback = await fetch(authorize.headers.get("location") ?? "");
	report.loopback = {
		status: callback.status,
		connection: callback.headers.get("connection"),
		referrerPolicy: callback.headers.get("referrer-policy"),
		accessToken: (await tokens).accessToken,
		closed: await refused(port),
	};
}

// SEC-C14: timeout and abort reject and free the port; a kept-alive connection is destroyed.
{
	const server = await discover(config, issuer);
	const timed = await createAuthorizationSession(server);
	const timeout = await timed.wait(async () => "x", { timeoutMs: 100 }).catch(failure);
	const aborted = await createAuthorizationSession(server);
	const socket = connect(Number(new URL(aborted.redirectUri).port), "127.0.0.1");
	socket.on("error", () => {});
	await once(socket, "connect");
	socket.write(`GET /callback HTTP/1.1\r\nHost: ${new URL(aborted.redirectUri).host}\r\n`);
	const socketClosed = new Promise((resolve) => socket.once("close", () => resolve(true)));
	const controller = new AbortController();
	const pending = aborted.wait(async () => "x", { signal: controller.signal }).catch(failure);
	controller.abort();
	report.close = {
		timeout,
		timeoutClosed: await refused(Number(new URL(timed.redirectUri).port)),
		abort: await pending,
		abortClosed: await refused(Number(new URL(aborted.redirectUri).port)),
		keepAliveDestroyed: await Promise.race([socketClosed, new Promise((resolve) => setTimeout(() => resolve(false), 2_000))]),
	};
}

// SEC-C15: an idle connection that sends nothing is closed.
{
	const listener = await listenLoopback(["127.0.0.1"], [0], "/callback", () => {}, 300);
	const socket = connect(listener.port, "127.0.0.1");
	socket.on("error", () => {});
	await once(socket, "connect");
	const started = Date.now();
	const closed = await Promise.race([
		new Promise((resolve) => socket.once("close", () => resolve(true))),
		new Promise((resolve) => setTimeout(() => resolve(false), 5_000)),
	]);
	listener.close();
	report.idle = { closed, ms: Date.now() - started };
}

// SEC-E6: a redirected metadata or token response is an error, and its target gets nothing.
{
	const moved = await discover(config, `${issuer}/moved`).catch(failure);
	const server = await discover(config, `${issuer}/redirecting`);
	const client = createTokenClient(server);
	const refresh = await client.refresh("RT").catch(failure);
	report.redirect = { moved, refresh, offsiteRequests: offsiteRequests.length };
}

// Device login: authorization_pending, then slow_down, then success. Only the polling waits
// (5 s, and 10 s after slow_down) run 1000x faster and are recorded; the request and expiry
// timers, and the runtime's own, keep their length.
{
	const realSetTimeout = globalThis.setTimeout;
	const pollWaits: number[] = [];
	globalThis.setTimeout = ((handler: () => void, ms?: number, ...args: unknown[]) => {
		if (ms !== 5_000 && ms !== 10_000) return realSetTimeout(handler, ms, ...args);
		pollWaits.push(ms);
		return realSetTimeout(handler, ms / 1000, ...args);
	}) as typeof setTimeout;
	try {
		const server = await discover(config, issuer);
		const flow = await startDeviceFlow(server);
		const tokens = await flow.poll();
		report.device = { userCode: flow.userCode, accessToken: tokens.accessToken, polls: devicePolls.length, pollWaits };
	} finally {
		globalThis.setTimeout = realSetTimeout;
	}
}

as.close();
as.closeAllConnections();
offsite.close();
offsite.closeAllConnections();
process.stdout.write(`${JSON.stringify(report)}\n`);
