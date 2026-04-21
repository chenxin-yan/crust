import type { AnsiPair } from "./ansiCodes.ts";
import { applyStyle } from "./styleEngine.ts";

const OSC = "\x1b]";
const ST = "\x1b\\";
const HYPERLINK_CLOSE = `${OSC}8;;${ST}`;
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

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
			`Invalid ${label}: must contain only printable ASCII characters.`,
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
 * Create an OSC 8 hyperlink escape pair for a target URL.
 *
 * The returned pair can be applied directly with {@link applyStyle} or used via
 * {@link link} for convenience.
 */
export function linkCode(url: string, options?: HyperlinkOptions): AnsiPair {
	assertPrintableAscii(url, "hyperlink URL");
	const params = serializeParams(options);
	return {
		open: `${OSC}8;${params};${url}${ST}`,
		close: HYPERLINK_CLOSE,
	};
}

/**
 * Wrap text in OSC 8 hyperlink escape sequences.
 */
export function link(
	text: string,
	url: string,
	options?: HyperlinkOptions,
): string {
	return applyStyle(text, linkCode(url, options));
}
