import { openBrowser } from "./browser.ts";
import { defineServers } from "./config.ts";
import {
	credentialStore,
	credentialStoreInternals,
	type CredentialsDocument,
	isProfileName,
	parseRecord,
	recordKey,
	serverKey,
} from "./credentials.ts";
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
import { checkLoopbackOptions, createAuthorizationSession } from "./session.ts";
import { createTokenClient, redacted } from "./token-client.ts";
import { createTokenSource, tokenSourceInternals } from "./token-source.ts";
import type {
	AccessToken,
	AuthClient,
	AuthProfile,
	AuthServer,
	AuthStatus,
	AuthToken,
	CreateAuthOptions,
	LoginOptions,
	ProfileAuthClient,
	ProfilesOptions,
	TokenSet,
	TokenSource,
} from "./types.ts";

type Profile = NonNullable<AuthStatus["profile"]>;

/** The profile name `value`, else an error that names `field` but never quotes the value. */
function checkProfile(value: unknown, field: string): string {
	if (!isProfileName(value)) {
		throw new OAuthConfigError(
			"invalid-option",
			`${field} must be 1 to 64 letters, digits, "-", "_" or ".", not starting with "." or "-"`,
		);
	}
	return value;
}

/** An environment variable's trimmed value, when it is set and not blank. */
const readEnv = (variable: string): string | undefined =>
	process.env[variable]?.trim() || undefined;

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
 * the server is discovered on the first login, and the login file read on first use. With
 * `profiles`, the client also has `profile(name)` and `profiles`.
 */
export function createAuth(
	options: CreateAuthOptions & { profiles: ProfilesOptions },
): ProfileAuthClient;
export function createAuth(options: CreateAuthOptions): AuthClient;
export function createAuth(options: CreateAuthOptions): AuthClient | ProfileAuthClient {
	const app = checkName(options?.app, "app");
	const name = checkName(options.name ?? app, "name");
	const { issuer, scope, hosts, ports, fetch, env, strict, onWarning, profiles } = options;
	const isVariable = (value: unknown) => typeof value === "string" && value.trim() !== "";
	if (env !== undefined && !isVariable(env)) {
		throw new OAuthConfigError("invalid-option", "env must name an environment variable");
	}
	if (
		profiles !== undefined &&
		(typeof profiles !== "object" ||
			profiles === null ||
			Array.isArray(profiles) ||
			(profiles.env !== undefined && !isVariable(profiles.env)))
	) {
		throw new OAuthConfigError(
			"invalid-option",
			"profiles must be an object; its env must name an environment variable",
		);
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
	const store = credentialStore({ app, keyring: { strict, onWarning } });
	const sourceOf = (profile: string) =>
		createTokenSource({
			config,
			identity: { issuer, clientId: options.clientId, apiOrigins: options.apiOrigins, profile },
			store,
			fetch,
		});

	// A bearer token never contains whitespace; padding comes from how the variable was set.
	const envValue = () => (env === undefined ? undefined : readEnv(env));

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

	/**
	 * The four methods over the login `select` picks at each call. With profiles, the profile is
	 * in `status()` and its name in a `LoginRequiredError`.
	 */
	function clientOf(
		select: () => Promise<{ source: TokenSource; profile: Profile | undefined }>,
	): AuthClient {
		const named =
			(profile: Profile | undefined) =>
			(error: unknown): never => {
				throw profile && error instanceof LoginRequiredError
					? new LoginRequiredError(error.reason, profile.name)
					: error;
			};

		async function login(loginOptions: LoginOptions): Promise<void> {
			const mode = detectLoginMode({ device: loginOptions.device });
			if (mode === "refuse") {
				throw new LoginRequiresInteractionError(
					`Signing in to ${name} needs a person at a terminal. Use the device login to sign in with a code instead${env === undefined ? "" : `, or set ${env} to a token`}.`,
				);
			}
			const { signal } = loginOptions;
			const { source } = await select();
			const server = await discover(config, issuer, { signal, fetch });
			// Opened before the flow, so a logout while it runs makes the commit fail, not undo it.
			const ticket = await source.beginLogin({ signal });
			try {
				// Recorded with the login, so every refresh asks for the same resource.
				await ticket.commit(await signIn(server, mode, loginOptions), {
					resource: resource.length > 0 ? resource : undefined,
					signal,
				});
			} finally {
				ticket.cancel();
			}
		}

		const loginToken = (
			source: TokenSource,
			profile: Profile | undefined,
			stored: AccessToken,
			baseUrl: string | undefined,
		): AuthToken =>
			redacted(
				{
					value: stored.value,
					source: "login" as const,
					refresh: async ({ signal }: { signal?: AbortSignal }) =>
						loginToken(
							source,
							profile,
							await source
								.forceRefresh({ signal, ifGeneration: stored.generation, baseUrl })
								.catch(named(profile)),
							baseUrl,
						),
				},
				["value"],
			);

		async function token({
			signal,
			baseUrl,
		}: { signal?: AbortSignal; baseUrl?: string } = {}): Promise<AuthToken> {
			throwIfAborted(signal);
			const value = envValue();
			if (value !== undefined) return redacted({ value, source: "env" as const }, ["value"]);
			const { source, profile } = await select();
			const stored = await source.get({ signal, baseUrl }).catch(named(profile));
			return loginToken(source, profile, stored, baseUrl);
		}

		async function status(): Promise<AuthStatus> {
			// An env token needs no login file: CI and containers may have none, or a broken one.
			if (envValue() !== undefined) return { source: "env" };
			const { source, profile } = await select();
			const { kind, plaintextRecords } = await store.status();
			const storage = { kind, plaintextRecords };
			const withProfile = profile && { profile };
			try {
				const { expiresAt, scope: granted } = await tokenSourceInternals(source).storedLogin();
				return { source: "login", expiresAt, scope: granted, storage, ...withProfile };
			} catch (error) {
				if (error instanceof LoginRequiredError && error.reason === "missing") {
					return { source: "none", storage, ...withProfile };
				}
				return named(profile)(error);
			}
		}

		async function logout(logoutOptions?: { signal?: AbortSignal }) {
			const { source } = await select();
			return source.logout(logoutOptions);
		}

		return Object.freeze({ login, token, status, logout });
	}

	// Created now, so an invalid identity throws here, with or without profiles.
	const defaultSource = sourceOf("default");
	if (profiles === undefined) {
		return clientOf(async () => ({ source: defaultSource, profile: undefined }));
	}

	const profileEnv = profiles.env;
	const files = credentialStoreInternals(store);
	const server = serverKey({ issuer, clientId: options.clientId });
	/** The profile the profiles `env` variable names, when it is set and not blank. */
	function envProfile(): Profile | undefined {
		if (profileEnv === undefined) return undefined;
		const value = readEnv(profileEnv);
		return value === undefined ? undefined : { name: checkProfile(value, profileEnv), via: "env" };
	}
	/** The profile chosen with `use()` in `document`, else `"default"`. */
	function chosenIn(document: CredentialsDocument | undefined): Profile {
		const chosen = document?.currentProfile[server];
		return chosen === undefined
			? { name: "default", via: "default" }
			: { name: chosen, via: "current" };
	}

	const current = clientOf(async () => {
		const profile = envProfile() ?? chosenIn(await files.read());
		return { source: sourceOf(profile.name), profile };
	});

	function profileClient(profileName?: string): AuthClient {
		if (profileName === undefined) return current;
		const chosen: Profile = { name: checkProfile(profileName, "A profile name"), via: "argument" };
		const source = sourceOf(chosen.name);
		return clientOf(async () => ({ source, profile: chosen }));
	}

	async function list(): Promise<readonly AuthProfile[]> {
		const document = await files.read();
		const currentName = (envProfile() ?? chosenIn(document)).name;
		const names = Object.values(document?.records ?? {}).flatMap((raw) => {
			const record = parseRecord(raw);
			return record?.identity &&
				!record.tombstone &&
				record.identity.issuer === issuer &&
				record.identity.clientId === options.clientId
				? [record.identity.profile]
				: [];
		});
		return names
			.sort()
			.map((profileName) => ({ name: profileName, current: profileName === currentName }));
	}

	async function use(profileName: string, { signal }: { signal?: AbortSignal } = {}) {
		const chosen = checkProfile(profileName, "A profile name");
		const key = recordKey({ issuer, clientId: options.clientId, profile: chosen });
		await files.update((document) => {
			const record = parseRecord(document?.records[key]);
			if (!document || !record || record.tombstone) throw new LoginRequiredError("missing", chosen);
			return { ...document, currentProfile: { ...document.currentProfile, [server]: chosen } };
		}, signal);
	}

	return Object.freeze({
		...current,
		profile: profileClient,
		profiles: Object.freeze({ list, use }),
	});
}
