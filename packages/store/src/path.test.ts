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

function linuxEnv(
	overrides?: Partial<PlatformEnv> & Record<string, string | undefined>,
): PlatformEnv {
	return {
		platform: "linux",
		env: {
			XDG_CONFIG_HOME: overrides?.XDG_CONFIG_HOME,
			XDG_DATA_HOME: overrides?.XDG_DATA_HOME,
			XDG_STATE_HOME: overrides?.XDG_STATE_HOME,
			XDG_CACHE_HOME: overrides?.XDG_CACHE_HOME,
		},
		homedir: overrides?.homedir ?? "/home/testuser",
	};
}

function darwinEnv(
	overrides?: Partial<PlatformEnv> & Record<string, string | undefined>,
): PlatformEnv {
	return {
		platform: "darwin",
		env: {
			XDG_CONFIG_HOME: overrides?.XDG_CONFIG_HOME,
			XDG_DATA_HOME: overrides?.XDG_DATA_HOME,
			XDG_STATE_HOME: overrides?.XDG_STATE_HOME,
			XDG_CACHE_HOME: overrides?.XDG_CACHE_HOME,
		},
		homedir: overrides?.homedir ?? "/Users/testuser",
	};
}

function win32Env(
	overrides?: Partial<PlatformEnv> & Record<string, string | undefined>,
): PlatformEnv {
	return {
		platform: "win32",
		env: {
			APPDATA: overrides?.APPDATA,
			LOCALAPPDATA: overrides?.LOCALAPPDATA,
		},
		homedir: overrides?.homedir ?? "C:\\Users\\testuser",
	};
}

// ────────────────────────────────────────────────────────────────────────────
// Shared appName validation tests — all helpers share the same validator
// ────────────────────────────────────────────────────────────────────────────

describe("appName validation", () => {
	it("should reject whitespace-only appName", () => {
		expect(() => configDir("   ", linuxEnv())).toThrow(pathError("non-empty"));
	});

	it("should reject appName with forward slashes", () => {
		expect(() => configDir("my/app", linuxEnv())).toThrow(pathError("path separators"));
	});

	it("should reject appName with backslashes", () => {
		expect(() => configDir("my\\app", linuxEnv())).toThrow(pathError("path separators"));
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

		it("should fall back to ~/.config when XDG_CONFIG_HOME is whitespace", () => {
			const env = linuxEnv({ XDG_CONFIG_HOME: "   " });
			expect(configDir("my-cli", env)).toBe(join("/home/testuser", ".config", "my-cli"));
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

		it("should fall back to ~/AppData/Roaming when APPDATA is empty", () => {
			const env = win32Env({ APPDATA: "" });
			expect(configDir("my-cli", env)).toBe(
				join("C:\\Users\\testuser", "AppData", "Roaming", "my-cli"),
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

		it("should accept valid absolute dirPath", () => {
			const result = resolveStorePath("/home/user/.config/my-cli", "config");
			expect(result).toBe(join("/home/user/.config/my-cli", "config.json"));
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
