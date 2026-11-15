import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { configDir, dataDir, type PlatformEnv, resolveStorePath } from "./path.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test helpers
// ────────────────────────────────────────────────────────────────────────────

function pathError(message: string) {
	return expect.objectContaining({
		name: "CrustStoreError",
		code: "PATH",
		message: expect.stringContaining(message),
	});
}

type EnvOverrides = { homedir?: string } & Record<string, string | undefined>;

function linuxEnv({ homedir = "/home/testuser", ...env }: EnvOverrides = {}): PlatformEnv {
	return { platform: "linux", env, homedir };
}

function darwinEnv({ homedir = "/Users/testuser", ...env }: EnvOverrides = {}): PlatformEnv {
	return { platform: "darwin", env, homedir };
}

function win32Env({ homedir = "C:\\Users\\testuser", ...env }: EnvOverrides = {}): PlatformEnv {
	return { platform: "win32", env, homedir };
}

// ────────────────────────────────────────────────────────────────────────────
// Shared appName validation tests — all helpers share the same validator
// ────────────────────────────────────────────────────────────────────────────

describe("appName validation", () => {
	it("should reject whitespace-only appName", () => {
		expect(() => configDir("   ", linuxEnv())).toThrow(pathError("non-empty"));
	});

	it.each(["my/app", "my\\app"])("should reject appName %j with path separators", (appName) => {
		expect(() => configDir(appName, linuxEnv())).toThrow(pathError("path separators"));
	});
});

// ────────────────────────────────────────────────────────────────────────────
// configDir()
// ────────────────────────────────────────────────────────────────────────────

describe("configDir", () => {
	describe("Linux", () => {
		it("should use XDG_CONFIG_HOME when set", () => {
			const env = linuxEnv({ XDG_CONFIG_HOME: "/custom/config" });
			expect(configDir("my-cli", env)).toBe(join("/custom/config", "my-cli"));
		});

		it("should fall back to ~/.config when XDG_CONFIG_HOME is not set", () => {
			const env = linuxEnv();
			expect(configDir("my-cli", env)).toBe(join("/home/testuser", ".config", "my-cli"));
		});

		it("should ignore a relative XDG_CONFIG_HOME", () => {
			const env = linuxEnv({ XDG_CONFIG_HOME: "relative/config" });
			expect(configDir("my-cli", env)).toBe(join("/home/testuser", ".config", "my-cli"));
		});

		it("should reject a relative or empty home directory instead of returning a relative path", () => {
			for (const homedir of ["relative", ""]) {
				expect(() => configDir("my-cli", linuxEnv({ homedir }))).toThrow(
					pathError("set HOME or XDG_CONFIG_HOME to an absolute path"),
				);
			}
		});

		it("should not need the home directory when XDG_CONFIG_HOME is set", () => {
			const env = linuxEnv({ XDG_CONFIG_HOME: "/custom/config", homedir: "relative" });
			expect(configDir("my-cli", env)).toBe(join("/custom/config", "my-cli"));
		});
	});

	describe("macOS (XDG convention)", () => {
		it("should fall back to ~/.config (XDG default)", () => {
			const env = darwinEnv();
			expect(configDir("my-cli", env)).toBe(join("/Users/testuser", ".config", "my-cli"));
		});
	});

	describe("Windows", () => {
		it("should use APPDATA when set", () => {
			const env = win32Env({
				APPDATA: "C:\\Users\\testuser\\AppData\\Roaming",
			});
			expect(configDir("my-cli", env)).toBe(
				join("C:\\Users\\testuser\\AppData\\Roaming", "my-cli"),
			);
		});

		it("should fall back to ~/AppData/Roaming when APPDATA is not set", () => {
			const env = win32Env();
			expect(configDir("my-cli", env)).toBe(
				join("C:\\Users\\testuser", "AppData", "Roaming", "my-cli"),
			);
		});

		it("should fall back to ~/AppData/Roaming when APPDATA is empty or relative", () => {
			for (const APPDATA of ["", "AppData\\Roaming"]) {
				expect(configDir("my-cli", win32Env({ APPDATA }))).toBe(
					join("C:\\Users\\testuser", "AppData", "Roaming", "my-cli"),
				);
			}
		});

		it("should reject a relative home directory", () => {
			expect(() => configDir("my-cli", win32Env({ homedir: "Users\\testuser" }))).toThrow(
				pathError("set USERPROFILE or APPDATA to an absolute path"),
			);
		});
	});

	describe("unsupported platform", () => {
		it("should throw CrustStoreError with PATH code", () => {
			const env: PlatformEnv = {
				platform: "freebsd",
				env: {},
				homedir: "/home/user",
			};

			expect(() => configDir("my-cli", env)).toThrow(pathError("freebsd"));
		});
	});
});

// ────────────────────────────────────────────────────────────────────────────
// dataDir()
// ────────────────────────────────────────────────────────────────────────────

describe("dataDir", () => {
	describe("Windows", () => {
		it("should use LOCALAPPDATA with Data bucket when set", () => {
			const env = win32Env({
				LOCALAPPDATA: "C:\\Users\\testuser\\AppData\\Local",
			});
			expect(dataDir("my-cli", env)).toBe(
				join("C:\\Users\\testuser\\AppData\\Local", "my-cli", "Data"),
			);
		});
	});
});

// ────────────────────────────────────────────────────────────────────────────
// resolveStorePath() — dirPath + name → file path
// ────────────────────────────────────────────────────────────────────────────

describe("resolveStorePath", () => {
	describe("dirPath validation", () => {
		it("should reject relative dirPath", () => {
			expect(() => resolveStorePath("relative/path", "config")).toThrow(pathError("absolute"));
		});

		it("should reject dirPath ending in .json", () => {
			expect(() => resolveStorePath("/absolute/path/config.json", "config")).toThrow(
				pathError(".json"),
			);
		});

		it("should accept Windows-style absolute dirPath", () => {
			const result = resolveStorePath("C:\\Users\\test\\config-dir", "config");
			expect(result).toBe(join("C:\\Users\\test\\config-dir", "config.json"));
		});
	});

	describe("name parameter", () => {
		it("should reject name ending with .json", () => {
			expect(() => resolveStorePath("/home/user/.config/my-cli", "auth.json")).toThrow(
				pathError(".json"),
			);
		});
	});
});
