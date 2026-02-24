// ────────────────────────────────────────────────────────────────────────────
// StoreErrorCode — Discriminated error codes for @crustjs/store
// ────────────────────────────────────────────────────────────────────────────

/**
 * Contextual details attached to a `PATH` error.
 *
 * Returned when the resolved or provided config file path is invalid.
 */
export interface PathErrorDetails {
	/** The path value that caused the error. */
	path: string;
}

/**
 * Contextual details attached to a `PARSE` error.
 *
 * Returned when the persisted JSON file cannot be parsed.
 */
export interface ParseErrorDetails {
	/** Absolute path to the file that failed parsing. */
	path: string;
}

/**
 * Contextual details attached to a `VALIDATION` error.
 *
 * Returned when the user-provided validator rejects a config value.
 */
export interface ValidationErrorDetails {
	/** Absolute path to the config file involved, if available. */
	path?: string;
}

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
 * Maps each {@link StoreErrorCode} to its structured details type.
 *
 * Used internally for conditional constructor parameters and type narrowing.
 */
export interface StoreErrorDetailsMap {
	PATH: PathErrorDetails;
	PARSE: ParseErrorDetails;
	VALIDATION: ValidationErrorDetails | undefined;
	IO: IOErrorDetails;
}

/**
 * All possible error codes emitted by `@crustjs/store`.
 *
 * - `PATH` — Invalid or unsupported config file path
 * - `PARSE` — Malformed JSON in persisted config file
 * - `VALIDATION` — User-provided validator rejected a config value
 * - `IO` — Filesystem read, write, or delete failure
 *
 * @example
 * ```ts
 * import { CrustStoreError } from "@crustjs/store";
 *
 * try {
 *   const config = await store.read();
 * } catch (err) {
 *   if (err instanceof CrustStoreError) {
 *     switch (err.code) {
 *       case "PARSE":
 *         console.error(`Corrupt config at ${err.details.path}`);
 *         break;
 *       case "IO":
 *         console.error(`File ${err.details.operation} failed: ${err.message}`);
 *         break;
 *     }
 *   }
 * }
 * ```
 */
export type StoreErrorCode = keyof StoreErrorDetailsMap;

/** Resolves the details type for a given {@link StoreErrorCode}. */
export type StoreErrorDetails<C extends StoreErrorCode> =
	StoreErrorDetailsMap[C];

// ────────────────────────────────────────────────────────────────────────────
// CrustStoreError — Custom error class
// ────────────────────────────────────────────────────────────────────────────

/**
 * A typed error thrown by `@crustjs/store` for path, parse, validation, and IO failures.
 *
 * Every `CrustStoreError` carries a {@link StoreErrorCode} that identifies the failure
 * category, along with structured {@link StoreErrorDetails} for programmatic handling
 * without fragile message parsing.
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
export class CrustStoreError<
	C extends StoreErrorCode = StoreErrorCode,
> extends Error {
	/** Machine-readable error code for programmatic handling. */
	readonly code: C;

	/** Structured payload with context about the failure. */
	readonly details: StoreErrorDetails<C>;

	/** Optional wrapped original error or value. */
	override cause?: unknown;

	constructor(
		code: C,
		message: string,
		...details: undefined extends StoreErrorDetails<C>
			? [] | [StoreErrorDetails<C>]
			: [StoreErrorDetails<C>]
	) {
		super(message);
		this.name = "CrustStoreError";
		this.code = code;
		this.details = details[0] as StoreErrorDetails<C>;
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
		return (this.code as StoreErrorCode) === code;
	}

	/**
	 * Attaches a cause to this error for stack-trace chaining.
	 *
	 * Returns `this` for fluent usage.
	 *
	 * @example
	 * ```ts
	 * throw new CrustStoreError("IO", "write failed", {
	 *   path: "/path/to/config.json",
	 *   operation: "write",
	 * }).withCause(originalError);
	 * ```
	 */
	withCause(cause: unknown): this {
		this.cause = cause;
		return this;
	}
}
