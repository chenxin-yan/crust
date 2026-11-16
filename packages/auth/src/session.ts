import type { IncomingMessage, ServerResponse } from "node:http";

import { serverInternals } from "./discovery.ts";
import { AUTHORIZATION_PARAMS } from "./endpoint.ts";
import {
	AbortError,
	IssuerMismatchError,
	OAuthConfigError,
	OAuthError,
	oauthErrorCode,
	TimeoutError,
} from "./errors.ts";
import { linkSignal, throwIfAborted } from "./http.ts";
import { type LoopbackListener, listenLoopback } from "./loopback.ts";
import { checkResources, checkScope } from "./params.ts";
import { createPkce, randomState } from "./pkce.ts";
import type {
	AuthorizationSession,
	AuthorizationSessionOptions,
	AuthServer,
	CallbackPageView,
	WaitOptions,
} from "./types.ts";

/** Browser callback wait. */
export const DEFAULT_WAIT_MS = 300_000;

/** Session values kept off the frozen public object: the verifier is a secret. */
export interface SessionInternals {
	readonly verifier: string;
	readonly resource: readonly string[];
	exchanged: boolean;
}

const sessions = new WeakMap<AuthorizationSession, SessionInternals>();

/** The internals of a session from `createAuthorizationSession()`; anything else is refused. */
export function sessionInternals(session: AuthorizationSession): SessionInternals {
	const internals = sessions.get(session);
	if (!internals) {
		throw new OAuthConfigError(
			"unknown-server",
			"Pass a session returned by createAuthorizationSession()",
		);
	}
	return internals;
}

// The library owns these headers on every response, custom pages included.
const RESPONSE_HEADERS = {
	"content-type": "text/html; charset=utf-8",
	"cache-control": "no-store",
	"referrer-policy": "no-referrer",
	"x-content-type-options": "nosniff",
	"content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
	connection: "close",
};

function respond(response: ServerResponse, status: number, body: string): Promise<void> {
	return new Promise((resolve) => {
		// The browser may have left already (a closed tab): its 'close' event has fired.
		if (response.destroyed || response.writableEnded) {
			resolve();
			return;
		}
		response.once("close", resolve);
		response.once("finish", resolve);
		response.writeHead(status, RESPONSE_HEADERS).end(body);
	});
}

function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** The built-in result page: no links, no remote resources, no server text. */
function defaultPage(view: CallbackPageView): string {
	const [heading, detail] =
		view.outcome === "success"
			? ["Signed in", "You can close this tab and return to the terminal."]
			: [
					"Sign-in failed",
					`Return to the terminal for details.${view.errorCode ? ` (${escapeHtml(view.errorCode)})` : ""}`,
				];
	return `<!doctype html><html><head><meta charset="utf-8"><title>${heading}</title><style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;text-align:center}</style></head><body><h1>${heading}</h1><p>${detail}</p></body></html>`;
}

function renderPage(view: CallbackPageView, page: WaitOptions["page"]): string {
	if (page) {
		try {
			const html = page(view);
			if (typeof html === "string") return html;
		} catch {
			// A throwing renderer gets the default page; wait() still settles with the flow's outcome.
		}
	}
	return defaultPage(view);
}

function checkLoopbackOptions(options: AuthorizationSessionOptions) {
	const hosts = options.hosts ?? ["127.0.0.1"];
	const ports = options.ports ?? [0];
	if (
		!Array.isArray(hosts) ||
		hosts.length === 0 ||
		new Set(hosts).size !== hosts.length ||
		!hosts.every((host) => host === "127.0.0.1" || host === "::1")
	) {
		throw new OAuthConfigError("invalid-option", 'hosts must list "127.0.0.1" and/or "::1"');
	}
	if (
		!Array.isArray(ports) ||
		ports.length === 0 ||
		!ports.every((port) => Number.isInteger(port) && port >= 0 && port <= 65535)
	) {
		throw new OAuthConfigError("invalid-option", "ports must list integers from 0 to 65535");
	}
	return { hosts, ports };
}

function checkExtra(extra: unknown, endpoint: URL): [string, string][] {
	if (extra === undefined) return [];
	if (typeof extra !== "object" || extra === null || Array.isArray(extra)) {
		throw new OAuthConfigError("invalid-option", "extra must be an object of strings");
	}
	const endpointNames = new Set(endpoint.searchParams.keys());
	return Object.entries(extra).map(([name, value]) => {
		if (name === "" || typeof value !== "string") {
			throw new OAuthConfigError("invalid-option", "extra must map non-empty names to strings");
		}
		if (AUTHORIZATION_PARAMS.has(name)) {
			throw new OAuthConfigError(
				"reserved-parameter",
				`extra must not set the "${name}" parameter`,
			);
		}
		if (endpointNames.has(name)) {
			throw new OAuthConfigError(
				"duplicate-parameter",
				`extra repeats the "${name}" parameter of the authorization endpoint`,
			);
		}
		return [name, value];
	});
}

/** A state-matched callback waiting for `wait()`. */
interface Callback {
	params: URLSearchParams;
	response: ServerResponse;
}

/**
 * Starts a browser login: checks the mix-up policy and every parameter, then
 * binds a loopback listener on the server's redirect path and freezes the issuer, client id,
 * redirect URI, `state`, PKCE pair and authorization URL in one session. A refusal binds no
 * socket; a failure after binding closes it.
 */
export async function createAuthorizationSession(
	server: AuthServer,
	options: AuthorizationSessionOptions = {},
): Promise<AuthorizationSession> {
	throwIfAborted(options.signal);
	serverInternals(server);
	if (server.authorizationEndpoint === undefined) {
		throw new OAuthConfigError("unsupported", "The server has no authorization endpoint");
	}
	if (server.issPolicy === "unprotected") {
		throw new OAuthConfigError(
			"mix-up-unprotected",
			"With several servers, this one must send iss or have its own redirectPath",
		);
	}
	const { hosts, ports } = checkLoopbackOptions(options);
	const scope = checkScope(options.scope);
	const resource = checkResources(options.resource);
	const endpoint = new URL(server.authorizationEndpoint);
	const extra = checkExtra(options.extra, endpoint);
	const pkce = await createPkce();
	const state = randomState();

	let allowedHosts: readonly string[] = [];
	let consumed = false;
	let deliver!: (callback: Callback) => void;
	const arrival = new Promise<Callback>((resolve) => {
		deliver = resolve;
	});

	// Exact raw-target match before any parsing, Host check, then the state filter: a stray
	// or forged request never consumes the one-shot slot.
	const onRequest = (request: IncomingMessage, response: ServerResponse) => {
		const target = request.url ?? "";
		const query = target.indexOf("?");
		if (
			request.method !== "GET" ||
			(query === -1 ? target : target.slice(0, query)) !== server.redirectPath
		) {
			void respond(response, 404, "Not found");
			return;
		}
		if (!allowedHosts.includes(request.headers.host ?? "")) {
			void respond(response, 421, "Misdirected request");
			return;
		}
		if (consumed) {
			void respond(response, 400, "This sign-in link was already used");
			return;
		}
		const params = new URL(target, "http://127.0.0.1").searchParams;
		const repeated = ["code", "state", "error", "iss"].some(
			(name) => params.getAll(name).length > 1,
		);
		if (repeated || (params.has("code") && params.has("error")) || params.get("state") !== state) {
			void respond(response, 400, "Bad request");
			return;
		}
		consumed = true;
		// The browser waits on this connection while onCallback runs; wait()'s deadline bounds it.
		request.socket.setTimeout(0);
		deliver({ params, response });
	};

	const listener: LoopbackListener = await listenLoopback(
		hosts,
		ports,
		server.redirectPath,
		onRequest,
	);
	// The listener must serve exactly the declared path, or the mix-up path defense does not hold.
	if (listener.path !== server.redirectPath || options.signal?.aborted) {
		listener.close();
		if (options.signal?.aborted) throw new AbortError();
		throw new OAuthConfigError(
			"mix-up-unprotected",
			"The listener path differs from the declared redirectPath",
		);
	}
	const literal = listener.host === "::1" ? "[::1]" : "127.0.0.1";
	const hostHeader = `${literal}:${listener.port}`;
	// Browsers omit the default port from Host, so only port 80 also accepts the bare literal.
	allowedHosts = listener.port === 80 ? [hostHeader, literal] : [hostHeader];
	const redirectUri = `http://${hostHeader}${server.redirectPath}`;

	// The endpoint's own query is kept byte for byte; the library's parameters follow it.
	const authorizationParams = new URLSearchParams({
		response_type: "code",
		client_id: server.clientId,
		redirect_uri: redirectUri,
		state,
		code_challenge: pkce.challenge,
		code_challenge_method: pkce.method,
	});
	if (scope !== undefined) authorizationParams.append("scope", scope);
	for (const value of resource) authorizationParams.append("resource", value);
	for (const [name, value] of extra) authorizationParams.append(name, value);
	const base = server.authorizationEndpoint;
	// A trailing `?` or `&` is reused only inside an existing query.
	const separator = !base.includes("?") ? "?" : /[?&]$/.test(base) ? "" : "&";
	const url = `${base}${separator}${authorizationParams.toString()}`;

	const closer = new AbortController();
	let waited = false;
	const close = () => {
		closer.abort();
		listener.close();
	};

	async function wait<T>(
		onCallback: (callback: { code: string }) => Promise<T>,
		{ timeoutMs = DEFAULT_WAIT_MS, signal, page }: WaitOptions = {},
	): Promise<T> {
		if (waited) throw new OAuthConfigError("already-used", "wait() can be called once per session");
		waited = true;
		const link = linkSignal(
			AbortSignal.any(signal ? [signal, closer.signal] : [closer.signal]),
			timeoutMs,
			() => new TimeoutError("The browser login timed out"),
		);
		// The deadline, the signal and close() bound the whole wait, onCallback included; a
		// callback still running when they fire is left to finish unobserved.
		const stopped = new Promise<never>((_, reject) => {
			if (link.signal.aborted) reject(link.signal.reason);
			link.signal.addEventListener("abort", () => reject(link.signal.reason), { once: true });
		});
		// Observed by the race below, or unused when the wait was cancelled before it began.
		stopped.catch(() => {});
		const handle = async (): Promise<T> => {
			const { params, response } = await arrival;
			// A callback queued before wait() never starts once the wait is cancelled or closed.
			if (link.signal.aborted) throw link.signal.reason;
			let outcome: { ok: true; value: T } | { ok: false; error: unknown };
			try {
				// The issuer is checked before error or code is acted on.
				const iss = params.get("iss");
				if (iss !== null ? iss !== server.issuer : server.issPolicy === "required") {
					throw new IssuerMismatchError(iss === null ? "missing" : "mismatch");
				}
				const error = params.get("error");
				if (error !== null) throw new OAuthError(oauthErrorCode(error));
				const code = params.get("code");
				if (!code) throw new OAuthError("invalid_response");
				outcome = { ok: true, value: await onCallback({ code }) };
			} catch (error) {
				outcome = { ok: false, error };
			}
			const view: CallbackPageView = outcome.ok
				? { outcome: "success" }
				: outcome.error instanceof OAuthError
					? { outcome: "failure", errorCode: outcome.error.code }
					: { outcome: "failure" };
			if (!link.signal.aborted)
				await respond(response, outcome.ok ? 200 : 400, renderPage(view, page));
			if (!outcome.ok) throw outcome.error;
			return outcome.value;
		};
		try {
			if (link.signal.aborted) throw link.signal.reason;
			return await Promise.race([handle(), stopped]);
		} finally {
			link.clear();
			close();
		}
	}

	const session: AuthorizationSession = Object.freeze({
		issuer: server.issuer,
		clientId: server.clientId,
		redirectUri,
		url,
		state,
		server,
		wait,
		close,
	});
	sessions.set(session, { verifier: pkce.verifier, resource, exchanged: false });
	return session;
}
