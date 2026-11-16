// Test doubles: a scripted authorization server behind an injected fetch, raw loopback
// requests (fetch() would normalize the paths these tests send), and unique issuers so the
// process-wide metadata cache never leaks between tests.
import { request } from "node:http";

import { expect, vi } from "vite-plus/test";

import { defineServers } from "../src/config.ts";
import { discover } from "../src/discovery.ts";
import { OAuthConfigError } from "../src/errors.ts";
import type { Fetch } from "../src/http.ts";
import type { AuthServer, AuthServerOptions } from "../src/types.ts";

let counter = 0;

/** A fresh https issuer the metadata cache has never seen. */
export function uniqueIssuer(path = ""): string {
	counter += 1;
	return `https://as-${counter}-${process.pid}.example${path}`;
}

export interface RecordedRequest {
	url: string;
	method: string;
	headers: Headers;
	body: URLSearchParams;
}

type Handler = (request: RecordedRequest) => Response | Promise<Response>;

/** A JSON response. */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});
}

/**
 * A fetch that answers from `routes`, keyed by origin + path (the query is kept in the
 * recorded URL). Unrouted URLs answer 404. A pending handler rejects on the request's signal.
 */
export function fakeFetch(routes: Record<string, Handler>): {
	fetch: Fetch;
	requests: RecordedRequest[];
} {
	const requests: RecordedRequest[] = [];
	const fetchImpl: Fetch = (url, init) => {
		const recorded: RecordedRequest = {
			url,
			method: init.method ?? "GET",
			headers: new Headers(init.headers),
			body: new URLSearchParams(init.body instanceof URLSearchParams ? init.body : ""),
		};
		requests.push(recorded);
		const { origin, pathname } = new URL(url);
		const handler =
			routes[`${origin}${pathname}`] ?? (() => new Response("not found", { status: 404 }));
		return new Promise((resolve, reject) => {
			const signal = init.signal;
			if (signal?.aborted) {
				reject(signal.reason);
				return;
			}
			signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
			Promise.resolve()
				.then(() => handler(recorded))
				.then(resolve, reject);
		});
	};
	return { fetch: fetchImpl, requests };
}

/** RFC 8414 metadata for `issuer`, endpoints on the issuer's origin. */
export function metadataFor(
	issuer: string,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	const origin = new URL(issuer).origin;
	return {
		issuer,
		authorization_endpoint: `${origin}/authorize`,
		token_endpoint: `${origin}/token`,
		device_authorization_endpoint: `${origin}/device`,
		revocation_endpoint: `${origin}/revoke`,
		code_challenge_methods_supported: ["S256"],
		...overrides,
	};
}

/** The RFC 8414 well-known URL of an issuer without a path. */
export function wellKnown(issuer: string): string {
	return `${new URL(issuer).origin}/.well-known/oauth-authorization-server`;
}

/**
 * A discovered server for a fresh issuer, backed by `routes` (metadata is added). `extra`
 * servers make the config multi-server.
 */
export async function setupServer(
	options: {
		metadata?: Record<string, unknown>;
		routes?: Record<string, Handler>;
		server?: Partial<AuthServerOptions>;
		others?: AuthServerOptions[];
		allowCustomIssuers?: boolean;
	} = {},
): Promise<{ server: AuthServer; fetch: Fetch; requests: RecordedRequest[]; issuer: string }> {
	const issuer = options.server?.issuer ?? uniqueIssuer();
	const fake = fakeFetch({
		[wellKnown(issuer)]: () => json(metadataFor(issuer, options.metadata)),
		...options.routes,
	});
	const config = defineServers({
		servers: [{ issuer, clientId: "cli", ...options.server }, ...(options.others ?? [])],
		allowCustomIssuers: options.allowCustomIssuers,
	});
	const server = await discover(config, issuer, { fetch: fake.fetch });
	return { server, fetch: fake.fetch, requests: fake.requests, issuer };
}

export interface RawResponse {
	status: number;
	headers: Record<string, string | string[] | undefined>;
	body: string;
}

/** Sends one raw HTTP request to a loopback listener; `path` is sent byte for byte. */
export function rawRequest(
	redirectUri: string,
	path: string,
	options: { method?: string; host?: string } = {},
): Promise<RawResponse> {
	const url = new URL(redirectUri);
	return new Promise((resolve, reject) => {
		const req = request(
			{
				host: url.hostname.replace(/^\[|\]$/g, ""),
				port: url.port,
				method: options.method ?? "GET",
				path,
				headers: { host: options.host ?? url.host },
				agent: false,
			},
			(response) => {
				let body = "";
				response.setEncoding("utf8");
				response.on("data", (chunk: string) => {
					body += chunk;
				});
				response.on("end", () =>
					resolve({ status: response.statusCode ?? 0, headers: response.headers, body }),
				);
			},
		);
		req.on("error", reject);
		req.end();
	});
}

/** The redirect URI's path plus `query`. */
export function callbackPath(redirectUri: string, query: Record<string, string>): string {
	return `${new URL(redirectUri).pathname}?${new URLSearchParams(query).toString()}`;
}

/** Whether a TCP connect to the listener of `redirectUri` is refused. */
export async function isClosed(redirectUri: string): Promise<boolean> {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		try {
			await rawRequest(redirectUri, "/");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ECONNREFUSED") return true;
		}
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	return false;
}

/** The reason of the {@link OAuthConfigError} `promise` rejects with. */
export async function configReason(promise: Promise<unknown>): Promise<string> {
	const error = await promise.then(
		() => undefined,
		(caught: unknown) => caught,
	);
	expect(error).toBeInstanceOf(OAuthConfigError);
	return (error as OAuthConfigError).reason;
}

// detectLoginMode() reads the environment and the standard streams; tests set both.
const streams = [process.stdin, process.stdout, process.stderr];
const ttyDescriptors = streams.map((stream) => Object.getOwnPropertyDescriptor(stream, "isTTY"));

/** Makes the process look like a desktop terminal (`tty`), or not, and on CI or not. */
export function terminal(options: { tty: boolean; ci?: boolean }): void {
	vi.stubEnv("CI", options.ci ? "true" : undefined);
	vi.stubEnv("DISPLAY", ":0");
	for (const name of ["SSH_CONNECTION", "SSH_CLIENT", "SSH_TTY"]) vi.stubEnv(name, undefined);
	for (const stream of streams) {
		Object.defineProperty(stream, "isTTY", {
			value: options.tty,
			configurable: true,
			writable: true,
		});
	}
}

/** Undoes {@link terminal}. */
export function restoreTerminal(): void {
	vi.unstubAllEnvs();
	streams.forEach((stream, index) => {
		const descriptor = ttyDescriptors[index];
		if (descriptor) Object.defineProperty(stream, "isTTY", descriptor);
		else delete (stream as { isTTY?: boolean }).isTTY;
	});
}
