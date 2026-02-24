// ────────────────────────────────────────────────────────────────────────────
// @crustjs/store — Validator execution helper
// ────────────────────────────────────────────────────────────────────────────

import { CrustStoreError } from "./errors.ts";
import type { StoreConfigShape, StoreValidator } from "./types.ts";

/**
 * Runs an optional user-provided validator on a config value.
 *
 * When `validate` is `undefined`, returns the input cast to `TConfig` (no-op).
 * When the validator throws, the error is normalized into a `CrustStoreError` with
 * `VALIDATION` code and the original error attached as `cause`.
 *
 * @param input - The value to validate (typically parsed JSON or a merged config).
 * @param validate - Optional validator function `(input: unknown) => TConfig`.
 * @param filePath - Optional config file path for error context.
 * @returns The validated config value.
 * @throws {CrustStoreError} `VALIDATION` if the validator rejects the input.
 */
export function runValidation<TConfig extends StoreConfigShape>(
	input: unknown,
	validate: StoreValidator<TConfig> | undefined,
	filePath?: string,
): TConfig {
	if (validate === undefined) {
		return input as TConfig;
	}

	try {
		return validate(input);
	} catch (err: unknown) {
		const message =
			err instanceof Error
				? `Validation failed: ${err.message}`
				: "Validation failed";

		throw new CrustStoreError(
			"VALIDATION",
			message,
			filePath !== undefined ? { path: filePath } : undefined,
		).withCause(err);
	}
}
