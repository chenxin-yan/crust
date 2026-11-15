import type { StoreValidatorIssue } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// StoreErrorCode — Error codes and their structured details
// ────────────────────────────────────────────────────────────────────────────

/**
 * Contextual details attached to an `IO` error.
 *
 * Returned on filesystem read, write, or delete failures.
 */
export interface IOErrorDetails {
	/** Absolute path to the file involved in the failed operation. */
	path: string;
	/** The filesystem operation that failed (e.g. `"read"`, `"write"`, `"delete"`). */
	operation: "read" | "write" | "delete";
}

/**
 * Contextual details attached to a `VALIDATION` error.
 *
 * Returned when a store validator rejects a config object during
 * read, write, update, or patch operations.
 */
export interface ValidationErrorDetails {
	/** The store operation during which validation failed. */
	operation: "read" | "write" | "update" | "patch";
	/** Structured validation issues for programmatic handling. */
	issues: readonly StoreValidatorIssue[];
}

/** The owner a lock record names, as reported by a `LOCK` error. */
export interface LockOwner {
	/** Random per acquisition; tells this owner's lock from a later owner's at the same path. */
	ownerId: string;
	/** The owner's process id on `host`. */
	pid: number;
	/** `os.hostname()` of the owner. */
	host: string;
	/** `process.platform` of the owner. */
	platform: string;
	/** When the owner acquired the lock (ISO 8601). */
	createdAt: string;
}

/**
 * Contextual details attached to a `LOCK` error.
 *
 * Returned when a strict lock is not acquired before its deadline.
 */
export interface LockErrorDetails {
	/** The file that blocked: the lock file, or its `.recover` file left by an unfinished recovery. */
	path: string;
	/**
	 * Whether the owner of `path` runs (`alive`), cannot be judged from this process (`unknown`), or
	 * provably no longer runs (`dead`, only for a `.recover` file, which is never removed automatically).
	 */
	verdict: "alive" | "unknown" | "dead";
	/** The owner `path` names, or `undefined` when its record is empty or unreadable. */
	owner: LockOwner | undefined;
	/** What a person must do before deleting `path` by hand. */
	manualStep: string;
}

/**
 * Maps each {@link StoreErrorCode} to its structured details type.
 *
 * Used internally for conditional constructor parameters and type narrowing.
 */
export interface StoreErrorDetailsMap {
	PATH: {
		path: string;
		/** Set when a strict store refuses a target that is a symbolic link, or an unsafe directory. */
		reason?: "symlink" | "directory";
	};
	PARSE: { path: string };
	IO: IOErrorDetails;
	VALIDATION: ValidationErrorDetails;
	DEFINITION: undefined;
	LOCK: LockErrorDetails;
}

/**
 * All possible error codes emitted by `@crustjs/store`.
 *
 * - `PATH` — Invalid or unsupported store file path, or (strict stores) a symbolic link or
 *   unsafe directory
 * - `PARSE` — Malformed JSON in persisted config file
 * - `IO` — Filesystem read, write, or delete failure
 * - `VALIDATION` — Config object rejected by a store validator
 * - `DEFINITION` — A field mixes mutually exclusive definition modes, or `strict` is combined
 *   with an `access` other than `"private"`
 * - `LOCK` — A strict lock was not acquired before its deadline
 *
 * @example
 * ```ts
 * import { CrustStoreError } from "@crustjs/store";
 *
 * try {
 *   const config = await store.read();
 * } catch (err) {
 *   if (err instanceof CrustStoreError && err.is("PARSE")) {
 *     console.error(`Corrupt config at ${err.details.path}`);
 *   } else if (err instanceof CrustStoreError && err.is("VALIDATION")) {
 *     for (const issue of err.details.issues) {
 *       console.error(`${issue.path}: ${issue.message}`);
 *     }
 *   } else if (err instanceof CrustStoreError && err.is("IO")) {
 *     console.error(`File ${err.details.operation} failed: ${err.message}`);
 *   }
 * }
 * ```
 */
export type StoreErrorCode = keyof StoreErrorDetailsMap;

/** Resolves the details type for a given {@link StoreErrorCode}. */
export type StoreErrorDetails<C extends StoreErrorCode> = StoreErrorDetailsMap[C];

// ────────────────────────────────────────────────────────────────────────────
// CrustStoreError — Custom error class
// ────────────────────────────────────────────────────────────────────────────

/**
 * A typed error thrown by `@crustjs/store` for path, parse, IO, validation, and lock failures.
 *
 * Every `CrustStoreError` carries a {@link StoreErrorCode} that identifies the failure
 * category. Codes other than `DEFINITION` include structured {@link StoreErrorDetails}
 * for programmatic handling without fragile message parsing.
 *
 * @example
 * ```ts
 * import { CrustStoreError } from "@crustjs/store";
 *
 * try {
 *   const config = await store.read();
 * } catch (err) {
 *   if (err instanceof CrustStoreError && err.is("PARSE")) {
 *     console.error(`Corrupt config at ${err.details.path}`);
 *   }
 * }
 * ```
 */
export class CrustStoreError<C extends StoreErrorCode = StoreErrorCode> extends Error {
	/** Machine-readable error code for programmatic handling. */
	readonly code: C;

	/** Structured payload with context about the failure. */
	readonly details: StoreErrorDetails<C>;

	constructor(
		code: C,
		message: string,
		...[details, cause]: StoreErrorDetails<C> extends undefined
			? [details?: undefined, cause?: unknown]
			: [details: StoreErrorDetails<C>, cause?: unknown]
	) {
		super(message, { cause });
		this.name = "CrustStoreError";
		this.code = code;
		// SAFETY: the conditional details tuple requires a value exactly when this error code owns details.
		this.details = details as StoreErrorDetails<C>;
	}

	/**
	 * Type-guard that narrows this error to a specific {@link StoreErrorCode}.
	 *
	 * When the guard returns `true`, TypeScript narrows the `details` property
	 * to the corresponding details type.
	 *
	 * @example
	 * ```ts
	 * if (err.is("IO")) {
	 *   // err.details is IOErrorDetails
	 *   console.error(err.details.operation, err.details.path);
	 * }
	 * ```
	 */
	is<T extends StoreErrorCode>(code: T): this is CrustStoreError<T> {
		return Object.is(this.code, code);
	}
}
