import { openBrowser } from "./browser.ts";
import { defineServers } from "./config.ts";
import { credentialStore } from "./credentials.ts";
import { startDeviceFlow } from "./device.ts";
import { discover, serverInternals } from "./discovery.ts";
import { deviceCodeMessage } from "./display.ts";
import {
	AbortError,
	LoginRequiredError,
	LoginRequiresInteractionError,
	OAuthConfigError,
} from "./errors.ts";
import { throwIfAborted } from "./http.ts";
import { detectLoginMode } from "./login-mode.ts";
import { checkResources, checkScope } from "./params.ts";
import { fromEnv, fromStore } from "./resolve.ts";
import { checkLoopbackOptions, createAuthorizationSession } from "./session.ts";
import { createTokenClient, redacted } from "./token-client.ts";
import { createTokenSource, tokenSourceInternals } from "./token-source.ts";
import type {
	AuthClient,
	AuthServer,
	AuthStatus,
	AuthToken,
	CreateAuthOptions,
	LoginOptions,
	SourceValue,
	TokenSet,
} from "./types.ts";

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
 * the server is discovered on the first login, and the login file read on first use.
 */
export function createAuth(options: CreateAuthOptions): AuthClient {
	const app = checkName(options?.app, "app");
	const name = checkName(options.name ?? app, "name");
	const { issuer, scope, hosts, ports, fetch, env } = options;
	if (env !== undefined && (typeof env !== "string" || env.trim() === "")) {
		throw new OAuthConfigError("invalid-option", "env must name an environment variable");
	}
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
	const resource = checkResources(options.resource);
	checkLoopbackOptions({ hosts, ports });
	const source = createTokenSource({
		config,
		identity: { issuer, clientId: options.clientId, apiOrigins: options.apiOrigins },
		store: credentialStore({ app }),
		fetch,
	});
	const stored = fromStore(source);

	/** The `env` variable's trimmed value, when it is set and not blank. */
	async function envValue(): Promise<string | undefined> {
		return env === undefined ? undefined : (await fromEnv(env).resolve({}))?.value;
	}

	async function login(loginOptions: LoginOptions): Promise<void> {
		const mode = detectLoginMode({ device: loginOptions.device });
		if (mode === "refuse") {
			throw new LoginRequiresInteractionError(
				`Signing in to ${name} needs a person at a terminal. Use the device login to sign in with a code instead${env === undefined ? "" : `, or set ${env} to a token`}.`,
			);
		}
		const { signal } = loginOptions;
		const server = await discover(config, issuer, { signal, fetch });
		// Opened before the flow, so a logout while it runs makes the commit fail, not undo it.
		const ticket = await source.beginLogin({ signal });
		try {
			await ticket.commit(await signIn(server, mode, loginOptions), { signal });
		} finally {
			ticket.cancel();
		}
	}

	async function signIn(
		server: AuthServer,
		mode: "browser" | "device",
		{ signal, scope: loginScope = scope, onUrl, onCode, page }: LoginOptions,
	): Promise<TokenSet> {
		if (mode === "device") {
			const flow = await startDeviceFlow(server, { scope: loginScope, resource, signal, fetch });
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
			resource,
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

	const loginToken = (value: SourceValue): AuthToken =>
		redacted(
			{
				value: value.value,
				source: "login" as const,
				refresh: async (refreshOptions: { signal?: AbortSignal }) =>
					loginToken(await value.refresh!(refreshOptions)),
			},
			["value"],
		);

	async function token({
		signal,
		baseUrl,
	}: { signal?: AbortSignal; baseUrl?: string } = {}): Promise<AuthToken> {
		throwIfAborted(signal);
		const value = await envValue();
		if (value !== undefined) return redacted({ value, source: "env" as const }, ["value"]);
		const found = await stored.resolve({ signal, baseUrl });
		if (!found) throw new LoginRequiredError("missing");
		return loginToken(found);
	}

	async function status(): Promise<AuthStatus> {
		if ((await envValue()) !== undefined) return { source: "env" };
		try {
			const { expiresAt, scope: granted } = await tokenSourceInternals(source).storedLogin();
			return { source: "login", expiresAt, scope: granted };
		} catch (error) {
			if (error instanceof LoginRequiredError && error.reason === "missing") {
				return { source: "none" };
			}
			throw error;
		}
	}

	const logout = (logoutOptions?: { signal?: AbortSignal }) => source.logout(logoutOptions);

	return Object.freeze({ login, token, status, logout });
}
