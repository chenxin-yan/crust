import { serverInternals } from "./discovery.ts";
import { sanitizeDisplay } from "./display.ts";
import { checkUrl } from "./endpoint.ts";
import { AbortError, NetworkError, OAuthConfigError, OAuthError, TimeoutError } from "./errors.ts";
import { jsonObject, linkSignal, oauthFailure, throwIfAborted } from "./http.ts";
import { checkResources, checkScope } from "./params.ts";
import { parseTokenResponse, postForm } from "./token-client.ts";
import type { AuthServer, DeviceFlow, DeviceFlowOptions, TokenSet } from "./types.ts";

const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
/** Floor and default polling interval, RFC 8628 §3.2 (SEC-D1, D6). */
const MIN_INTERVAL_S = 5;
/** Upper bound for `interval` and `expires_in`; keeps every timer below setTimeout's limit (SEC-D6). */
const MAX_DEVICE_SECONDS = 86_400;

class DeadlineError extends Error {}

function seconds(value: unknown, positive: boolean): number | undefined {
	return typeof value === "number" &&
		Number.isFinite(value) &&
		(positive ? value > 0 : value >= 0) &&
		value <= MAX_DEVICE_SECONDS
		? value
		: undefined;
}

/** Sleeps `ms`; rejects at once on `signal` (SEC-D5). */
function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new AbortError());
			return;
		}
		const onAbort = () => {
			clearTimeout(timer);
			reject(new AbortError());
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

/**
 * Starts a device login (RFC 8628; SEC-D1–D11). Validates the server's response before
 * anything is shown; the device code stays private. Show `userCode` and `verificationUri`
 * (`deviceCodeMessage()`), then call `poll()`.
 */
export async function startDeviceFlow(
	server: AuthServer,
	options: DeviceFlowOptions = {},
): Promise<DeviceFlow> {
	throwIfAborted(options.signal);
	const { devOrigin } = serverInternals(server);
	const endpoint = server.deviceAuthorizationEndpoint;
	if (
		endpoint === undefined ||
		(server.grantTypesSupported && !server.grantTypesSupported.includes(DEVICE_GRANT))
	) {
		throw new OAuthConfigError("unsupported", "The server does not offer the device login");
	}
	const scope = checkScope(options.scope);
	const resource = checkResources(options.resource);
	const fetchImpl = options.fetch ?? fetch;

	const body = new URLSearchParams();
	if (scope !== undefined) body.set("scope", scope);
	for (const value of resource) body.append("resource", value);
	const requestStart = Date.now();
	const response = await postForm(server, fetchImpl, endpoint, body, { signal: options.signal });
	if (response.status !== 200) throw oauthFailure(response);
	const fields = jsonObject(response.body);
	const deviceCode = fields?.device_code;
	const userCode = typeof fields?.user_code === "string" ? sanitizeDisplay(fields.user_code) : "";
	const expiresIn = seconds(fields?.expires_in, true);
	const interval =
		fields?.interval === undefined ? MIN_INTERVAL_S : seconds(fields.interval, false);
	if (
		typeof deviceCode !== "string" ||
		deviceCode === "" ||
		userCode === "" ||
		expiresIn === undefined ||
		interval === undefined
	) {
		throw new OAuthError("invalid_response", response.status);
	}
	const verificationUri = checkUrl(fields?.verification_uri, "verification_uri", devOrigin);
	const verificationUriComplete =
		fields?.verification_uri_complete === undefined
			? undefined
			: checkUrl(fields.verification_uri_complete, "verification_uri_complete", devOrigin);
	const expiresAt = requestStart + expiresIn * 1000;

	let polling = false;
	async function poll({ signal }: { signal?: AbortSignal } = {}): Promise<TokenSet> {
		throwIfAborted(signal);
		if (polling)
			throw new OAuthConfigError("already-used", "poll() can be called once per device login");
		polling = true;
		// The code's expiry also aborts a sleep or a request in flight (SEC-D4).
		const deadline = linkSignal(
			signal,
			Math.max(0, expiresAt - Date.now()),
			() => new DeadlineError(),
		);
		let intervalS = Math.max(interval as number, MIN_INTERVAL_S);
		let failures = 0;
		try {
			for (;;) {
				// Network failures double the wait; it never drops below the interval (SEC-D3, D6).
				const waitMs = intervalS * 1000 * 2 ** failures;
				const remainingMs = expiresAt - Date.now();
				// No poll whose wait would end at or after the deadline: expire instead (SEC-D4, D6).
				if (waitMs >= remainingMs) {
					await sleep(Math.max(0, remainingMs), signal);
					throw new OAuthError("expired_token");
				}
				await sleep(waitMs, deadline.signal);
				const pollBody = new URLSearchParams({
					grant_type: DEVICE_GRANT,
					device_code: deviceCode as string,
				});
				for (const value of resource) pollBody.append("resource", value);
				const pollStart = Date.now();
				let result;
				try {
					result = await postForm(server, fetchImpl, server.tokenEndpoint, pollBody, {
						signal: deadline.signal,
					});
				} catch (error) {
					// A connection error or request timeout backs off; anything else stops.
					if (!(error instanceof NetworkError || error instanceof TimeoutError)) {
						throw error;
					}
					failures += 1;
					continue;
				}
				failures = 0;
				const code = jsonObject(result.body)?.error;
				if (result.status !== 200 && code === "authorization_pending") continue;
				if (result.status !== 200 && code === "slow_down") {
					intervalS += 5;
					continue;
				}
				// Any other error stops polling (SEC-D2).
				return parseTokenResponse(result, pollStart);
			}
		} catch (error) {
			if (
				error instanceof DeadlineError ||
				(deadline.signal.reason instanceof DeadlineError && !signal?.aborted)
			) {
				throw new OAuthError("expired_token");
			}
			throw error;
		} finally {
			deadline.clear();
		}
	}

	return Object.freeze({ userCode, verificationUri, verificationUriComplete, expiresAt, poll });
}
