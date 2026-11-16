import { openBrowser } from "./browser.ts";
import { defineServers } from "./config.ts";
import { startDeviceFlow } from "./device.ts";
import { discover, serverInternals } from "./discovery.ts";
import { deviceCodeMessage } from "./display.ts";
import { LoginRequiresInteractionError, OAuthConfigError } from "./errors.ts";
import { detectLoginMode } from "./login-mode.ts";
import { checkScope } from "./params.ts";
import { checkLoopbackOptions, createAuthorizationSession } from "./session.ts";
import { createTokenClient } from "./token-client.ts";
import type { AuthClient, DefineAuthOptions, LoginOptions, TokenSet } from "./types.ts";

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
 * Validates the server your CLI signs in with and returns a frozen client. Does no I/O:
 * the server is discovered on the first login.
 */
export function defineAuth(options: DefineAuthOptions): AuthClient {
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
			await onCode({
				userCode,
				verificationUri,
				verificationUriComplete,
				expiresAt,
				message: deviceCodeMessage({ app: name, userCode, verificationUri }),
			});
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
			await onUrl({
				url,
				async open() {
					await openBrowser(url, { allowInsecureLoopbackOrigin });
				},
			});
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
