import { openUrl } from "@crustjs/utils/process";

import { checkUrl } from "./endpoint.ts";

/** Options of {@link openBrowser}. */
export interface OpenBrowserOptions {
	/**
	 * The dev origin, such as `http://127.0.0.1:9000`: plain `http` URLs on exactly this
	 * origin may open. Only for an issuer configured with `allowInsecureLoopback`.
	 */
	allowInsecureLoopbackOrigin?: string | undefined;
}

const LOOPBACK_ORIGIN = /^http:\/\/(?:127\.0\.0\.1|\[::1\])(?::\d+)?$/;

/**
 * Opens `url` in the system browser, best effort. Only `https` URLs (or `http` on
 * the dev origin) without user info or control characters open. Resolves `false` instead of
 * throwing when the URL is refused or no launcher starts; always print the URL as well.
 */
export async function openBrowser(url: string, options: OpenBrowserOptions = {}): Promise<boolean> {
	const devOrigin = options.allowInsecureLoopbackOrigin;
	try {
		const dev =
			url.startsWith("http:") && devOrigin !== undefined && LOOPBACK_ORIGIN.test(devOrigin);
		checkUrl(url, "url", dev ? devOrigin : undefined);
	} catch {
		return false;
	}
	// The launcher refuses control characters, which the URL parser above strips silently.
	return openUrl(url);
}
