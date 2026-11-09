import type { JsonValue } from "@crustjs/utils/json";

import { CrustError } from "../errors.ts";

/**
 * Coerce a raw argv string into a {@link URL} instance via the WHATWG
 * `URL` parser. Any protocol accepted by `new URL()` (https, http, file,
 * ftp, …) is allowed.
 *
 * Throws `CrustError("PARSE", …)` when the input is not a valid URL.
 * The message names `label`, never the input. When the input clearly
 * lacks a URL scheme, we append a hint reminding the user to include
 * one — a common foot-gun on the command line.
 */
export function coerceUrl(raw: string, label: string): URL {
	try {
		return new URL(raw);
	} catch {
		// No cause: Bun's URL error quotes the input.
		// WHATWG-style scheme: ASCII letter followed by letters/digits/+/-/.
		// then a colon. Matches `http:`, `file:`, `git+ssh:`, etc.
		const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw);
		const hint = hasScheme ? "" : " (missing protocol — e.g. https://example.com)";
		throw new CrustError("PARSE", `Invalid URL for ${label}${hint}.`);
	}
}

/**
 * Coerce a raw argv string into an absolute filesystem path.
 *
 * Steps:
 * 1. Reject empty input.
 * 2. Expand a leading `~` (followed by `/` or end-of-string) to the user's
 *    home directory. `~username` is intentionally NOT expanded.
 * 3. Resolve against `process.cwd()` so the result is always absolute.
 *
 * Path-traversal (`..`) is allowed — coercion does not sandbox.
 */
export function coercePath(raw: string, label: string): string {
	if (raw === "") {
		throw new CrustError("PARSE", `Path for ${label} cannot be empty`);
	}
	// A replacer function keeps `$` sequences in the home directory literal.
	const expanded = raw.replace(/^~(?=\/|$)/, () => process.getBuiltinModule("node:os").homedir());
	return process.getBuiltinModule("node:path").resolve(process.cwd(), expanded);
}

/**
 * Coerce a raw argv string into a parsed JSON value (`JsonValue`) via
 * `JSON.parse`. Any valid JSON document is accepted — objects, arrays,
 * strings, numbers, booleans, null.
 *
 * Throws `CrustError("PARSE", …)` naming `label` when the input is not valid
 * JSON, with a shell-quoting hint, since unquoted JSON on the command line is
 * a common foot-gun. The `SyntaxError` is dropped, message and cause: newer
 * engines quote a snippet of the input in it.
 *
 * Note: `JSON.parse` loses precision on integers above `Number.MAX_SAFE_INTEGER`.
 */
export function coerceJson(raw: string, label: string): JsonValue {
	try {
		return JSON.parse(raw);
	} catch {
		throw new CrustError(
			"PARSE",
			`Invalid JSON for ${label}. Tip: wrap JSON in single quotes on the command line, e.g. --flag '{"k":1}'`,
		);
	}
}
