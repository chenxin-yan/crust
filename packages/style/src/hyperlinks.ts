import type { AnsiPair } from "./ansiCodes.ts";
import { applyStyle } from "./styleEngine.ts";

const OSC = "\x1b]";
const ST = "\x1b\\";
const HYPERLINK_CLOSE = `${OSC}8;;${ST}`;
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;
const PRINTABLE_ASCII_NO_SPACE = /^[\x21-\x7e]*$/;

export interface HyperlinkOptions {
	/**
	 * Optional OSC 8 hyperlink id used by some terminals to keep visually
	 * separated segments grouped as a single hovered link.
	 */
	readonly id?: string;
}

function assertPrintableAscii(value: string, label: string): void {
	if (!PRINTABLE_ASCII.test(value)) {
		throw new TypeError(
			`Invalid ${label}: ${JSON.stringify(value)} must contain only printable ASCII characters.`,
		);
	}
}

function assertPrintableAsciiNoSpace(value: string, label: string): void {
	if (!PRINTABLE_ASCII_NO_SPACE.test(value)) {
		throw new TypeError(
			`Invalid ${label}: ${JSON.stringify(value)} must contain only printable ASCII characters without spaces.`,
		);
	}
}

function serializeParams(options?: HyperlinkOptions): string {
	const id = options?.id;
	if (id === undefined || id === "") {
		return "";
	}

	assertPrintableAscii(id, "hyperlink id");
	if (id.includes(":") || id.includes(";")) {
		throw new TypeError(
			'Invalid hyperlink id: ":" and ";" are reserved by the OSC 8 format.',
		);
	}

	return `id=${id}`;
}

/**
 * Create an OSC 8 hyperlink escape pair for `url`. The returned
 * {@link AnsiPair} can be applied directly with {@link applyStyle} or
 * composed via {@link composeStyles}; for one-shot use see {@link link}.
 *
 * @param url - Target URL. Must contain only printable ASCII characters
 *   and no spaces (per the OSC 8 spec). URL-encode characters outside
 *   that range before passing.
 * @param options - Optional {@link HyperlinkOptions} — currently just
 *   `id` for grouping multi-segment links.
 * @returns An {@link AnsiPair} whose `open` carries the URL and `close`
 *   terminates the hyperlink.
 * @throws {TypeError} If `url` contains spaces or non-printable ASCII,
 *   or if `options.id` contains `":"` / `";"` (reserved by OSC 8) or
 *   non-printable characters.
 *
 * @example
 * ```ts
 * import { applyStyle, linkCode } from "@crustjs/style";
 *
 * const pair = linkCode("https://crustjs.dev");
 * console.log(applyStyle("docs", pair));
 * ```
 */
export function linkCode(url: string, options?: HyperlinkOptions): AnsiPair {
	assertPrintableAsciiNoSpace(url, "hyperlink URL");
	const params = serializeParams(options);
	return {
		open: `${OSC}8;${params};${url}${ST}`,
		close: HYPERLINK_CLOSE,
	};
}

/**
 * Wrap `text` in OSC 8 hyperlink escape sequences. Equivalent to
 * `applyStyle(text, linkCode(url, options))` but a single call.
 *
 * @param text - The visible label.
 * @param url - Target URL (see {@link linkCode} for the constraints).
 * @param options - Optional {@link HyperlinkOptions}.
 * @returns The styled string.
 * @throws {TypeError} If `url` or `options.id` are invalid — see
 *   {@link linkCode}.
 *
 * @example
 * ```ts
 * import { link } from "@crustjs/style";
 *
 * console.log(link("docs", "https://crustjs.dev"));
 * console.log(link("page 1", "https://example.com/p1", { id: "intro" }));
 * ```
 */
export function link(
	text: string,
	url: string,
	options?: HyperlinkOptions,
): string {
	return applyStyle(text, linkCode(url, options));
}
