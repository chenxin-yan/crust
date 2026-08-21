import { homedir } from "node:os";
import { resolve } from "node:path";

import type { JsonValue } from "@crustjs/utils/json";

import { CrustError } from "../errors.ts";

/**
 * Coerce a raw argv string into a {@link URL} instance via the WHATWG
 * `URL` parser. Any protocol accepted by `new URL()` (https, http, file,
 * ftp, …) is allowed.
 *
 * Throws `CrustError("PARSE", …)` when the input is not a valid URL.
 * The original input is echoed in the message. When the input clearly
 * lacks a URL scheme, we append a hint reminding the user to include
 * one — a common foot-gun on the command line.
 */
export function coerceUrl(raw: string): URL {
	try {
		return new URL(raw);
	} catch {
		// WHATWG-style scheme: ASCII letter followed by letters/digits/+/-/.
		// then a colon. Matches `http:`, `file:`, `git+ssh:`, etc.
		const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw);
		const hint = hasScheme ? "" : " (missing protocol — e.g. https://example.com)";
		throw new CrustError("PARSE", `Invalid URL "${raw}"${hint}`);
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
export function coercePath(raw: string): string {
	if (raw === "") {
		throw new CrustError("PARSE", "Path cannot be empty");
	}
	const expanded = raw.replace(/^~(?=\/|$)/, homedir());
	return resolve(process.cwd(), expanded);
}

/**
 * Coerce a raw argv string into a parsed JSON value (`unknown`) via
 * `JSON.parse`. Any valid JSON document is accepted — objects, arrays,
 * strings, numbers, booleans, null.
 *
 * Throws `CrustError("PARSE", …)` when the input is not valid JSON.
 * The original `SyntaxError.message` is included plus a shell-quoting
 * hint, since unquoted JSON on the command line is a common foot-gun.
 *
 * Note: `JSON.parse` loses precision on integers above `Number.MAX_SAFE_INTEGER`.
 */
export function coerceJson(raw: string): JsonValue {
	try {
		return JSON.parse(raw);
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		throw new CrustError(
			"PARSE",
			`Invalid JSON: ${reason}. Tip: wrap JSON in single quotes on the command line, e.g. --flag '{"k":1}'`,
		);
	}
}
