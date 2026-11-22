import { lstat } from "node:fs/promises";
import { connect } from "node:net";

import { importKey } from "./cipher.ts";
import { AbortError, CredentialKeyError, LoginRequiredError } from "./errors.ts";
import { throwIfAborted } from "./http.ts";
import type { KeyringOptions } from "./types.ts";

// The OS keyring holds one entry per app, `service=<app>`, `name="credentials-key"`: the key that
// encrypts the tokens in the credentials file, `{ keyId, key }`. It is created once and never
// rewritten; the file records the `keyId` of the key its records are encrypted under, and the
// backend that holds it: the two backends address different native entries on Linux and Windows.

/** The OS keyring backends: `Bun.secrets` on Bun, the optional `@napi-rs/keyring` on Node. */
export type KeyringKind = "bun-secrets" | "napi-keyring";

/** An OS keyring as this package uses it. */
export interface KeyringBackend {
	readonly kind: KeyringKind;
	/** The stored value, or `undefined` when there is none. */
	get(service: string, name: string): Promise<string | undefined>;
	set(service: string, name: string, value: string): Promise<void>;
}

/** The part of `Bun.secrets` this package calls. */
interface BunSecrets {
	get(options: { service: string; name: string }): Promise<string | null>;
	set(options: { service: string; name: string; value: string; persist: "local" }): Promise<void>;
}

const ENTRY = "credentials-key";

async function load(): Promise<KeyringBackend | undefined> {
	const secrets = (globalThis as { Bun?: { secrets?: BunSecrets } }).Bun?.secrets;
	if (secrets) {
		return {
			kind: "bun-secrets",
			get: async (service, name) => (await secrets.get({ service, name })) ?? undefined,
			// On Windows, keeps the key on this computer instead of roaming it to others (Bun 1.4.3+;
			// earlier versions ignore it).
			set: (service, name, value) => secrets.set({ service, name, value, persist: "local" }),
		};
	}
	let napi: typeof import("@napi-rs/keyring");
	try {
		napi = await import("@napi-rs/keyring");
	} catch {
		return undefined;
	}
	// Constructing an entry connects to the session bus synchronously on Linux: a bus that never
	// answers would block the event loop past every deadline (libdbus waits 25 s for `Hello`), so
	// it must answer a probe first. Its Secret Service is not probed: when it does not answer, the
	// constructor still blocks for its 2 s proxy timeout (dbus-secret-service 4.1.0).
	// Only an answer is remembered: a bus that failed is probed again by the next call.
	let busAnswered = false;
	let probing: Promise<boolean | undefined> | undefined;
	const entry = async (service: string, name: string) => {
		if (process.platform === "linux" && !busAnswered) {
			probing ??= sessionBusAddress()
				.then(busAnswers)
				.finally(() => {
					probing = undefined;
				});
			if ((await probing) === false) throw new Error("The D-Bus session bus does not answer");
			busAnswered = true;
		}
		// Linux's default falls back to the in-memory keyutils store, which loses the key at reboot.
		return new napi.AsyncEntry(service, name, { linux: { store: "secret-service" } });
	};
	return {
		kind: "napi-keyring",
		get: async (service, name) => (await (await entry(service, name)).getPassword()) ?? undefined,
		set: async (service, name, value) => (await entry(service, name)).setPassword(value),
	};
}

/**
 * The session bus address libdbus connects to (dbus `init_session_address`): a non-empty
 * `DBUS_SESSION_BUS_ADDRESS`, else `$XDG_RUNTIME_DIR/bus` when it is a socket of this user
 * (`_dbus_lookup_user_bus`). `undefined` for libdbus' last resort, `autolaunch:`, which is not
 * probed.
 */
export async function sessionBusAddress(): Promise<string | undefined> {
	const variable = process.env.DBUS_SESSION_BUS_ADDRESS;
	if (variable) return variable;
	const runtimeDir = process.env.XDG_RUNTIME_DIR;
	if (runtimeDir === undefined) return undefined;
	const path = `${runtimeDir}/bus`;
	try {
		const found = await lstat(path);
		if (!found.isSocket() || found.uid !== process.getuid?.()) return undefined;
	} catch {
		return undefined;
	}
	// Escaped as a D-Bus address value, so `,`, `;` and `%` in the path survive the parsing.
	return `unix:path=${encodeURIComponent(path)}`;
}

/** The socket of one `unix:path=` or `unix:abstract=` D-Bus address. */
function busSocket(address: string): string | undefined {
	if (!address.startsWith("unix:")) return undefined;
	const fields = new Map(
		address
			.slice("unix:".length)
			.split(",")
			.map((field) => [field.slice(0, field.indexOf("=")), field.slice(field.indexOf("=") + 1)]),
	);
	const path = fields.get("path");
	const abstract = fields.get("abstract");
	try {
		// D-Bus escapes address bytes as `%xx`.
		if (path !== undefined) return decodeURIComponent(path);
		if (abstract !== undefined) return `\0${decodeURIComponent(abstract)}`;
	} catch {
		return undefined;
	}
	return undefined;
}

/**
 * Whether the D-Bus session bus at `address` authenticates this user (`EXTERNAL`) and answers
 * `Hello` within the keyring deadline, trying the addresses of a `;` list in order, as libdbus
 * does. `undefined`: not probed, as there is no address or one of them is not a `unix:path=` or
 * `unix:abstract=` one. It does not show that the Secret Service behind the bus answers.
 */
export async function busAnswers(address: string | undefined): Promise<boolean | undefined> {
	const sockets = (address ?? "")
		.split(";")
		.filter(Boolean)
		.map((one) => busSocket(one));
	if (sockets.length === 0 || sockets.includes(undefined)) return undefined;
	// One deadline for the whole list.
	const deadline = performance.now() + keyrings.deadlineMs;
	for (const path of sockets as string[]) {
		const remaining = deadline - performance.now();
		if (remaining <= 0) return false;
		if (await socketAnswers(path, remaining)) return true;
	}
	return false;
}

/**
 * The D-Bus `Hello` method call, serial 1, with no body (D-Bus specification, "Message
 * Protocol": "Message Format" for the header, "Type System" for the marshaling). Every
 * connection must send it after authenticating; a bus that answers it is up.
 */
function helloCall(): Buffer {
	const bytes: number[] = [];
	const align = (size: number) => {
		while (bytes.length % size !== 0) bytes.push(0);
	};
	const uint32 = (value: number) => {
		align(4);
		bytes.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, value >>> 24);
	};
	// A header field: aligned to 8, its code, a one-type variant signature, then the string.
	const field = (code: number, type: "o" | "s", value: string) => {
		align(8);
		bytes.push(code, 1, type.charCodeAt(0), 0);
		uint32(value.length);
		bytes.push(...Buffer.from(value, "latin1"), 0);
	};
	// Little endian, METHOD_CALL, no flags, protocol 1, no body, serial 1.
	bytes.push("l".charCodeAt(0), 1, 0, 1);
	uint32(0);
	uint32(1);
	uint32(0);
	const fieldsStart = bytes.length;
	field(1, "o", "/org/freedesktop/DBus"); // PATH
	field(2, "s", "org.freedesktop.DBus"); // INTERFACE
	field(3, "s", "Hello"); // MEMBER
	field(6, "s", "org.freedesktop.DBus"); // DESTINATION
	const length = bytes.length - fieldsStart;
	bytes.splice(12, 4, length & 0xff, (length >>> 8) & 0xff, 0, 0);
	// The header ends on an 8-byte boundary, where the (empty) body starts.
	align(8);
	return Buffer.from(bytes);
}

/**
 * Whether the bus at `path` authenticates this user and answers `Hello` (a method return, or
 * an error) within `timeoutMs`: libdbus waits up to 25 s for that answer, blocking the thread.
 */
function socketAnswers(path: string, timeoutMs: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = connect(path);
		let received = Buffer.alloc(0);
		let authenticated = false;
		const done = (answers: boolean) => {
			clearTimeout(timer);
			socket.destroy();
			resolve(answers);
		};
		const timer = setTimeout(() => done(false), timeoutMs);
		socket.on("connect", () => {
			const uid = Buffer.from(String(process.getuid?.() ?? "")).toString("hex");
			socket.write(`\0AUTH EXTERNAL ${uid}\r\n`);
		});
		socket.on("data", (chunk: Buffer) => {
			received = Buffer.concat([received, chunk]);
			if (!authenticated) {
				const end = received.indexOf("\r\n");
				if (end === -1) return;
				if (!received.subarray(0, end).toString("latin1").startsWith("OK ")) return done(false);
				authenticated = true;
				received = received.subarray(end + 2);
				socket.write(Buffer.concat([Buffer.from("BEGIN\r\n"), helloCall()]));
			}
			// The first message's type: 2 METHOD_RETURN, 3 ERROR.
			if (received.length >= 2) done(received[1] === 2 || received[1] === 3);
		});
		socket.on("error", () => done(false));
		socket.on("close", () => done(false));
	});
}

/** How this package reaches the OS keyring. Tests replace `load` and shorten `deadlineMs`. */
export const keyrings: {
	load: () => Promise<KeyringBackend | undefined>;
	deadlineMs: number;
} = { load, deadlineMs: 5_000 };

/** A validated file key, and the backend that holds it. */
export interface FileKey {
	readonly keyId: string;
	readonly key: CryptoKey;
	readonly keyring: KeyringKind;
}

/** How a write stores a secret: in plaintext, or encrypted under a file key. */
export type WriteKey =
	| { readonly kind: "plaintext" }
	| {
			readonly kind: "sealed";
			readonly fileKey: FileKey;
			/** A login replacing the file's key: the `keyId` the file must still record. */
			readonly replaces: string | undefined;
	  };

type KeyringRead =
	| { readonly state: "unavailable" }
	| { readonly state: "absent" }
	| { readonly state: "invalid" }
	| { readonly state: "found"; readonly fileKey: FileKey; readonly value: string };

const PLAINTEXT: WriteKey = { kind: "plaintext" };
const sealed = (fileKey: FileKey): WriteKey => ({ kind: "sealed", fileKey, replaces: undefined });

/** Apps whose plaintext fallback was reported: once per process. */
const warned = new Set<string>();

/**
 * `promise`, or a rejection once the keyring deadline passes or `signal` aborts
 * (`AbortError`). The native call is not stopped.
 */
function withinDeadline<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const abort = () => reject(new AbortError());
		const timer = setTimeout(() => reject(new Error("keyring deadline")), keyrings.deadlineMs);
		signal?.addEventListener("abort", abort, { once: true });
		void promise.then(resolve, reject).finally(() => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", abort);
		});
	});
}

function parseValue(value: string): { keyId: string; bytes: Uint8Array<ArrayBuffer> } | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return undefined;
	}
	if (typeof parsed !== "object" || parsed === null) return undefined;
	const { keyId, key } = parsed as { keyId?: unknown; key?: unknown };
	if (typeof keyId !== "string" || keyId === "" || typeof key !== "string") return undefined;
	const bytes = Buffer.from(key, "base64url");
	if (bytes.length !== 32 || bytes.toString("base64url") !== key) return undefined;
	return { keyId, bytes: new Uint8Array(bytes) };
}

/** The file key of what a credentials file stores: `undefined` options mean no keyring at all. */
export interface FileKeys {
	/**
	 * The key of a file encrypted under `keyId`, held by the backend `keyring` (`undefined` for a
	 * file that does not record it): this runtime's keyring must hold it. Never writes.
	 */
	forFile(
		keyId: string,
		keyring: KeyringKind | undefined,
		signal: AbortSignal | undefined,
	): Promise<FileKey>;
	/**
	 * How a write into a file recording `fileKeyId` and `fileKeyring` stores its secret. Creates the key when the
	 * keyring has none. Only a `login` may replace a file key that is missing or another.
	 * `signal` is observed until the key's write is dispatched.
	 */
	forWrite(
		fileKeyId: string | undefined,
		fileKeyring: KeyringKind | undefined,
		login: boolean,
		signal: AbortSignal | undefined,
	): Promise<WriteKey>;
	/**
	 * Where the key of a file recording `fileKeyId` and `fileKeyring` is (the file's backend when
	 * it records one), and whether this runtime can read it. Never writes.
	 */
	status(
		fileKeyId: string | undefined,
		fileKeyring: KeyringKind | undefined,
		signal: AbortSignal | undefined,
	): Promise<{ kind: KeyringKind | "file"; keyReadable: boolean }>;
}

/**
 * The file key of `app`. `lockKeyInit` runs its function under the app-wide `key-init` lock,
 * which serializes key creation across processes; `signal` cancels only the wait for it.
 */
export function fileKeys(
	app: string,
	options: KeyringOptions | undefined,
	lockKeyInit: (fn: () => Promise<void>, signal: AbortSignal | undefined) => Promise<void>,
): FileKeys {
	let backend: Promise<KeyringBackend | undefined> | undefined;
	// Only a key read back after its creation, or recorded by the file, is kept.
	let validated: FileKey | undefined;
	const opened = () =>
		(backend ??= options ? keyrings.load().catch(() => undefined) : Promise.resolve(undefined));

	async function read(signal: AbortSignal | undefined): Promise<KeyringRead> {
		throwIfAborted(signal);
		const keyring = await opened();
		if (!keyring) return { state: "unavailable" };
		let value: string | undefined;
		try {
			value = await withinDeadline(keyring.get(app, ENTRY), signal);
		} catch (error) {
			if (error instanceof AbortError) throw error;
			return { state: "unavailable" };
		}
		// Only no value is no key: an empty one is an entry this package can't read.
		if (value === undefined) return { state: "absent" };
		const parsed = parseValue(value);
		if (!parsed) return { state: "invalid" };
		return {
			state: "found",
			fileKey: { keyId: parsed.keyId, key: await importKey(parsed.bytes), keyring: keyring.kind },
			value,
		};
	}

	async function forFile(
		keyId: string,
		keyring: KeyringKind | undefined,
		signal: AbortSignal | undefined,
	): Promise<FileKey> {
		if (validated?.keyId === keyId) return validated;
		const found = await read(signal);
		if (found.state === "invalid" || found.state === "unavailable") {
			throw new CredentialKeyError("unreadable");
		}
		if (found.state === "absent" || found.fileKey.keyId !== keyId) {
			// Bun.secrets and @napi-rs/keyring address different entries on Linux and Windows.
			if (keyring !== undefined && keyring !== (await opened())?.kind) {
				throw new LoginRequiredError("key-other-keyring");
			}
			throw new LoginRequiredError(found.state === "absent" ? "key-missing" : "key-mismatch");
		}
		validated = found.fileKey;
		return validated;
	}

	/** The keyring's key, created when there is none. Re-reads under the lock: never a cached absence. */
	function create(signal: AbortSignal | undefined): Promise<FileKey> {
		const outcome = Promise.withResolvers<FileKey>();
		lockKeyInit(async () => {
			const found = await read(signal);
			if (found.state === "found") return outcome.resolve(found.fileKey);
			if (found.state !== "absent") {
				return outcome.reject(
					new CredentialKeyError(found.state === "invalid" ? "unreadable" : "unavailable"),
				);
			}
			// The last moment a cancelled call writes nothing.
			if (signal?.aborted) return outcome.reject(new AbortError());
			const bytes = crypto.getRandomValues(new Uint8Array(32));
			const value = JSON.stringify({
				keyId: crypto.randomUUID(),
				key: Buffer.from(bytes).toString("base64url"),
			});
			// The caller waits for the deadline at most; the lock is held until the write settles,
			// so the next creator reads what it wrote instead of writing a second key.
			const timer = setTimeout(
				() => outcome.reject(new CredentialKeyError("unavailable")),
				keyrings.deadlineMs,
			);
			try {
				await (await opened())!.set(app, ENTRY, value);
				const back = await read(undefined);
				if (back.state !== "found" || back.value !== value) throw new Error("key not stored");
				validated = back.fileKey;
				outcome.resolve(back.fileKey);
			} catch {
				outcome.reject(new CredentialKeyError("unavailable"));
			} finally {
				clearTimeout(timer);
			}
		}, signal).catch((error: unknown) => outcome.reject(error));
		return outcome.promise;
	}

	async function forWrite(
		fileKeyId: string | undefined,
		fileKeyring: KeyringKind | undefined,
		login: boolean,
		signal: AbortSignal | undefined,
	): Promise<WriteKey> {
		if (fileKeyId !== undefined && (!login || validated?.keyId === fileKeyId)) {
			return sealed(await forFile(fileKeyId, fileKeyring, signal));
		}
		if (fileKeyId === undefined && !options) return PLAINTEXT;
		const found = await read(signal);
		// A file with a key never takes plaintext, and an unreadable key is never replaced.
		if (found.state === "invalid" || (found.state === "unavailable" && fileKeyId !== undefined)) {
			throw new CredentialKeyError("unreadable");
		}
		if (found.state === "unavailable") {
			if (options?.strict) throw new CredentialKeyError("unavailable");
			if (!warned.has(app)) {
				warned.add(app);
				options?.onWarning?.({ code: "plaintext-storage" });
			}
			return PLAINTEXT;
		}
		if (found.state === "found" && (fileKeyId === undefined || found.fileKey.keyId === fileKeyId)) {
			if (fileKeyId !== undefined) validated = found.fileKey;
			return sealed(found.fileKey);
		}
		// The first key, or a login replacing a file key the keyring no longer holds.
		const fileKey = await create(signal);
		return {
			kind: "sealed",
			fileKey,
			replaces: fileKey.keyId === fileKeyId ? undefined : fileKeyId,
		};
	}

	async function status(
		fileKeyId: string | undefined,
		fileKeyring: KeyringKind | undefined,
		signal: AbortSignal | undefined,
	) {
		throwIfAborted(signal);
		const keyring = await opened();
		if (!keyring) return { kind: fileKeyring ?? ("file" as const), keyReadable: false };
		if (fileKeyId !== undefined && validated?.keyId === fileKeyId) {
			return { kind: fileKeyring ?? keyring.kind, keyReadable: true };
		}
		const found = await read(signal);
		// Without a key in the file, a keyring that does not answer means plaintext writes.
		if (found.state === "unavailable" && fileKeyId === undefined) {
			return { kind: "file" as const, keyReadable: false };
		}
		const keyReadable =
			found.state === "found" && (fileKeyId === undefined || found.fileKey.keyId === fileKeyId);
		return { kind: fileKeyring ?? keyring.kind, keyReadable };
	}

	return { forFile, forWrite, status };
}
