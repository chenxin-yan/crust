import type { AnyCommand } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// CrustErrorCode — Discriminated error codes
// ────────────────────────────────────────────────────────────────────────────

export interface CommandNotFoundErrorDetails {
	input: string;
	available: string[];
	commandPath: string[];
	parentCommand: AnyCommand;
}

export interface CrustErrorDetailsMap {
	DEFINITION: undefined;
	VALIDATION: undefined;
	PARSE: undefined;
	EXECUTION: undefined;
	COMMAND_NOT_FOUND: CommandNotFoundErrorDetails;
}

/**
 * All possible error codes emitted by Crust.
 *
 * - `DEFINITION` — Invalid command configuration (empty name, alias collision, bad variadic position)
 * - `VALIDATION` — Missing required arguments or flags
 * - `PARSE` — Argv parsing failures (unknown flags, type coercion)
 * - `EXECUTION` — Runtime command/middleware failures
 *
 * @example
 * ```ts
 * try {
 *   parseArgs(cmd, argv);
 * } catch (err) {
 *   if (err instanceof CrustError) {
 *     switch (err.code) {
 *       case "VALIDATION":
 *         console.error(err.message);
 *         showHelp(cmd);
 *         break;
 *       case "PARSE":
 *         console.error(err.message);
 *         break;
 *     }
 *   }
 * }
 * ```
 */
export type CrustErrorCode = keyof CrustErrorDetailsMap;
export type CrustErrorDetails<C extends CrustErrorCode> =
	CrustErrorDetailsMap[C];

// ────────────────────────────────────────────────────────────────────────────
// CrustError — Custom error class
// ────────────────────────────────────────────────────────────────────────────

/**
 * A typed error thrown by Crust when command definition or argument parsing fails.
 *
 * Every `CrustError` carries a {@link CrustErrorCode} that identifies the specific
 * failure, enabling programmatic error handling without fragile message parsing.
 *
 * @example
 * ```ts
 * import { CrustError, parseArgs } from "@crustjs/core";
 *
 * try {
 *   const result = parseArgs(cmd, process.argv.slice(2));
 * } catch (err) {
 *   if (err instanceof CrustError) {
 *     console.error(`[${err.code}] ${err.message}`);
 *   }
 * }
 * ```
 */
export class CrustError<
	C extends CrustErrorCode = CrustErrorCode,
> extends Error {
	/** Machine-readable error code for programmatic handling */
	readonly code: C;
	/** Structured payload for programmatic handling */
	readonly details: CrustErrorDetails<C>;
	/** Optional wrapped original error/value */
	override cause?: unknown;

	constructor(
		code: C,
		message: string,
		...details: CrustErrorDetails<C> extends undefined
			? [] | [undefined]
			: [CrustErrorDetails<C>]
	) {
		super(message);
		this.name = "CrustError";
		this.code = code;
		this.details = details[0] as CrustErrorDetails<C>;
	}

	is<T extends CrustErrorCode>(code: T): this is CrustError<T> {
		return (this.code as CrustErrorCode) === code;
	}

	withCause(cause: unknown): this {
		this.cause = cause;
		return this;
	}
}
