import { isAuthConfig } from "./config.ts";
import {
	type CredentialsDocument,
	credentialStoreInternals,
	emptyDocument,
	newId,
	parseRecord,
	recordKey,
	serializeRecord,
	type StoredIdentity,
	type StoredRecord,
	tombstone,
} from "./credentials.ts";
import { discover } from "./discovery.ts";
import { checkIssuer, checkUrl } from "./endpoint.ts";
import {
	AbortError,
	CredentialMismatchError,
	CredentialStoreCorruptError,
	LoginInProgressError,
	LoginRequiredError,
	NetworkError,
	OAuthConfigError,
	OAuthError,
	RefreshFailedError,
	RefreshOutcomeUnknownError,
	StaleCommitError,
	TimeoutError,
} from "./errors.ts";
import { throwIfAborted, unsentRequests } from "./http.ts";
import { createTokenClient, redacted } from "./token-client.ts";
import type {
	AccessToken,
	Credential,
	LoginTicket,
	LogoutResult,
	TokenSet,
	TokenSource,
	TokenSourceOptions,
} from "./types.ts";

// Token sources. Every lifecycle change holds
// the credential's identity lock, then makes one synchronous `store.update()` that rechecks
// the lifecycle (storeId, epoch, generation) and throws to write nothing.

/** RFC 6749 §5.2 token-endpoint error codes: proof the request was refused, not processed. */
const TOKEN_ERROR_CODES: ReadonlySet<string> = new Set([
	"invalid_request",
	"invalid_client",
	"invalid_grant",
	"unauthorized_client",
	"unsupported_grant_type",
	"invalid_scope",
]);

interface Flight {
	readonly promise: Promise<AccessToken>;
	readonly controller: AbortController;
	waiters: number;
}

/** In-process single-flight refreshes, by credentials file and key. */
export const refreshFlights: Map<string, Flight> = new Map();
/** Open login tickets, by credentials file and key. */
const openLogins = new Set<string>();

/** What `fromStore()` needs of a token source; kept off the public object. */
interface TokenSourceInternals {
	/** Whether a live (not logged-out) record exists: no lock, no refresh. */
	hasCredential(): Promise<boolean>;
	/**
	 * The live record's expiry and scope, read the same way: no lock, no refresh, no request.
	 * No login → `LoginRequiredError` (`missing`); a file it can't read throws its error.
	 */
	storedLogin(): Promise<{ expiresAt: number | undefined; scope: string | undefined }>;
}

const sourceInternals = new WeakMap<TokenSource, TokenSourceInternals>();

/** The internals of a source from `createTokenSource()`; anything else is refused. */
export function tokenSourceInternals(source: TokenSource): TokenSourceInternals {
	const found = sourceInternals.get(source);
	if (!found) throw new TypeError("Pass a token source returned by createTokenSource()");
	return found;
}

const accessToken = (record: StoredRecord): AccessToken =>
	redacted({ value: record.accessToken as string, generation: record.generation as string }, [
		"value",
	]);

/** Rejects with {@link AbortError} on `signal` without stopping `promise`, which others share. */
function detach<T>(promise: Promise<T>, signal: AbortSignal | undefined, onAbort: () => void) {
	if (!signal) return promise;
	return new Promise<T>((resolve, reject) => {
		const abort = () => {
			onAbort();
			reject(new AbortError());
		};
		if (signal.aborted) {
			abort();
			return;
		}
		signal.addEventListener("abort", abort, { once: true });
		promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
	});
}

const optionsError = (message: string) => new OAuthConfigError("invalid-option", message);

/** The configured identity, validated without I/O. */
function checkIdentity(options: TokenSourceOptions): StoredIdentity {
	const { config, identity } = options;
	if (!isAuthConfig(config)) throw optionsError("Pass a config returned by defineServers()");
	if (typeof identity !== "object" || identity === null) throw optionsError("Pass an identity");
	const { issuer, clientId, profile = "default", apiOrigins } = identity;
	const entry = config.servers.find((server) => server.issuer === issuer);
	if (!entry && !config.allowCustomIssuers) {
		throw new OAuthConfigError("unknown-issuer", "The issuer is not one of the configured servers");
	}
	const devOrigin = checkIssuer(issuer, entry?.allowInsecureLoopback ?? false);
	if (typeof clientId !== "string" || clientId === "") {
		throw optionsError("identity.clientId must be a non-empty string");
	}
	if (typeof profile !== "string" || profile === "") {
		throw optionsError("identity.profile must be a non-empty string");
	}
	if (!Array.isArray(apiOrigins) || apiOrigins.length === 0) {
		throw optionsError("identity.apiOrigins must list at least one origin");
	}
	const origins = apiOrigins.map(
		(origin) => new URL(checkUrl(origin, "apiOrigins", devOrigin)).origin,
	);
	return { issuer, clientId, profile, apiOrigins: [...new Set(origins)].sort() };
}

/** Why `stored` is not `configured`, or `undefined` when they are the same identity. */
function mismatch(stored: StoredIdentity, configured: StoredIdentity) {
	if (stored.issuer !== configured.issuer) return "issuer";
	if (stored.clientId !== configured.clientId) return "client";
	if (stored.profile !== configured.profile) return "profile";
	const origins = [...stored.apiOrigins].sort();
	return origins.join(" ") === configured.apiOrigins.join(" ") ? undefined : "origin";
}

/**
 * A token source for one credential in `store`: reads, refreshes, logs in and logs out.
 * Creating it does no I/O.
 */
export function createTokenSource(options: TokenSourceOptions): TokenSource {
	const identity = checkIdentity(options);
	const store = credentialStoreInternals(options.store);
	const { config } = options;
	const skewMs = options.skewMs ?? 30_000;
	const fetchImpl = options.fetch;
	const key = recordKey(identity);
	const id = `${store.path}\0${key}`;
	const discoverServer = (signal: AbortSignal | undefined) =>
		discover(config, identity.issuer, { signal, fetch: fetchImpl, clientId: identity.clientId });

	/** This key's record: live and of this identity, else the error that says why not. */
	function liveRecord(document: CredentialsDocument | undefined, baseUrl?: string): StoredRecord {
		const raw = document?.records[key];
		if (raw === undefined) {
			// Logged in to the same profile at another issuer or client id.
			for (const [otherKey, value] of Object.entries(document?.records ?? {})) {
				const other = otherKey === key ? undefined : parseRecord(value);
				if (other && !other.tombstone && other.identity?.profile === identity.profile) {
					throw new CredentialMismatchError(mismatch(other.identity, identity) ?? "origin");
				}
			}
			throw new LoginRequiredError("missing");
		}
		const record = parseRecord(raw);
		if (!record) throw new CredentialStoreCorruptError(store.path, { key });
		if (record.tombstone) throw new LoginRequiredError("missing");
		const reason = mismatch(record.identity as StoredIdentity, identity);
		if (reason) throw new CredentialMismatchError(reason);
		if (baseUrl !== undefined && !identity.apiOrigins.includes(new URL(baseUrl).origin)) {
			throw new CredentialMismatchError("origin");
		}
		return record;
	}

	/** The document still holds the record this refresh observed. */
	function unchanged(
		document: CredentialsDocument | undefined,
		storeId: string,
		observed: StoredRecord,
	): StoredRecord | undefined {
		if (!document || document.storeId !== storeId) return undefined;
		const record = parseRecord(document.records[key]);
		return record &&
			!record.tombstone &&
			record.epoch === observed.epoch &&
			record.generation === observed.generation
			? record
			: undefined;
	}

	const withRecord = (document: CredentialsDocument, record: StoredRecord) => ({
		...document,
		records: { ...document.records, [key]: serializeRecord(record) },
	});

	/**
	 * Refreshes the credential observed at `generation` under the identity lock.
	 * `signal` (all waiters gone) is observed only until the mark is written.
	 */
	async function refresh(generation: string, signal: AbortSignal): Promise<AccessToken> {
		return store.lockIdentity(
			key,
			async () => {
				const document = await store.read();
				const record = liveRecord(document);
				// With the lock held, a mark's refresh is no longer running: its outcome is unknown.
				if (record.refreshInProgress) throw new RefreshOutcomeUnknownError();
				// Another process or source refreshed or logged in meanwhile: use its token.
				if (record.generation !== generation) return accessToken(record);
				if (record.refreshToken === undefined) throw new LoginRequiredError("expired");
				const server = await discoverServer(signal);
				throwIfAborted(signal);
				const storeId = (document as CredentialsDocument).storeId;
				try {
					await store.update((current) => {
						const found = unchanged(current, storeId, record);
						if (!found) throw new RefreshFailedError();
						const mark = { generation, since: new Date().toISOString() };
						return withRecord(current as CredentialsDocument, {
							...found,
							refreshInProgress: mark,
						});
					}, signal);
				} catch (error) {
					if (error instanceof AbortError || error instanceof CredentialStoreCorruptError)
						throw error;
					throw new RefreshFailedError();
				}
				// From here on nothing cancels the refresh: the server may rotate the token.
				let tokens: TokenSet;
				try {
					tokens = await createTokenClient(server, { fetch: fetchImpl }).refresh(
						record.refreshToken,
						{ resource: record.resource },
					);
				} catch (error) {
					throw await failedRefresh(error, storeId, record);
				}
				try {
					const written = await store.update((current) => {
						const found = unchanged(current, storeId, record);
						if (!found?.refreshInProgress) throw new LoginRequiredError("store-changed");
						return withRecord(current as CredentialsDocument, {
							...found,
							generation: newId(),
							refreshInProgress: undefined,
							accessToken: tokens.accessToken,
							// The old refresh token stays when the server sent none.
							refreshToken: tokens.refreshToken ?? found.refreshToken,
							expiresAt: tokens.expiresAt,
							// A response without scope keeps the granted scope.
							scope: tokens.scope ?? found.scope,
						});
					});
					return accessToken(parseRecord(written.records[key]) as StoredRecord);
				} catch (error) {
					// The tokens are discarded; the mark stays unless a reset removed the record.
					throw error instanceof LoginRequiredError ? error : new RefreshOutcomeUnknownError();
				}
			},
			signal,
		);
	}

	/**
	 * The error of a refresh that failed after its mark was written. Only a failure that proves
	 * the server did not rotate the token clears the mark; any other is uncertain.
	 */
	async function failedRefresh(error: unknown, storeId: string, record: StoredRecord) {
		const refused =
			error instanceof OAuthError &&
			TOKEN_ERROR_CODES.has(error.code) &&
			(error.status === 400 || (error.status === 401 && error.code === "invalid_client"));
		const unsent =
			(error instanceof NetworkError && unsentRequests.has(error)) ||
			error instanceof OAuthConfigError;
		if (!refused && !unsent) return new RefreshOutcomeUnknownError();
		try {
			await store.update((current) => {
				const found = unchanged(current, storeId, record);
				if (!found?.refreshInProgress) throw new RefreshFailedError();
				return withRecord(current as CredentialsDocument, {
					...found,
					refreshInProgress: undefined,
				});
			});
		} catch {
			// The mark stays: the next use reports an uncertain refresh, which is safe.
		}
		if (error instanceof OAuthError && error.code === "invalid_grant") {
			return new LoginRequiredError("invalid-grant");
		}
		return error instanceof OAuthError ? error : new RefreshFailedError();
	}

	/** Joins this credential's refresh in this process, or starts it. */
	function sharedRefresh(generation: string, signal: AbortSignal | undefined) {
		let flight = refreshFlights.get(id);
		if (!flight) {
			const controller = new AbortController();
			const promise = refresh(generation, controller.signal).finally(() => {
				if (refreshFlights.get(id) === flight) refreshFlights.delete(id);
			});
			promise.catch(() => {});
			flight = { promise, controller, waiters: 0 };
			refreshFlights.set(id, flight);
		}
		const joined = flight;
		joined.waiters += 1;
		return detach(joined.promise, signal, () => {
			joined.waiters -= 1;
			// Until the mark is written, the refresh stops when its last waiter leaves.
			if (joined.waiters === 0) joined.controller.abort(new AbortError());
		});
	}

	async function readRecord(signal: AbortSignal | undefined, baseUrl: string | undefined) {
		throwIfAborted(signal);
		return liveRecord(await store.read(), baseUrl);
	}

	async function revoke(
		tokens: { accessToken: string; refreshToken: string | undefined },
		signal: AbortSignal | undefined,
	): Promise<LogoutResult["remote"]> {
		try {
			const server = await discoverServer(signal);
			if (!server.revocationEndpoint) return "unsupported";
			const client = createTokenClient(server, { fetch: fetchImpl });
			if (tokens.refreshToken === undefined) {
				await client.revoke(tokens.accessToken, { tokenTypeHint: "access_token", signal });
				return "revoked";
			}
			await client.revoke(tokens.refreshToken, { tokenTypeHint: "refresh_token", signal });
			// The access token too, where the server can revoke one.
			await client
				.revoke(tokens.accessToken, { tokenTypeHint: "access_token", signal })
				.catch((error: unknown) => {
					if (!(error instanceof OAuthError && error.code === "unsupported_token_type"))
						throw error;
				});
			return "revoked";
		} catch (error) {
			const unanswered =
				error instanceof AbortError ||
				error instanceof TimeoutError ||
				(error instanceof NetworkError && !unsentRequests.has(error));
			return unanswered ? "unknown" : "failed";
		}
	}

	const source: TokenSource = Object.freeze({
		key,

		async get({ signal, baseUrl }: { signal?: AbortSignal; baseUrl?: string } = {}) {
			const record = await readRecord(signal, baseUrl);
			// A mark read without the lock may be a refresh still running elsewhere: wait for the lock.
			const fresh =
				!record.refreshInProgress &&
				(record.expiresAt === undefined || Date.now() < record.expiresAt - skewMs);
			return fresh ? accessToken(record) : sharedRefresh(record.generation as string, signal);
		},

		async forceRefresh({
			signal,
			ifGeneration,
			baseUrl,
		}: { signal?: AbortSignal; ifGeneration?: string; baseUrl?: string } = {}) {
			const record = await readRecord(signal, baseUrl);
			// A newer credential than the one that failed is used as is.
			if (
				ifGeneration !== undefined &&
				record.generation !== ifGeneration &&
				!record.refreshInProgress
			) {
				return accessToken(record);
			}
			return sharedRefresh(record.generation as string, signal);
		},

		async beginLogin({ signal }: { signal?: AbortSignal } = {}): Promise<LoginTicket> {
			throwIfAborted(signal);
			if (openLogins.has(id)) throw new LoginInProgressError();
			openLogins.add(id);
			const cancelled = new AbortController();
			let finished = false;
			const finish = () => {
				if (finished) return;
				finished = true;
				openLogins.delete(id);
				cancelled.abort(new AbortError());
				signal?.removeEventListener("abort", finish);
			};
			let observed: { storeId: string; epoch: string | undefined };
			try {
				observed = await store.lockIdentity(
					key,
					async () => {
						// An absent file gets its document now, so the ticket observes a storeId.
						const document =
							(await store.read()) ??
							(await store.update((current) => current ?? emptyDocument(), signal));
						const raw = document.records[key];
						const record = raw === undefined ? undefined : parseRecord(raw);
						if (raw !== undefined && !record) {
							throw new CredentialStoreCorruptError(store.path, { key });
						}
						return { storeId: document.storeId, epoch: record?.epoch };
					},
					signal,
				);
				throwIfAborted(signal);
			} catch (error) {
				finish();
				throw error;
			}
			signal?.addEventListener("abort", finish, { once: true });

			const ticket: LoginTicket = Object.freeze({
				async commit(
					tokens: TokenSet,
					{
						resource,
						signal: commitSignal,
					}: { resource?: readonly string[]; signal?: AbortSignal } = {},
				): Promise<Credential> {
					if (finished) {
						throw new OAuthConfigError("already-used", "This login ticket is finished");
					}
					const stop = AbortSignal.any(
						commitSignal ? [cancelled.signal, commitSignal] : [cancelled.signal],
					);
					try {
						const valid =
							typeof tokens?.accessToken === "string" &&
							tokens.accessToken !== "" &&
							tokens.tokenType === "Bearer" &&
							(tokens.refreshToken === undefined ||
								(typeof tokens.refreshToken === "string" && tokens.refreshToken !== ""));
						if (!valid) throw optionsError("Pass the token set of a login");
						const resources = resource === undefined ? undefined : [...resource];
						if (resources?.some((value) => typeof value !== "string" || value === "")) {
							throw optionsError("resource must list non-empty strings");
						}
						const record: StoredRecord = {
							identity,
							epoch: newId(),
							tombstone: false,
							generation: newId(),
							refreshInProgress: undefined,
							expiresAt: tokens.expiresAt,
							scope: tokens.scope,
							resource: resources,
							accessToken: tokens.accessToken,
							refreshToken: tokens.refreshToken,
						};
						return await store.lockIdentity(
							key,
							async () => {
								throwIfAborted(stop);
								// The boundary: once the write starts, it completes.
								await store.update((current) => {
									const raw = current?.records[key];
									const epoch =
										typeof raw === "object" && raw !== null && !Array.isArray(raw)
											? (raw as { epoch?: unknown }).epoch
											: undefined;
									if (current?.storeId !== observed.storeId || epoch !== observed.epoch) {
										throw new StaleCommitError();
									}
									return withRecord(current, record);
								}, stop);
								return redacted(
									{
										identity: { ...identity, apiOrigins: [...identity.apiOrigins] },
										accessToken: tokens.accessToken,
										refreshToken: tokens.refreshToken,
										expiresAt: tokens.expiresAt,
										scope: tokens.scope,
										resource: resources,
										tokenType: "Bearer",
										generation: record.generation as string,
									} satisfies Credential,
									["accessToken", "refreshToken"],
								);
							},
							stop,
						);
					} finally {
						finish();
					}
				},
				cancel: finish,
			});
			return ticket;
		},

		async logout({ signal }: { signal?: AbortSignal } = {}): Promise<LogoutResult> {
			throwIfAborted(signal);
			let captured: { accessToken: string; refreshToken: string | undefined } | undefined;
			const local = await store.lockIdentity(
				key,
				async (): Promise<LogoutResult["local"]> => {
					const document = await store.read();
					const record = parseRecord(document?.records[key]);
					// Revoke only this identity's readable tokens; logout still happens.
					if (
						record &&
						!record.tombstone &&
						!mismatch(record.identity as StoredIdentity, identity)
					) {
						captured = {
							accessToken: record.accessToken as string,
							refreshToken: record.refreshToken,
						};
					}
					throwIfAborted(signal);
					try {
						await store.update(
							(current) => withRecord(current ?? emptyDocument(), tombstone(identity)),
							signal,
						);
						return "deleted";
					} catch (error) {
						if (error instanceof CredentialStoreCorruptError || error instanceof AbortError) {
							throw error;
						}
						return "failed";
					}
				},
				signal,
			);
			if (local === "failed" || !captured) return { local, remote: "skipped" };
			return { local, remote: await revoke(captured, signal) };
		},
	});
	sourceInternals.set(source, {
		async hasCredential() {
			try {
				const record = parseRecord((await store.read())?.records[key]);
				return record !== undefined && !record.tombstone;
			} catch {
				return false;
			}
		},
		async storedLogin() {
			const { expiresAt, scope } = await readRecord(undefined, undefined);
			return { expiresAt, scope };
		},
	});
	return source;
}
