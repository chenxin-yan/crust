import type { CommandSnapshot } from "./command/snapshot.ts";

// ────────────────────────────────────────────────────────────────────────────
// CrustErrorCode — Discriminated error codes
// ────────────────────────────────────────────────────────────────────────────

/** Details for a subcommand token that could not be resolved. */
export interface CommandNotFoundErrorDetails {
	/** Unrecognized subcommand token. */
	input: string;
	/** Canonical names of available child commands. */
	available: string[];
	/** Canonical path to the command whose child could not be resolved. */
	commandPath: string[];
	/** Readonly, serializable snapshot of the parent command. */
	parentCommand: CommandSnapshot;
}

/** Aggregated Standard Schema and required-value validation failures. */
export interface ValidationErrorDetails {
	/** Issues normalized under `args.<name>` or `flags.<name>`. */
	issues: readonly { readonly message: string; readonly path: string }[];
}

/** Details for argv syntax or built-in value parsing failures. */
export interface ParseErrorDetails {
	readonly flag?: string;
	readonly argument?: string;
	readonly value?: string;
	readonly reason?: string;
}

/** Details for runtime recipe, Extension, Context, and documentation failures. */
export interface DefinitionErrorDetails {
	readonly subject?: "command" | "context" | "extension" | "flag" | "argument";
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
 * - `DEFINITION` — Runtime recipe, Extension, Context, or documentation definition failure
 * - `VALIDATION` — Missing required arguments or flags
 * - `PARSE` — Argv parsing failures (unknown flags, type coercion)
 * - `COMMAND_NOT_FOUND` — Unrecognised subcommand at the current level
 *
 * @example
 * ```ts
 * try {
 *   await app.run(path, input);
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
 * A typed error for runtime recipe, Extension, Context, documentation, argv, and validation failures.
 *
 * Every `CrustError` carries a {@link CrustErrorCode} that identifies the specific
 * failure, enabling programmatic error handling without fragile message parsing.
 *
 * @example
 * ```ts
 * import { CrustError } from "@crustjs/core";
 *
 * try {
 *   await app.run(["deploy"], { args: { target: "prod" } });
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
