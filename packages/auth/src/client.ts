import { openBrowser } from "./browser.ts";
import { defineServers } from "./config.ts";
import { startDeviceFlow } from "./device.ts";
import { discover, serverInternals } from "./discovery.ts";
import { deviceCodeMessage } from "./display.ts";
import { AbortError, LoginRequiresInteractionError, OAuthConfigError } from "./errors.ts";
import { detectLoginMode } from "./login-mode.ts";
import { checkScope } from "./params.ts";
import { checkLoopbackOptions, createAuthorizationSession } from "./session.ts";
import { createTokenClient } from "./token-client.ts";
import type { AuthClient, CreateAuthOptions, LoginOptions, TokenSet } from "./types.ts";

function checkName(value: unknown, field: "app" | "name"): string {
	// `app` names a directory later, so it follows the store's rule for an app name.
	if (
		typeof value !== "string" ||
		value.trim() === "" ||
		(field === "app" && /[/\\]/.test(value))
	) {
		throw new OAuthConfigError(
			"invalid-option",
			field === "app"
				? "app must be a non-empty name without path separators"
				: "name must be a non-empty string",
		);
	}
	return value;
}

/**
 * The result of an app callback, or `AbortError` as soon as `signal` aborts: a prompt nobody
 * answers must not hold the login (and its listener) open. A later result is ignored.
 */
function unlessAborted<T>(result: T | Promise<T>, signal: AbortSignal | undefined): Promise<T> {
	if (!signal) return Promise.resolve(result);
	return new Promise<T>((resolve, reject) => {
		const abort = () => reject(new AbortError());
		// Observed on every path: a callback that aborts the login and rejects later must not
		// leave an unhandled rejection.
		const settled = Promise.resolve(result).then(resolve, reject);
		if (signal.aborted) {
			abort();
			return;
		}
		signal.addEventListener("abort", abort, { once: true });
		void settled.finally(() => signal.removeEventListener("abort", abort));
	});
}

/**
 * Validates the server your CLI signs in with and returns a frozen client. Does no I/O:
 * the server is discovered on the first login.
 */
export function createAuth(options: CreateAuthOptions): AuthClient {
	const app = checkName(options?.app, "app");
	const name = checkName(options.name ?? app, "name");
	const { issuer, scope, hosts, ports, fetch } = options;
	const config = defineServers({
		servers: [
			{
				issuer,
				clientId: options.clientId,
				clientSecret: options.clientSecret,
				redirectPath: options.redirectPath,
				allowInsecureLoopback: options.allowInsecureLoopback,
			},
		],
	});
	checkScope(scope);
	checkLoopbackOptions({ hosts, ports });

	async function login({
		device,
		signal,
		scope: loginScope = scope,
		onUrl,
		onCode,
		page,
	}: LoginOptions): Promise<TokenSet> {
		const mode = detectLoginMode({ device });
		if (mode === "refuse") {
			throw new LoginRequiresInteractionError(
				`Signing in to ${name} needs a person at a terminal. Use the device login to sign in with a code instead.`,
			);
		}
		const server = await discover(config, issuer, { signal, fetch });
		if (mode === "device") {
			const flow = await startDeviceFlow(server, { scope: loginScope, signal, fetch });
			const { userCode, verificationUri, verificationUriComplete, expiresAt } = flow;
			await unlessAborted(
				onCode({
					userCode,
					verificationUri,
					verificationUriComplete,
					expiresAt,
					message: deviceCodeMessage({ app: name, userCode, verificationUri }),
				}),
				signal,
			);
			return flow.poll({ signal });
		}
		const client = createTokenClient(server, { fetch });
		const session = await createAuthorizationSession(server, {
			hosts,
			ports,
			scope: loginScope,
			signal,
		});
		try {
			const url = session.url;
			const allowInsecureLoopbackOrigin = serverInternals(server).devOrigin;
			await unlessAborted(
				onUrl({ url, open: () => openBrowser(url, { allowInsecureLoopbackOrigin }) }),
				signal,
			);
			return await session.wait(({ code }) => client.exchangeCode(session, code, { signal }), {
				signal,
				page,
			});
		} finally {
			session.close();
		}
	}

	return Object.freeze({ login });
}
