import { isCI } from "@crustjs/utils/terminal";

import type { LoginMode, LoginModeOptions } from "./types.ts";

/**
 * Chooses the login to run (SEC-L5, DEC-14), first match wins:
 * 1. `device` or `noBrowser` (the user opted in): `"device"`, even on CI;
 * 2. `CI` set: `"refuse"`, since nobody asked for a code someone else might approve;
 * 3. no terminal (stdin, and stdout or stderr, not TTYs): `"refuse"`, since nobody is there
 *    to read a code and an unattended run would wait until it expires;
 * 4. a terminal, but no browser here (an SSH session, or Linux without a display): `"device"`;
 * 5. otherwise `"browser"`.
 *
 * On `"refuse"`, throw `LoginRequiresInteractionError` naming your device-login flag and token
 * variable. It does not check that the server offers a device login: `startDeviceFlow()`
 * throws `OAuthConfigError` (`unsupported`) when it does not.
 */
export function detectLoginMode(options: LoginModeOptions = {}): LoginMode {
	if (options.device || options.noBrowser) return "device";
	const env = options.env ?? process.env;
	if (isCI(env)) return "refuse";
	const stdin = options.stdin ?? process.stdin;
	const stdout = options.stdout ?? process.stdout;
	const stderr = options.stderr ?? process.stderr;
	if (stdin.isTTY !== true || (stdout.isTTY !== true && stderr.isTTY !== true)) return "refuse";
	const ssh = !!(env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY);
	const display =
		(options.platform ?? process.platform) !== "linux" || !!(env.DISPLAY || env.WAYLAND_DISPLAY);
	return !ssh && display ? "browser" : "device";
}
