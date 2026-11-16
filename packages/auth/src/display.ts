/** Query parameters whose values {@link redactUrl} replaces. */
const SECRET_PARAMS = new Set([
	"code",
	"state",
	"access_token",
	"refresh_token",
	"id_token",
	"client_secret",
	"code_verifier",
	"device_code",
	"token",
	"assertion",
]);

const REDACTED = "[REDACTED]";
const MAX_DISPLAY_LENGTH = 200;

/**
 * Returns `url` with the values of credential-bearing query parameters (`code`, `state`,
 * tokens, secrets, `device_code`, `assertion`) replaced by `[REDACTED]`, matched after
 * decoding. A password in the authority and any fragment are redacted too. A string that
 * is not an absolute URL is returned as `[REDACTED]`.
 */
export function redactUrl(url: string): string {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return REDACTED;
	}
	if (parsed.password) parsed.password = "REDACTED";
	const query = [...parsed.searchParams]
		.map(
			([name, value]) =>
				`${encodeURIComponent(name)}=${SECRET_PARAMS.has(name) ? REDACTED : encodeURIComponent(value)}`,
		)
		.join("&");
	parsed.search = "";
	parsed.hash = "";
	return `${parsed.href}${query ? `?${query}` : ""}${url.includes("#") ? `#${REDACTED}` : ""}`;
}

// ESC sequences (CSI, OSC/DCS/APC/PM/SOS strings, two-byte escapes) and the 8-bit C1 CSI.
const ESCAPE_SEQUENCE =
	// oxlint-disable-next-line no-control-regex -- matching control characters is the point.
	/\x1b\[[0-?]*[ -/]*[@-~]|\x1b[\]PX^_][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[\s\S]?|\x9b[0-?]*[ -/]*[@-~]/g;
// oxlint-disable-next-line no-control-regex -- matching control characters is the point.
const CONTROL_CHARACTER = /[\x00-\x1f\x7f-\x9f]/g;

/**
 * Makes a server-supplied string safe to print on a terminal or page: removes
 * escape sequences and every C0 and C1 control character (including CR, LF and TAB) and DEL,
 * then truncates to 200 characters.
 */
export function sanitizeDisplay(text: string): string {
	return text
		.replace(ESCAPE_SEQUENCE, "")
		.replace(CONTROL_CHARACTER, "")
		.slice(0, MAX_DISPLAY_LENGTH);
}

/** Input of {@link deviceCodeMessage}. */
export interface DeviceCodeMessageOptions {
	/** Your CLI's name, shown in the first line. */
	app: string;
	/** The `userCode` from `startDeviceFlow()`. */
	userCode: string;
	/** The `verificationUri` from `startDeviceFlow()`. */
	verificationUri: string;
}

/**
 * The default device-login instructions: the verification URL and its
 * host, the code, and the anti-phishing warning. Every value is sanitized.
 */
export function deviceCodeMessage(options: DeviceCodeMessageOptions): string {
	const uri = sanitizeDisplay(options.verificationUri);
	let host = uri;
	try {
		host = new URL(uri).host;
	} catch {
		// startDeviceFlow() validates the URI; a hand-written one prints as given.
	}
	return [
		`To sign in to ${sanitizeDisplay(options.app)}, open: ${uri}   (host: ${host})`,
		`Enter this code:           ${sanitizeDisplay(options.userCode)}`,
		"Only continue if you started this sign-in yourself, from this terminal.",
		"The page should show the same code. If anyone sent you this link or code, do not enter it.",
	].join("\n");
}
