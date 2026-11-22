import { createHash } from "node:crypto";
import { join } from "node:path";

import { createStore, CrustStoreError, stateDir, withLock } from "@crustjs/store";
import type { JsonObject, JsonValue } from "@crustjs/utils/json";
import type { StandardSchema } from "@crustjs/utils/schema";

import { type SealedSecret, seal, unseal } from "./cipher.ts";
import {
	AbortError,
	AuthError,
	CredentialStoreCorruptError,
	LockRecoveryRequiredError,
	LockTimeoutError,
	OAuthConfigError,
	UnsafeStorageError,
} from "./errors.ts";
import { throwIfAborted } from "./http.ts";
import { fileKeys, type KeyringKind, type WriteKey } from "./keyring.ts";
import type { CredentialStore, CredentialStoreOptions, CredentialStoreStatus } from "./types.ts";

// The credentials file: one strict `@crustjs/store` document, changed only
// through synchronous `store.update()` updaters and deleted only by `store.reset()`. Records are
// validated here, one key at a time, and written by an explicit serializer. Only a record's
// tokens are encrypted: its lifecycle fields stay readable without the keyring's key.

/** The document format this version reads and writes. A higher version fails closed. */
const VERSION = 1;

/** The persisted identity a credential is bound to. */
export interface StoredIdentity {
	issuer: string;
	clientId: string;
	profile: string;
	apiOrigins: string[];
}

/** A record's tokens, as a plaintext file stores them and as they are before encryption. */
export interface PlainSecret {
	accessToken: string;
	refreshToken: string | undefined;
}

/** A record's tokens as stored: plaintext, or encrypted under the file's key. */
export type StoredSecret = PlainSecret | SealedSecret;

export const isSealed = (secret: StoredSecret): secret is SealedSecret => "ciphertext" in secret;

/** One credential's lifecycle record. A tombstone keeps only its epoch (and identity). */
export interface StoredRecord {
	identity: StoredIdentity | undefined;
	epoch: string;
	tombstone: boolean;
	generation: string | undefined;
	/** Written before a refresh is sent; only a login, logout or proven failure clears it. */
	refreshInProgress: { generation: string; since: string } | undefined;
	expiresAt: number | undefined;
	scope: string | undefined;
	resource: string[] | undefined;
	/** `undefined` only in a tombstone. */
	secret: StoredSecret | undefined;
}

/** A parsed credentials document. `records` stay raw so one invalid record fails only its key. */
export interface CredentialsDocument {
	storeId: string;
	/** The key the file's encrypted records use; `undefined` while every record is plaintext. */
	keyId: string | undefined;
	/** The backend holding that key; `undefined` in a file written before it was recorded. */
	keyring: KeyringKind | undefined;
	records: Record<string, JsonValue | undefined>;
	/**
	 * The profiles chosen with `profiles.use()`, by {@link serverKey}, as stored: read and checked
	 * only by {@link currentProfiles}, so a client without profiles keeps it like an unknown key.
	 */
	currentProfile: JsonValue | undefined;
}

/** Accepts any JSON value: the document is validated here, not by the store. */
const anyJson: StandardSchema<unknown, JsonValue | undefined> = {
	"~standard": {
		version: 1,
		vendor: "crustjs-auth",
		validate: (value) => ({ value: value as JsonValue | undefined }),
	},
};

const FIELDS = {
	version: { schema: anyJson },
	storeId: { schema: anyJson },
	encryption: { schema: anyJson },
	records: { schema: anyJson },
	currentProfile: { schema: anyJson },
} as const;

function createDocumentStore(dirPath: string, name: string, lockTimeout: number | undefined) {
	return createStore({ dirPath, name, fields: FIELDS, strict: true, lockTimeout });
}

type DocumentStore = ReturnType<typeof createDocumentStore>;
type RawDocument = Awaited<ReturnType<DocumentStore["read"]>>;

/** What token sources need of a {@link CredentialStore}; kept off the public object. */
export interface CredentialStoreInternals {
	readonly path: string;
	/** The document, or `undefined` when there is none. Takes no lock. */
	read(): Promise<CredentialsDocument | undefined>;
	/** `status()` of `document`, a snapshot `read()` returned: asks the keyring, reads no file. */
	statusOf(
		document: CredentialsDocument | undefined,
		signal: AbortSignal | undefined,
	): Promise<CredentialStoreStatus>;
	/**
	 * One locked read-modify-write. `change` runs synchronously inside the document lock and
	 * throws to write nothing. `signal` is observed only while waiting for the lock.
	 */
	update(
		change: (document: CredentialsDocument | undefined) => CredentialsDocument,
		signal?: AbortSignal,
	): Promise<CredentialsDocument>;
	/** Runs `fn` holding the identity lock of `key`. */
	lockIdentity<T>(key: string, fn: () => Promise<T>, signal?: AbortSignal): Promise<T>;
	/**
	 * The tokens of `record`, the live record of `key` in `document`: decrypted when encrypted,
	 * which needs the file's key in the keyring. Writes nothing.
	 */
	reveal(
		document: CredentialsDocument,
		key: string,
		record: StoredRecord,
		signal: AbortSignal | undefined,
	): Promise<PlainSecret>;
	/**
	 * How a write into `document` stores its secret, picked before the document lock: the file's
	 * key, else the keyring's (created once), else plaintext. Only a `login` replaces a file key
	 * the keyring no longer holds. `signal` is observed until a key write is dispatched.
	 */
	writeKey(
		document: CredentialsDocument | undefined,
		login: boolean,
		signal: AbortSignal | undefined,
	): Promise<WriteKey>;
	/** `record` (key `key`) holding `secret`, stored as `writeKey` says. */
	withSecret(
		writeKey: WriteKey,
		key: string,
		record: StoredRecord,
		secret: PlainSecret,
	): Promise<StoredRecord>;
}

const internals = new WeakMap<CredentialStore, CredentialStoreInternals>();

/** The internals of a store from `credentialStore()`; anything else is refused. */
export function credentialStoreInternals(store: CredentialStore): CredentialStoreInternals {
	const found = internals.get(store);
	if (!found) throw new TypeError("Pass a store returned by credentialStore()");
	return found;
}

/** A random lifecycle value: `storeId`, `epoch` or `generation`. */
export const newId = (): string => crypto.randomUUID();

/** base64url SHA-256, for record keys and lock file names: never a secret. */
export const hashOf = (value: string): string =>
	createHash("sha256").update(value).digest("base64url");

/** The server part of a record key: `hash(issuer, clientId)`. */
export const serverKey = (identity: Pick<StoredIdentity, "issuer" | "clientId">): string =>
	hashOf(`${identity.issuer}\0${identity.clientId}`);

/** The record key of an identity: `<profile>#<hash(issuer, clientId)>`. */
export function recordKey(
	identity: Pick<StoredIdentity, "issuer" | "clientId" | "profile">,
): string {
	return `${identity.profile}#${serverKey(identity)}`;
}

/** A name `createAuth()` accepts for a profile: 1 to 64 letters, digits, `-`, `_` and `.`, not starting with `.` or `-`. */
export const isProfileName = (value: unknown): value is string =>
	typeof value === "string" && /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/.test(value);

const isString = (value: unknown): value is string => typeof value === "string" && value !== "";
const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const optional = <T>(
	value: unknown,
	check: (value: unknown) => value is T,
): value is T | undefined => value === undefined || check(value);
const isStringArray = (value: unknown): value is string[] =>
	Array.isArray(value) && value.every(isString);

function parseIdentity(value: unknown): StoredIdentity | undefined {
	if (!isObject(value)) return undefined;
	const { issuer, clientId, profile, apiOrigins } = value;
	if (!isString(issuer) || !isString(clientId) || !isString(profile)) return undefined;
	if (!isStringArray(apiOrigins) || apiOrigins.length === 0) return undefined;
	return { issuer, clientId, profile, apiOrigins: [...apiOrigins] };
}

function parseSecret(value: unknown): StoredSecret | undefined {
	if (!isObject(value)) return undefined;
	const { accessToken, refreshToken, iv, ciphertext } = value;
	if (accessToken === undefined && refreshToken === undefined) {
		return isString(iv) && isString(ciphertext) ? { iv, ciphertext } : undefined;
	}
	if (iv !== undefined || ciphertext !== undefined) return undefined;
	return isString(accessToken) && optional(refreshToken, isString)
		? { accessToken, refreshToken }
		: undefined;
}

/** A record, or `undefined` when it is invalid. */
export function parseRecord(value: JsonValue | undefined): StoredRecord | undefined {
	if (!isObject(value) || !isString(value.epoch)) return undefined;
	const identity = value.identity === undefined ? undefined : parseIdentity(value.identity);
	if (value.identity !== undefined && identity === undefined) return undefined;
	const empty: StoredRecord = {
		identity,
		epoch: value.epoch,
		tombstone: true,
		generation: undefined,
		refreshInProgress: undefined,
		expiresAt: undefined,
		scope: undefined,
		resource: undefined,
		secret: undefined,
	};
	if (value.tombstone === true) return empty;
	const { generation, refreshInProgress, expiresAt, scope, resource, tokenType } = value;
	const secret = parseSecret(value.secret);
	const mark = refreshInProgress;
	const valid =
		identity !== undefined &&
		value.tombstone === undefined &&
		isString(generation) &&
		tokenType === "Bearer" &&
		(mark === undefined || (isObject(mark) && isString(mark.generation) && isString(mark.since))) &&
		optional(expiresAt, (v): v is number => typeof v === "number" && Number.isFinite(v)) &&
		optional(scope, (v): v is string => typeof v === "string") &&
		optional(resource, isStringArray) &&
		secret !== undefined;
	if (!valid) return undefined;
	return {
		...empty,
		tombstone: false,
		generation,
		refreshInProgress: mark && {
			generation: mark.generation as string,
			since: mark.since as string,
		},
		expiresAt,
		scope,
		resource: resource && [...resource],
		secret,
	};
}

/** The explicit serializer of a record: only known fields, never a live object. */
export function serializeRecord(record: StoredRecord): JsonObject {
	const { identity, epoch } = record;
	const persisted: Record<string, JsonValue> = { epoch };
	if (identity) persisted.identity = { ...identity, apiOrigins: [...identity.apiOrigins] };
	if (record.tombstone) return { ...persisted, tombstone: true };
	persisted.generation = record.generation as string;
	persisted.tokenType = "Bearer";
	if (record.refreshInProgress) persisted.refreshInProgress = { ...record.refreshInProgress };
	if (record.expiresAt !== undefined) persisted.expiresAt = record.expiresAt;
	if (record.scope !== undefined) persisted.scope = record.scope;
	if (record.resource !== undefined) persisted.resource = [...record.resource];
	const secret = record.secret as StoredSecret;
	persisted.secret = isSealed(secret)
		? { iv: secret.iv, ciphertext: secret.ciphertext }
		: secret.refreshToken === undefined
			? { accessToken: secret.accessToken }
			: { accessToken: secret.accessToken, refreshToken: secret.refreshToken };
	return persisted;
}

/** A tombstone with a fresh epoch: the secret, generation and refresh mark are dropped. */
export function tombstone(identity: StoredIdentity | undefined): StoredRecord {
	return {
		identity,
		epoch: newId(),
		tombstone: true,
		generation: undefined,
		refreshInProgress: undefined,
		expiresAt: undefined,
		scope: undefined,
		resource: undefined,
		secret: undefined,
	};
}

/** Whether `document` may take a secret stored as `writeKey` says: a commit's key check. */
export function accepts(document: CredentialsDocument, writeKey: WriteKey): boolean {
	if (writeKey.kind === "plaintext") return document.keyId === undefined;
	if (writeKey.replaces !== undefined) return document.keyId === writeKey.replaces;
	return document.keyId === undefined || document.keyId === writeKey.fileKey.keyId;
}

/**
 * `document` recording `writeKey`'s key. A login replacing the file's key logs out every record
 * encrypted under the old one, in every profile, and counts them as `discarded`.
 */
export function withFileKey(
	document: CredentialsDocument,
	writeKey: WriteKey,
): { document: CredentialsDocument; discarded: number } {
	if (writeKey.kind === "plaintext") return { document, discarded: 0 };
	const keyId = writeKey.fileKey.keyId;
	// The backend that wrote the key; one that reaches the same entry (macOS) does not change it.
	const keyring =
		document.keyId === keyId && document.keyring !== undefined
			? document.keyring
			: writeKey.fileKey.keyring;
	if (writeKey.replaces === undefined) {
		return { document: { ...document, keyId, keyring }, discarded: 0 };
	}
	let discarded = 0;
	const records = Object.fromEntries(
		Object.entries(document.records).map(([key, raw]) => {
			const record = parseRecord(raw);
			if (!record?.secret || !isSealed(record.secret)) return [key, raw];
			discarded += 1;
			return [key, serializeRecord(tombstone(record.identity))];
		}),
	);
	return { document: { ...document, keyId, keyring, records }, discarded };
}

function parseDocument(raw: RawDocument, path: string): CredentialsDocument | undefined {
	const { version, storeId, encryption, records, currentProfile } = raw;
	if (
		version === undefined &&
		storeId === undefined &&
		encryption === undefined &&
		records === undefined
	) {
		return undefined;
	}
	if (typeof version === "number" && version > VERSION) {
		throw new CredentialStoreCorruptError(path, { newerVersion: true });
	}
	const keyId =
		isObject(encryption) && encryption.kind === "aes-256-gcm" && isString(encryption.keyId)
			? encryption.keyId
			: undefined;
	const keyring = isObject(encryption) ? encryption.keyring : undefined;
	if (
		version !== VERSION ||
		!isString(storeId) ||
		!isObject(encryption) ||
		(encryption.kind !== "plaintext" && keyId === undefined) ||
		(keyring !== undefined &&
			(keyId === undefined || (keyring !== "bun-secrets" && keyring !== "napi-keyring"))) ||
		!isObject(records)
	) {
		throw new CredentialStoreCorruptError(path);
	}
	return {
		storeId,
		keyId,
		keyring,
		records: { ...(records as Record<string, JsonValue | undefined>) },
		currentProfile,
	};
}

function serializeDocument(document: CredentialsDocument): RawDocument {
	return {
		version: VERSION,
		storeId: document.storeId,
		encryption:
			document.keyId === undefined
				? { kind: "plaintext" }
				: document.keyring === undefined
					? { kind: "aes-256-gcm", keyId: document.keyId }
					: { kind: "aes-256-gcm", keyId: document.keyId, keyring: document.keyring },
		records: document.records as JsonObject,
		currentProfile: document.currentProfile,
	};
}

/** A new, empty document with a fresh `storeId`. */
export const emptyDocument = (): CredentialsDocument => ({
	storeId: newId(),
	keyId: undefined,
	keyring: undefined,
	records: {},
	currentProfile: undefined,
});

/**
 * The profiles chosen with `profiles.use()` in `document`, by {@link serverKey}. A field that is
 * not an object of profile names fails closed.
 */
export function currentProfiles(
	document: CredentialsDocument | undefined,
	path: string,
): Record<string, string> {
	const stored = document?.currentProfile;
	const chosen: Record<string, string> = {};
	if (stored === undefined) return chosen;
	if (!isObject(stored)) throw new CredentialStoreCorruptError(path);
	for (const [server, profile] of Object.entries(stored)) {
		if (!isProfileName(profile)) throw new CredentialStoreCorruptError(path);
		chosen[server] = profile;
	}
	return chosen;
}

/** `document` with `chosen` as its profile choices; none removes the field. */
export const withCurrentProfiles = (
	document: CredentialsDocument,
	chosen: Record<string, string>,
): CredentialsDocument => ({
	...document,
	currentProfile: Object.keys(chosen).length === 0 ? undefined : chosen,
});

/** The AAD of a record's secret: it binds the ciphertext to its file, record and generation. */
function aadOf(app: string, key: string, record: StoredRecord): string[] {
	const { issuer, clientId, profile, apiOrigins } = record.identity as StoredIdentity;
	return [
		String(VERSION),
		app,
		key,
		issuer,
		clientId,
		profile,
		...[...apiOrigins].sort(),
		record.generation as string,
	];
}

/**
 * Maps a store or lock error to the auth error it means. A store error is never forwarded with
 * its cause: a parse error can quote the file.
 */
function storageError(error: unknown, path: string, signal: AbortSignal | undefined): unknown {
	if (error instanceof AuthError) return error;
	if (signal?.aborted && error === signal.reason) return new AbortError();
	if (!(error instanceof CrustStoreError)) return error;
	if (error.is("PARSE") || error.is("VALIDATION")) return new CredentialStoreCorruptError(path);
	if (error.is("PATH") && error.details.reason !== undefined) {
		return new UnsafeStorageError(error.details.path);
	}
	if (error.is("LOCK")) {
		const { path: lockPath, verdict, owner, manualStep } = error.details;
		const recorded = owner && {
			ownerId: owner.ownerId,
			pid: owner.pid,
			host: owner.host,
			platform: owner.platform,
			createdAt: owner.createdAt,
		};
		// A `.recover` file left past the deadline needs the manual step, whoever wrote it.
		return verdict === "alive" && !lockPath.endsWith(".recover")
			? new LockTimeoutError(lockPath, recorded, manualStep)
			: new LockRecoveryRequiredError(lockPath, recorded, manualStep);
	}
	return error;
}

/**
 * The private credentials file of an app: `credentials.json` in the app's state
 * directory, `0600` in a `0700` directory on POSIX, never a symbolic link. With `keyring`, its
 * tokens are encrypted under a key kept in the OS keyring. Creating it does no I/O; the file is
 * read when a token source first needs it.
 */
export function credentialStore(options: CredentialStoreOptions): CredentialStore {
	const { keyring } = options;
	if (
		keyring !== undefined &&
		(!isObject(keyring) ||
			(keyring.strict !== undefined && typeof keyring.strict !== "boolean") ||
			(keyring.onWarning !== undefined && typeof keyring.onWarning !== "function"))
	) {
		throw new OAuthConfigError(
			"invalid-option",
			"keyring must be an object; its strict must be a boolean and its onWarning a function",
		);
	}
	const name = options.name ?? "credentials";
	const dir = stateDir(options.app);
	const store = createDocumentStore(dir, name, options.lockTimeout);
	const path = join(dir, `${name}.json`);

	const read = async () => {
		try {
			return parseDocument(await store.read(), path);
		} catch (error) {
			throw storageError(error, path, undefined);
		}
	};

	const update: CredentialStoreInternals["update"] = async (change, signal) => {
		throwIfAborted(signal);
		try {
			const written = await store.update(
				(raw) => {
					const document = parseDocument(raw, path);
					const next = change(document);
					// A file without the credentials fields keeps `currentProfile` as one of its own keys.
					return serializeDocument(
						document === undefined && next.currentProfile === undefined
							? { ...next, currentProfile: raw.currentProfile }
							: next,
					);
				},
				{ signal },
			);
			return parseDocument(written, path) as CredentialsDocument;
		} catch (error) {
			throw storageError(error, path, signal);
		}
	};

	const lockIdentity: CredentialStoreInternals["lockIdentity"] = async (key, fn, signal) => {
		throwIfAborted(signal);
		try {
			return await withLock(join(dir, `${name}.${hashOf(key)}`), fn, {
				signal,
				timeout: options.lockTimeout,
			});
		} catch (error) {
			throw storageError(error, path, signal);
		}
	};

	// App-wide: every credentials file of the app shares the keyring's one key.
	const keys = fileKeys(options.app, keyring, async (fn, signal) => {
		try {
			await withLock(join(dir, "key-init"), fn, { signal, timeout: options.lockTimeout });
		} catch (error) {
			throw storageError(error, path, signal);
		}
	});

	const reveal: CredentialStoreInternals["reveal"] = async (document, key, record, signal) => {
		const secret = record.secret as StoredSecret;
		if (!isSealed(secret)) return secret;
		if (document.keyId === undefined) throw new CredentialStoreCorruptError(path, { key });
		const { key: cryptoKey } = await keys.forFile(document.keyId, document.keyring, signal);
		let plain: StoredSecret | undefined;
		try {
			plain = parseSecret(
				JSON.parse(await unseal(cryptoKey, secret, aadOf(options.app, key, record))),
			);
		} catch {
			// Tampered, or moved from another record, key or generation.
			throw new CredentialStoreCorruptError(path, { key });
		}
		if (!plain || isSealed(plain)) throw new CredentialStoreCorruptError(path, { key });
		return plain;
	};

	const withSecret: CredentialStoreInternals["withSecret"] = async (
		writeKey,
		key,
		record,
		secret,
	) => {
		if (writeKey.kind === "plaintext") return { ...record, secret };
		const plaintext = JSON.stringify(secret);
		const sealed = await seal(writeKey.fileKey.key, plaintext, aadOf(options.app, key, record));
		return { ...record, secret: sealed };
	};

	const statusOf: CredentialStoreInternals["statusOf"] = async (document, signal) => {
		const plaintextRecords = Object.values(document?.records ?? {}).filter((raw) => {
			const secret = parseRecord(raw)?.secret;
			return secret !== undefined && !isSealed(secret);
		}).length;
		const { kind, keyReadable } = await keys.status(document?.keyId, document?.keyring, signal);
		return {
			kind,
			encryption: document?.keyId === undefined ? "plaintext" : "aes-256-gcm",
			keyReadable,
			plaintextRecords,
		};
	};

	const credentials: CredentialStore = Object.freeze({
		path,
		async status({ signal }: { signal?: AbortSignal } = {}): Promise<CredentialStoreStatus> {
			throwIfAborted(signal);
			return statusOf(await read(), signal);
		},
		async resetCredentials({ key, signal }: { key?: string; signal?: AbortSignal } = {}) {
			throwIfAborted(signal);
			if (key === undefined) {
				try {
					await store.reset({ signal });
				} catch (error) {
					throw storageError(error, path, signal);
				}
				return;
			}
			// One key: a tombstone with a fresh epoch, so that key's open logins become stale.
			await lockIdentity(
				key,
				async () => {
					throwIfAborted(signal);
					await update((document) => {
						const current = document ?? emptyDocument();
						const raw = current.records[key];
						const identity = parseIdentity(isObject(raw) ? raw.identity : undefined);
						return {
							...current,
							records: { ...current.records, [key]: serializeRecord(tombstone(identity)) },
						};
					}, signal);
				},
				signal,
			);
		},
	});
	internals.set(credentials, {
		path,
		read,
		statusOf,
		update,
		lockIdentity,
		reveal,
		writeKey: (document, login, signal) =>
			keys.forWrite(document?.keyId, document?.keyring, login, signal),
		withSecret,
	});
	return credentials;
}
