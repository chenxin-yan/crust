import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { OAuthConfigError } from "./errors.ts";

/** Slow-loris bound for the loopback receiver. */
export const LOOPBACK_IDLE_TIMEOUT_MS = 10_000;

/** A bound loopback listener. */
export interface LoopbackListener {
	readonly server: Server;
	readonly host: "127.0.0.1" | "::1";
	readonly port: number;
	/** The only path the listener serves. */
	readonly path: string;
	/** Closes the server and destroys every open connection. */
	close(): void;
}

function bind(server: Server, host: string, port: number): Promise<void> {
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		// No reusePort or exclusive-mode tweaks: the OS default refuses a second bind.
		server.listen({ host, port }, () => {
			server.off("error", reject);
			resolve();
		});
	});
}

/**
 * Binds the first loopback literal and port that work: hosts in order, ports in order within
 * each host. Never a wildcard or `localhost`.
 */
export async function listenLoopback(
	hosts: readonly ("127.0.0.1" | "::1")[],
	ports: readonly number[],
	path: string,
	onRequest: (request: IncomingMessage, response: ServerResponse) => void,
	idleTimeoutMs: number = LOOPBACK_IDLE_TIMEOUT_MS,
): Promise<LoopbackListener> {
	for (const host of hosts) {
		for (const port of ports) {
			const server = createServer(
				{ requestTimeout: idleTimeoutMs, headersTimeout: idleTimeoutMs, maxHeaderSize: 4096 },
				onRequest,
			);
			server.maxHeadersCount = 32;
			// A connection that goes quiet is destroyed, including one that never sends a byte.
			server.on("connection", (socket) => socket.setTimeout(idleTimeoutMs, () => socket.destroy()));
			try {
				await bind(server, host, port);
			} catch {
				server.close();
				continue;
			}
			server.on("error", () => {});
			const close = () => {
				server.close();
				server.closeAllConnections();
			};
			return Object.freeze({
				server,
				host,
				port: (server.address() as AddressInfo).port,
				path,
				close,
			});
		}
	}
	throw new OAuthConfigError(
		"loopback-unavailable",
		"Could not listen on a loopback address for the browser callback; use the device login instead",
	);
}
