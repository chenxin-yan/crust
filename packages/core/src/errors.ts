// ────────────────────────────────────────────────────────────────────────────
// CrustErrorCode — Discriminated error codes
// ────────────────────────────────────────────────────────────────────────────

/**
 * All possible error codes emitted by Crust.
 *
 * - `DEFINITION` — Invalid command configuration (empty name, alias collision, bad variadic position)
 * - `VALIDATION` — Missing required arguments or flags
 * - `PARSE` — Argv parsing failures (unknown flags, type coercion)
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
export type CrustErrorCode = "DEFINITION" | "VALIDATION" | "PARSE";

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
 * import { CrustError, parseArgs } from "@crust/core";
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
export class CrustError extends Error {
	/** Machine-readable error code for programmatic handling */
	readonly code: CrustErrorCode;

	constructor(code: CrustErrorCode, message: string) {
		super(message);
		this.name = "CrustError";
		this.code = code;
	}
}
