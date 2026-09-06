import { describe, expect, it } from "bun:test";
import { join } from "node:path";

import { CrustStoreError } from "./errors.ts";
import {
	cacheDir,
	configDir,
	dataDir,
	type PlatformEnv,
	resolveStorePath,
	stateDir,
} from "./path.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test helpers — env factories
// ────────────────────────────────────────────────────────────────────────────

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
	it("should reject empty appName", () => {
		try {
			configDir("", linuxEnv());
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustStoreError);
			expect((err as CrustStoreError).code).toBe("PATH");
			expect((err as CrustStoreError).message).toContain("non-empty");
		}
	});

	it("should reject whitespace-only appName", () => {
		try {
			configDir("   ", linuxEnv());
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustStoreError);
			expect((err as CrustStoreError).code).toBe("PATH");
		}
	});

	it("should reject appName with forward slashes", () => {
		try {
			configDir("my/app", linuxEnv());
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustStoreError);
			expect((err as CrustStoreError).message).toContain("path separators");
		}
	});

	it("should reject appName with backslashes", () => {
		try {
			configDir("my\\app", linuxEnv());
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustStoreError);
			expect((err as CrustStoreError).message).toContain("path separators");
		}
	});

	it("should accept valid appName characters", () => {
		const env = linuxEnv();
		expect(configDir("my-cli", env)).toContain("my-cli");
		expect(configDir("my_app.v2", env)).toContain("my_app.v2");
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

			try {
				configDir("my-cli", env);
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(CrustStoreError);
				const storeErr = err as CrustStoreError;
				expect(storeErr.code).toBe("PATH");
				expect(storeErr.message).toContain("freebsd");
			}
		});
	});

	describe("runtime environment fallback", () => {
		it("should resolve a path using real runtime environment", () => {
			const result = configDir("my-cli");
			expect(result).toEndWith("my-cli");
		});
	});
});

// ────────────────────────────────────────────────────────────────────────────
// dataDir()
// ────────────────────────────────────────────────────────────────────────────

describe("dataDir", () => {
	describe("Linux", () => {
		it("should use XDG_DATA_HOME when set", () => {
			const env = linuxEnv({ XDG_DATA_HOME: "/custom/data" });
			expect(dataDir("my-cli", env)).toBe(join("/custom/data", "my-cli"));
		});

		it("should fall back to ~/.local/share when XDG_DATA_HOME is not set", () => {
			const env = linuxEnv();
			expect(dataDir("my-cli", env)).toBe(join("/home/testuser", ".local", "share", "my-cli"));
		});
	});

	describe("Windows", () => {
		it("should use LOCALAPPDATA with Data bucket when set", () => {
			const env = win32Env({
				LOCALAPPDATA: "C:\\Users\\testuser\\AppData\\Local",
			});
			expect(dataDir("my-cli", env)).toBe(
				join("C:\\Users\\testuser\\AppData\\Local", "my-cli", "Data"),
			);
		});

		it("should fall back to ~/AppData/Local with Data bucket when LOCALAPPDATA is not set", () => {
			const env = win32Env();
			expect(dataDir("my-cli", env)).toBe(
				join("C:\\Users\\testuser", "AppData", "Local", "my-cli", "Data"),
			);
		});
	});
});

// ────────────────────────────────────────────────────────────────────────────
// stateDir()
// ────────────────────────────────────────────────────────────────────────────

describe("stateDir", () => {
	describe("Linux", () => {
		it("should use XDG_STATE_HOME when set", () => {
			const env = linuxEnv({ XDG_STATE_HOME: "/custom/state" });
			expect(stateDir("my-cli", env)).toBe(join("/custom/state", "my-cli"));
		});

		it("should fall back to ~/.local/state when XDG_STATE_HOME is not set", () => {
			const env = linuxEnv();
			expect(stateDir("my-cli", env)).toBe(join("/home/testuser", ".local", "state", "my-cli"));
		});
	});

	describe("Windows", () => {
		it("should use LOCALAPPDATA with State bucket when set", () => {
			const env = win32Env({
				LOCALAPPDATA: "C:\\Users\\testuser\\AppData\\Local",
			});
			expect(stateDir("my-cli", env)).toBe(
				join("C:\\Users\\testuser\\AppData\\Local", "my-cli", "State"),
			);
		});

		it("should fall back to ~/AppData/Local with State bucket when LOCALAPPDATA is not set", () => {
			const env = win32Env();
			expect(stateDir("my-cli", env)).toBe(
				join("C:\\Users\\testuser", "AppData", "Local", "my-cli", "State"),
			);
		});
	});
});

// ────────────────────────────────────────────────────────────────────────────
// cacheDir()
// ────────────────────────────────────────────────────────────────────────────

describe("cacheDir", () => {
	describe("Linux", () => {
		it("should use XDG_CACHE_HOME when set", () => {
			const env = linuxEnv({ XDG_CACHE_HOME: "/custom/cache" });
			expect(cacheDir("my-cli", env)).toBe(join("/custom/cache", "my-cli"));
		});

		it("should fall back to ~/.cache when XDG_CACHE_HOME is not set", () => {
			const env = linuxEnv();
			expect(cacheDir("my-cli", env)).toBe(join("/home/testuser", ".cache", "my-cli"));
		});
	});

	describe("Windows", () => {
		it("should use LOCALAPPDATA with Cache bucket when set", () => {
			const env = win32Env({
				LOCALAPPDATA: "C:\\Users\\testuser\\AppData\\Local",
			});
			expect(cacheDir("my-cli", env)).toBe(
				join("C:\\Users\\testuser\\AppData\\Local", "my-cli", "Cache"),
			);
		});

		it("should fall back to ~/AppData/Local with Cache bucket when LOCALAPPDATA is not set", () => {
			const env = win32Env();
			expect(cacheDir("my-cli", env)).toBe(
				join("C:\\Users\\testuser", "AppData", "Local", "my-cli", "Cache"),
			);
		});
	});
});

// ────────────────────────────────────────────────────────────────────────────
// resolveStorePath() — dirPath + name → file path
// ────────────────────────────────────────────────────────────────────────────

describe("resolveStorePath", () => {
	describe("dirPath validation", () => {
		it("should reject empty dirPath", () => {
			try {
				resolveStorePath("", "config");
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(CrustStoreError);
				expect((err as CrustStoreError).code).toBe("PATH");
				expect((err as CrustStoreError).message).toContain("non-empty");
			}
		});

		it("should reject relative dirPath", () => {
			try {
				resolveStorePath("relative/path", "config");
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(CrustStoreError);
				expect((err as CrustStoreError).code).toBe("PATH");
				expect((err as CrustStoreError).message).toContain("absolute");
			}
		});

		it("should reject dirPath ending in .json", () => {
			try {
				resolveStorePath("/absolute/path/config.json", "config");
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(CrustStoreError);
				expect((err as CrustStoreError).code).toBe("PATH");
				expect((err as CrustStoreError).message).toContain(".json");
			}
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
		it("should use custom name as filename", () => {
			const result = resolveStorePath("/home/user/.config/my-cli", "auth");
			expect(result).toBe(join("/home/user/.config/my-cli", "auth.json"));
		});

		it("should reject empty name", () => {
			try {
				resolveStorePath("/home/user/.config/my-cli", "");
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(CrustStoreError);
				expect((err as CrustStoreError).code).toBe("PATH");
				expect((err as CrustStoreError).message).toContain("non-empty");
			}
		});

		it("should reject name with path separators", () => {
			try {
				resolveStorePath("/home/user/.config/my-cli", "my/store");
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(CrustStoreError);
				expect((err as CrustStoreError).message).toContain("path separators");
			}
		});

		it("should reject name ending with .json", () => {
			try {
				resolveStorePath("/home/user/.config/my-cli", "auth.json");
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(CrustStoreError);
				expect((err as CrustStoreError).message).toContain(".json");
			}
		});

		it("should accept valid name characters", () => {
			expect(resolveStorePath("/tmp/dir", "auth")).toEndWith("auth.json");
			expect(resolveStorePath("/tmp/dir", "my-store")).toEndWith("my-store.json");
			expect(resolveStorePath("/tmp/dir", "cache_v2")).toEndWith("cache_v2.json");
		});
	});
});
