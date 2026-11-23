import { openBrowser } from "./browser.ts";
import { defineServers } from "./config.ts";
import {
	credentialStore,
	credentialStoreInternals,
	type CredentialsDocument,
	currentProfiles,
	emptyDocument,
	isProfileName,
	parseRecord,
	recordKey,
	serverKey,
	withCurrentProfiles,
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
import { tokenSource, tokenSourceInternals } from "./token-source.ts";
import type {
	AccessToken,
	AuthClient,
	AuthProfile,
	AuthServer,
	AuthToken,
	CreateAuthOptions,
	LoginOptions,
	ProfileAuthClient,
	ProfileAuthStatus,
	ProfileClient,
	ProfileLoginOptions,
	ProfilesOptions,
	TokenOptions,
	TokenSet,
	TokenSource,
} from "./types.ts";

type Profile = NonNullable<ProfileAuthStatus["profile"]>;

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

/** `LoginRequiredError` naming `profile`, a checked profile name. */
function loginRequired(error: LoginRequiredError, profile: string): LoginRequiredError {
	const named = new LoginRequiredError(error.reason);
	named.message = `Not logged in to profile "${profile}", or the login expired; log in again`;
	return named;
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
	const { issuer, scope, hosts, ports, fetch, env, strict, profiles } = options;
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
	// A token in the profile variable would be a profile name, stored and listed in plaintext.
	// Compared ignoring case, as Windows looks variables up.
	if (env !== undefined && env.toUpperCase() === profiles?.env?.toUpperCase()) {
		throw new OAuthConfigError(
			"invalid-option",
			"profiles.env must name another variable than env",
		);
	}
	// Copied now: a later change to `options` must not move this client's logins.
	const clientId = options.clientId;
	const apiOrigins = Array.isArray(options.apiOrigins)
		? [...options.apiOrigins]
		: options.apiOrigins;
	const config = defineServers({
		servers: [
			{
				issuer,
				clientId,
				clientSecret: options.clientSecret,
				redirectPath: options.redirectPath,
				allowInsecureLoopback: options.allowInsecureLoopback,
			},
		],
	});
	checkScope(scope);
	const resource = checkResources(options.resource);
	checkLoopbackOptions({ hosts, ports });
	const store = credentialStore({ app, keyring: { strict } });
	const files = credentialStoreInternals(store);
	const sourceOf = (profile: string) =>
		tokenSource(
			{ config, identity: { issuer, clientId, apiOrigins, profile }, store, fetch },
			profiles !== undefined,
		);

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

	/** `error`, naming `profile` when it is a `LoginRequiredError` of a client with profiles. */
	const named =
		(profile: Profile | undefined) =>
		(error: unknown): never => {
			throw profile && error instanceof LoginRequiredError
				? loginRequired(error, profile.name)
				: error;
		};

	/**
	 * The four methods over the login `select` picks at each call, with `read`, the file as the
	 * pick saw it. With profiles, the profile is in `status()` and its name in a
	 * `LoginRequiredError`.
	 */
	function clientOf(
		select: () => Promise<{
			source: TokenSource;
			profile: Profile | undefined;
			read: () => Promise<CredentialsDocument | undefined>;
		}>,
	): ProfileClient {
		async function login(loginOptions: ProfileLoginOptions): Promise<void> {
			const { flow = "auto", signal, onWarning, profile } = loginOptions;
			const mode = flow === "auto" ? detectLoginMode() : flow;
			if (mode === "refuse") {
				throw new LoginRequiresInteractionError(
					`Signing in to ${name} needs a person at a terminal. Use the device login to sign in with a code instead${env === undefined ? "" : `, or set ${env} to a token`}.`,
				);
			}
			throwIfAborted(signal);
			// The login's token source, or the function that names its profile after sign-in.
			const target =
				typeof profile === "function"
					? profile
					: profile === undefined
						? (await select()).source
						: sourceOf(checkProfile(profile, "profile"));
			const server = await discover(config, issuer, { signal, fetch });
			const save = async (source: TokenSource, tokens: () => Promise<TokenSet>) => {
				const ticket = await tokenSourceInternals(source).beginLogin({ signal, onWarning });
				try {
					// Recorded with the login, so every refresh asks for the same resource.
					await ticket.commit(await tokens(), {
						resource: resource.length > 0 ? resource : undefined,
						signal,
					});
				} finally {
					ticket.cancel();
				}
			};
			// Opened before the flow, so a logout while it runs makes the commit fail, not undo it.
			if (typeof target !== "function")
				return save(target, () => signIn(server, mode, loginOptions));
			const tokens = await signIn(server, mode, loginOptions);
			const profileName = checkProfile(await unlessAborted(target(tokens), signal), "profile");
			return save(sourceOf(profileName), async () => tokens);
		}

		const loginToken = (
			source: TokenSource,
			profile: Profile | undefined,
			stored: AccessToken,
			{ baseUrl, onWarning }: TokenOptions,
		): AuthToken =>
			redacted(
				{
					value: stored.value,
					source: "login" as const,
					refresh: async ({ signal }: { signal?: AbortSignal }) =>
						loginToken(
							source,
							profile,
							await tokenSourceInternals(source)
								.forceRefresh({ signal, ifGeneration: stored.generation, baseUrl, onWarning })
								.catch(named(profile)),
							{ baseUrl, onWarning },
						),
				},
				["value"],
			);

		async function token({ signal, baseUrl, onWarning }: TokenOptions = {}): Promise<AuthToken> {
			throwIfAborted(signal);
			const value = envValue();
			if (value !== undefined) return redacted({ value, source: "env" as const }, ["value"]);
			const { source, profile, read } = await select();
			const stored = await tokenSourceInternals(source)
				.get(await read(), { signal, baseUrl, onWarning })
				.catch(named(profile));
			return loginToken(source, profile, stored, { baseUrl, onWarning });
		}

		async function status(): Promise<ProfileAuthStatus> {
			// An env token needs no login file: CI and containers may have none, or a broken one.
			if (envValue() !== undefined) return { source: "env" };
			const { source, profile, read } = await select();
			const document = await read();
			const { kind, plaintextRecords } = await files.statusOf(document, undefined);
			const storage = { kind, plaintextRecords };
			const withProfile = profile && { profile: { ...profile } };
			try {
				const { expiresAt, scope: granted } = tokenSourceInternals(source).storedLogin(document);
				return { source: "login", expiresAt, scope: granted, storage, ...withProfile };
			} catch (error) {
				if (error instanceof LoginRequiredError && error.reason === "missing") {
					return { source: "none", storage, ...withProfile };
				}
				return named(profile)(error);
			}
		}

		async function logout(logoutOptions?: { signal?: AbortSignal }) {
			throwIfAborted(logoutOptions?.signal);
			const { source } = await select();
			return source.logout(logoutOptions);
		}

		return Object.freeze({ login, token, status, logout });
	}

	const readDocument = () => files.read();
	// Created now, so an invalid identity throws here, with or without profiles.
	const defaultSource = sourceOf("default");
	if (profiles === undefined) {
		return clientOf(async () => ({
			source: defaultSource,
			profile: undefined,
			read: readDocument,
		}));
	}

	const profileEnv = profiles.env;
	const server = serverKey({ issuer, clientId });
	/** The profile the profiles `env` variable names, when it is set and not blank. */
	function envProfile(): Profile | undefined {
		if (profileEnv === undefined) return undefined;
		const value = readEnv(profileEnv);
		return value === undefined ? undefined : { name: checkProfile(value, profileEnv), via: "env" };
	}
	/** The profile chosen with `use()` in `document`, else `"default"`. */
	function chosenIn(document: CredentialsDocument | undefined): Profile {
		const chosen = currentProfiles(document, files.path)[server];
		return chosen === undefined
			? { name: "default", via: "default" }
			: { name: chosen, via: "current" };
	}

	const current = clientOf(async () => {
		const fromEnv = envProfile();
		if (fromEnv) return { source: sourceOf(fromEnv.name), profile: fromEnv, read: readDocument };
		const document = await files.read();
		const profile = chosenIn(document);
		return { source: sourceOf(profile.name), profile, read: async () => document };
	});

	function profileClient(profileName?: string): ProfileClient {
		if (profileName === undefined) return current;
		const chosen: Profile = { name: checkProfile(profileName, "A profile name"), via: "argument" };
		const source = sourceOf(chosen.name);
		return clientOf(async () => ({ source, profile: chosen, read: readDocument }));
	}

	async function list(): Promise<readonly AuthProfile[]> {
		const document = await files.read();
		const currentName = (envProfile() ?? chosenIn(document)).name;
		// Only logins `profile()` can reach: a name it accepts, under the key of that identity.
		const names = Object.entries(document?.records ?? {}).flatMap(([key, raw]) => {
			const record = parseRecord(raw);
			const identity = record?.tombstone === false ? record.identity : undefined;
			return identity?.issuer === issuer &&
				identity.clientId === clientId &&
				isProfileName(identity.profile) &&
				key === recordKey(identity)
				? [identity.profile]
				: [];
		});
		return names
			.sort()
			.map((profileName) => ({ name: profileName, current: profileName === currentName }));
	}

	async function use(profileName: string, { signal }: { signal?: AbortSignal } = {}) {
		const chosen = checkProfile(profileName, "A profile name");
		const source = tokenSourceInternals(sourceOf(chosen));
		await files.update((document) => {
			// The same check as `token()`: a missing, corrupt or another identity's login is refused.
			try {
				source.storedLogin(document);
			} catch (error) {
				named({ name: chosen, via: "argument" })(error);
			}
			const choices = currentProfiles(document, files.path);
			choices[server] = chosen;
			return withCurrentProfiles(document ?? emptyDocument(), choices);
		}, signal);
	}

	return Object.freeze({
		...current,
		profile: profileClient,
		profiles: Object.freeze({ list, use }),
	});
}
