import { createHash } from "node:crypto";
import { join } from "node:path";

import { createStore, CrustStoreError, stateDir, withLock } from "@crustjs/store";
import type { JsonObject, JsonValue } from "@crustjs/utils/json";
import type { StandardSchema } from "@crustjs/utils/schema";

import {
	AbortError,
	AuthError,
	CredentialStoreCorruptError,
	LockRecoveryRequiredError,
	LockTimeoutError,
	UnsafeStorageError,
} from "./errors.ts";
import { throwIfAborted } from "./http.ts";
import type { CredentialStore, CredentialStoreOptions } from "./types.ts";

// The credentials file: one strict `@crustjs/store` document, changed only
// through synchronous `store.update()` updaters and deleted only by `store.reset()`. Records are
// validated here, one key at a time, and written by an explicit serializer.

/** The document format this version reads and writes. A higher version fails closed. */
const VERSION = 1;

/** The persisted identity a credential is bound to. */
export interface StoredIdentity {
	issuer: string;
	clientId: string;
	profile: string;
	apiOrigins: string[];
}

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
	accessToken: string | undefined;
	refreshToken: string | undefined;
}

/** A parsed credentials document. `records` stay raw so one invalid record fails only its key. */
export interface CredentialsDocument {
	storeId: string;
	records: Record<string, JsonValue | undefined>;
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

/** The record key of an identity: `<profile>#<hash(issuer, clientId)>`. */
export function recordKey(
	identity: Pick<StoredIdentity, "issuer" | "clientId" | "profile">,
): string {
	return `${identity.profile}#${hashOf(`${identity.issuer}\0${identity.clientId}`)}`;
}

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
		accessToken: undefined,
		refreshToken: undefined,
	};
	if (value.tombstone === true) return empty;
	const { generation, refreshInProgress, expiresAt, scope, resource, tokenType, secret } = value;
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
		isObject(secret) &&
		isString(secret.accessToken) &&
		optional(secret.refreshToken, isString);
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
		accessToken: secret.accessToken as string,
		refreshToken: secret.refreshToken as string | undefined,
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
	persisted.secret =
		record.refreshToken === undefined
			? { accessToken: record.accessToken as string }
			: { accessToken: record.accessToken as string, refreshToken: record.refreshToken };
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
		accessToken: undefined,
		refreshToken: undefined,
	};
}

function parseDocument(raw: RawDocument, path: string): CredentialsDocument | undefined {
	const { version, storeId, encryption, records } = raw;
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
	if (
		version !== VERSION ||
		!isString(storeId) ||
		!isObject(encryption) ||
		encryption.kind !== "plaintext" ||
		!isObject(records)
	) {
		throw new CredentialStoreCorruptError(path);
	}
	return { storeId, records: { ...(records as Record<string, JsonValue | undefined>) } };
}

function serializeDocument(document: CredentialsDocument): RawDocument {
	return {
		version: VERSION,
		storeId: document.storeId,
		encryption: { kind: "plaintext" },
		records: document.records as JsonObject,
	};
}

/** A new, empty document with a fresh `storeId`. */
export const emptyDocument = (): CredentialsDocument => ({ storeId: newId(), records: {} });

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
 * directory, `0600` in a `0700` directory on POSIX, never a symbolic link. Creating it does no
 * I/O; the file is read when a token source first needs it.
 */
export function credentialStore(options: CredentialStoreOptions): CredentialStore {
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
				(raw) => serializeDocument(change(parseDocument(raw, path))),
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

	const credentials: CredentialStore = Object.freeze({
		path,
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
	internals.set(credentials, { path, read, update, lockIdentity });
	return credentials;
}
