import type { CommandSnapshot } from "./command/snapshot.ts";

// ────────────────────────────────────────────────────────────────────────────
// CrustErrorCode — Discriminated error codes
// ────────────────────────────────────────────────────────────────────────────

export interface CommandNotFoundErrorDetails {
	input: string;
	available: string[];
	commandPath: string[];
	parentCommand: CommandSnapshot;
}

export interface ValidationErrorDetails {
	issues: readonly { readonly message: string; readonly path: string }[];
}

export interface ParseErrorDetails {
	readonly flag?: string;
	readonly argument?: string;
	readonly value?: string;
	readonly reason?: string;
}

export interface DefinitionErrorDetails {
	readonly subject?: "arg" | "command" | "flag" | "middleware" | "plugin";
	readonly name?: string;
	readonly reason?: string;
}

export interface CrustErrorDetailsMap {
	DEFINITION: DefinitionErrorDetails | undefined;
	VALIDATION: ValidationErrorDetails | undefined;
	PARSE: ParseErrorDetails | undefined;
	COMMAND_NOT_FOUND: CommandNotFoundErrorDetails;
}

/**
 * All possible error codes emitted by Crust.
 *
 * - `DEFINITION` — Invalid command configuration (empty name, alias collision, bad variadic position, unsupported definition such as async `parse`)
 * - `VALIDATION` — Missing required arguments or flags
 * - `PARSE` — Argv parsing failures (unknown flags, type coercion)
 * - `COMMAND_NOT_FOUND` — Unrecognised subcommand at the current level
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
export type CrustErrorDetails<C extends CrustErrorCode> = CrustErrorDetailsMap[C];

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
export class CrustError<C extends CrustErrorCode = CrustErrorCode> extends Error {
	/** Machine-readable error code for programmatic handling */
	readonly code: C;
	/** Structured payload for programmatic handling */
	readonly details: CrustErrorDetails<C>;
	/** Optional wrapped original error/value */
	override cause?: unknown;

	constructor(
		code: C,
		message: string,
		...details: undefined extends CrustErrorDetails<C>
			? [] | [CrustErrorDetails<C>]
			: [CrustErrorDetails<C>]
	) {
		super(message);
		this.name = "CrustError";
		this.code = code;
		this.details = details[0] as CrustErrorDetails<C>;
	}

	static is(value: unknown): value is CrustError {
		return value instanceof CrustError;
	}

	static definition(message: string, details?: DefinitionErrorDetails): CrustError<"DEFINITION"> {
		return new CrustError("DEFINITION", message, details);
	}

	static parse(message: string, details?: ParseErrorDetails): CrustError<"PARSE"> {
		return new CrustError("PARSE", message, details);
	}

	static validation(message: string, details?: ValidationErrorDetails): CrustError<"VALIDATION"> {
		return new CrustError("VALIDATION", message, details);
	}

	static commandNotFound(
		message: string,
		details: CommandNotFoundErrorDetails,
	): CrustError<"COMMAND_NOT_FOUND"> {
		return new CrustError("COMMAND_NOT_FOUND", message, details);
	}

	is<T extends CrustErrorCode>(code: T): this is CrustError<T> {
		return (this.code as CrustErrorCode) === code;
	}

	withCause(cause: unknown): this {
		this.cause = cause;
		return this;
	}

	toJSON(): {
		code: C;
		message: string;
		details: CrustErrorDetails<C>;
	} {
		return {
			code: this.code,
			message: this.message,
			details: this.details,
		};
	}
}
