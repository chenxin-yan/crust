import { describe, expect, it } from "vite-plus/test";

import { detectLoginMode } from "./login-mode.ts";
import type { LoginModeOptions } from "./types.ts";

const tty = { isTTY: true };
const pipe = { isTTY: false };
const desktop = { DISPLAY: ":0" };

describe("detectLoginMode", () => {
	it.each<[string, string, LoginModeOptions]>([
		["a desktop terminal", "browser", { env: desktop, stdin: tty, stdout: tty }],
		[
			"stdout piped, stderr a TTY",
			"browser",
			{ env: desktop, stdin: tty, stdout: pipe, stderr: tty },
		],
		["macOS without DISPLAY", "browser", { env: {}, platform: "darwin", stdin: tty, stdout: tty }],
		["Windows without DISPLAY", "browser", { env: {}, platform: "win32", stdin: tty, stdout: tty }],
		[
			"Wayland",
			"browser",
			{ env: { WAYLAND_DISPLAY: "wayland-0" }, platform: "linux", stdin: tty, stdout: tty },
		],
		["Linux without a display", "device", { env: {}, platform: "linux", stdin: tty, stdout: tty }],
		["stdin not a TTY", "refuse", { env: desktop, stdin: pipe, stdout: tty }],
		["no TTY output", "refuse", { env: desktop, stdin: tty, stdout: pipe, stderr: pipe }],
		[
			"no TTY over SSH",
			"refuse",
			{ env: { ...desktop, SSH_CONNECTION: "1 2 3 4" }, stdin: pipe, stdout: pipe, stderr: pipe },
		],
		[
			"no TTY on Linux without a display",
			"refuse",
			{ env: {}, platform: "linux", stdin: pipe, stdout: pipe, stderr: pipe },
		],
		[
			"no TTY with --device",
			"device",
			{ device: true, env: desktop, stdin: pipe, stdout: pipe, stderr: pipe },
		],
		[
			"SSH_CONNECTION",
			"device",
			{ env: { ...desktop, SSH_CONNECTION: "1 2 3 4" }, stdin: tty, stdout: tty },
		],
		["SSH_CLIENT", "device", { env: { ...desktop, SSH_CLIENT: "1 2 3" }, stdin: tty, stdout: tty }],
		["SSH_TTY", "device", { env: { ...desktop, SSH_TTY: "/dev/pts/1" }, stdin: tty, stdout: tty }],
		["CI", "refuse", { env: { ...desktop, CI: "true" }, stdin: tty, stdout: tty }],
		["CI without a TTY", "refuse", { env: { CI: "1" }, stdin: pipe, stdout: pipe }],
		["CI=false", "browser", { env: { ...desktop, CI: "false" }, stdin: tty, stdout: tty }],
		["--device on a desktop", "device", { device: true, env: desktop, stdin: tty, stdout: tty }],
		[
			"--no-browser on a desktop",
			"device",
			{ noBrowser: true, env: desktop, stdin: tty, stdout: tty },
		],
		["--device on CI", "device", { device: true, env: { CI: "true" }, stdin: pipe, stdout: pipe }],
		[
			"--no-browser on CI",
			"device",
			{ noBrowser: true, env: { CI: "true" }, stdin: pipe, stdout: pipe },
		],
	])("SEC-L5 SEC-DEC-14 %s → %s", (_name, expected, options) => {
		expect(detectLoginMode({ platform: "linux", ...options })).toBe(expected);
	});
});
