import { spawn } from "node:child_process";

import { checkUrl } from "./endpoint.ts";

/** Options of {@link openBrowser}. */
export interface OpenBrowserOptions {
	/**
	 * The dev origin, such as `http://127.0.0.1:9000`: plain `http` URLs on exactly this
	 * origin may open. Only for an issuer configured with `allowInsecureLoopback`.
	 */
	allowInsecureLoopbackOrigin?: string;
}

/** The system launcher and its arguments; the URL is always one argv element. */
export function browserCommand(
	url: string,
	platform: string = process.platform,
): [string, string[]] {
	if (platform === "darwin") return ["open", [url]];
	// Not `cmd /c start`: cmd.exe would treat `&` in the URL as a command separator.
	if (platform === "win32") return ["rundll32", ["url.dll,FileProtocolHandler", url]];
	return ["xdg-open", [url]];
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
		// oxlint-disable-next-line no-control-regex -- matching control characters is the point.
		if (/[\x00-\x1f\x7f-\x9f]/.test(url)) return false;
		const dev =
			url.startsWith("http:") && devOrigin !== undefined && LOOPBACK_ORIGIN.test(devOrigin);
		checkUrl(url, "url", dev ? devOrigin : undefined);
	} catch {
		return false;
	}
	const [command, args] = browserCommand(url);
	return new Promise((resolve) => {
		try {
			const child = spawn(command, args, {
				shell: false,
				stdio: "ignore",
				detached: true,
				windowsHide: true,
			});
			// A missing launcher is an async 'error' event; without a listener it would crash the process.
			child.once("error", () => resolve(false));
			child.once("spawn", () => {
				child.unref();
				resolve(true);
			});
		} catch {
			resolve(false);
		}
	});
}
