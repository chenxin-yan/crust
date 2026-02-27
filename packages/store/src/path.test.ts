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

describe("appName validation (shared across all helpers)", () => {
	const helpers = [
		{ name: "configDir", fn: configDir },
		{ name: "dataDir", fn: dataDir },
		{ name: "stateDir", fn: stateDir },
		{ name: "cacheDir", fn: cacheDir },
	] as const;

	for (const { name, fn } of helpers) {
		describe(name, () => {
			it("should reject empty appName", () => {
				try {
					fn("", linuxEnv());
					expect.unreachable("should have thrown");
				} catch (err) {
					expect(err).toBeInstanceOf(CrustStoreError);
					expect((err as CrustStoreError).code).toBe("PATH");
					expect((err as CrustStoreError).message).toContain("non-empty");
				}
			});

			it("should reject whitespace-only appName", () => {
				try {
					fn("   ", linuxEnv());
					expect.unreachable("should have thrown");
				} catch (err) {
					expect(err).toBeInstanceOf(CrustStoreError);
					expect((err as CrustStoreError).code).toBe("PATH");
				}
			});

			it("should reject appName with forward slashes", () => {
				try {
					fn("my/app", linuxEnv());
					expect.unreachable("should have thrown");
				} catch (err) {
					expect(err).toBeInstanceOf(CrustStoreError);
					expect((err as CrustStoreError).message).toContain("path separators");
				}
			});

			it("should reject appName with backslashes", () => {
				try {
					fn("my\\app", linuxEnv());
					expect.unreachable("should have thrown");
				} catch (err) {
					expect(err).toBeInstanceOf(CrustStoreError);
					expect((err as CrustStoreError).message).toContain("path separators");
				}
			});

			it("should accept valid appName characters", () => {
				const env = linuxEnv();
				expect(fn("my-cli", env)).toContain("my-cli");
				expect(fn("my_app.v2", env)).toContain("my_app.v2");
			});
		});
	}
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
			expect(configDir("my-cli", env)).toBe(
				join("/home/testuser", ".config", "my-cli"),
			);
		});

		it("should fall back to ~/.config when XDG_CONFIG_HOME is empty", () => {
			const env = linuxEnv({ XDG_CONFIG_HOME: "" });
			expect(configDir("my-cli", env)).toBe(
				join("/home/testuser", ".config", "my-cli"),
			);
		});

		it("should fall back to ~/.config when XDG_CONFIG_HOME is whitespace", () => {
			const env = linuxEnv({ XDG_CONFIG_HOME: "   " });
			expect(configDir("my-cli", env)).toBe(
				join("/home/testuser", ".config", "my-cli"),
			);
		});
	});

	describe("macOS (XDG convention)", () => {
		it("should use XDG_CONFIG_HOME when set", () => {
			const env = darwinEnv({ XDG_CONFIG_HOME: "/custom/config" });
			expect(configDir("my-cli", env)).toBe(join("/custom/config", "my-cli"));
		});

		it("should fall back to ~/.config (XDG default)", () => {
			const env = darwinEnv();
			expect(configDir("my-cli", env)).toBe(
				join("/Users/testuser", ".config", "my-cli"),
			);
		});

		it("should use custom homedir", () => {
			const env = darwinEnv({ homedir: "/Users/custom" });
			expect(configDir("app", env)).toBe(
				join("/Users/custom", ".config", "app"),
			);
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
			expect(typeof result).toBe("string");
			expect(result.length).toBeGreaterThan(0);
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
			expect(dataDir("my-cli", env)).toBe(
				join("/home/testuser", ".local", "share", "my-cli"),
			);
		});

		it("should fall back to ~/.local/share when XDG_DATA_HOME is empty", () => {
			const env = linuxEnv({ XDG_DATA_HOME: "" });
			expect(dataDir("my-cli", env)).toBe(
				join("/home/testuser", ".local", "share", "my-cli"),
			);
		});

		it("should fall back to ~/.local/share when XDG_DATA_HOME is whitespace", () => {
			const env = linuxEnv({ XDG_DATA_HOME: "   " });
			expect(dataDir("my-cli", env)).toBe(
				join("/home/testuser", ".local", "share", "my-cli"),
			);
		});
	});

	describe("macOS (XDG convention)", () => {
		it("should use XDG_DATA_HOME when set", () => {
			const env = darwinEnv({ XDG_DATA_HOME: "/custom/data" });
			expect(dataDir("my-cli", env)).toBe(join("/custom/data", "my-cli"));
		});

		it("should fall back to ~/.local/share (XDG default)", () => {
			const env = darwinEnv();
			expect(dataDir("my-cli", env)).toBe(
				join("/Users/testuser", ".local", "share", "my-cli"),
			);
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

		it("should fall back to ~/AppData/Local when LOCALAPPDATA is empty", () => {
			const env = win32Env({ LOCALAPPDATA: "" });
			expect(dataDir("my-cli", env)).toBe(
				join("C:\\Users\\testuser", "AppData", "Local", "my-cli", "Data"),
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
				dataDir("my-cli", env);
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(CrustStoreError);
				expect((err as CrustStoreError).code).toBe("PATH");
				expect((err as CrustStoreError).message).toContain("freebsd");
			}
		});
	});

	describe("runtime environment fallback", () => {
		it("should resolve a path using real runtime environment", () => {
			const result = dataDir("my-cli");
			expect(typeof result).toBe("string");
			expect(result.length).toBeGreaterThan(0);
			expect(result).toEndWith("my-cli");
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
			expect(stateDir("my-cli", env)).toBe(
				join("/home/testuser", ".local", "state", "my-cli"),
			);
		});

		it("should fall back to ~/.local/state when XDG_STATE_HOME is empty", () => {
			const env = linuxEnv({ XDG_STATE_HOME: "" });
			expect(stateDir("my-cli", env)).toBe(
				join("/home/testuser", ".local", "state", "my-cli"),
			);
		});

		it("should fall back to ~/.local/state when XDG_STATE_HOME is whitespace", () => {
			const env = linuxEnv({ XDG_STATE_HOME: "   " });
			expect(stateDir("my-cli", env)).toBe(
				join("/home/testuser", ".local", "state", "my-cli"),
			);
		});
	});

	describe("macOS (XDG convention)", () => {
		it("should use XDG_STATE_HOME when set", () => {
			const env = darwinEnv({ XDG_STATE_HOME: "/custom/state" });
			expect(stateDir("my-cli", env)).toBe(join("/custom/state", "my-cli"));
		});

		it("should fall back to ~/.local/state (XDG default)", () => {
			const env = darwinEnv();
			expect(stateDir("my-cli", env)).toBe(
				join("/Users/testuser", ".local", "state", "my-cli"),
			);
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

		it("should fall back to ~/AppData/Local when LOCALAPPDATA is empty", () => {
			const env = win32Env({ LOCALAPPDATA: "" });
			expect(stateDir("my-cli", env)).toBe(
				join("C:\\Users\\testuser", "AppData", "Local", "my-cli", "State"),
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
				stateDir("my-cli", env);
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(CrustStoreError);
				expect((err as CrustStoreError).code).toBe("PATH");
				expect((err as CrustStoreError).message).toContain("freebsd");
			}
		});
	});

	describe("runtime environment fallback", () => {
		it("should resolve a path using real runtime environment", () => {
			const result = stateDir("my-cli");
			expect(typeof result).toBe("string");
			expect(result.length).toBeGreaterThan(0);
			expect(result).toEndWith("my-cli");
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
			expect(cacheDir("my-cli", env)).toBe(
				join("/home/testuser", ".cache", "my-cli"),
			);
		});

		it("should fall back to ~/.cache when XDG_CACHE_HOME is empty", () => {
			const env = linuxEnv({ XDG_CACHE_HOME: "" });
			expect(cacheDir("my-cli", env)).toBe(
				join("/home/testuser", ".cache", "my-cli"),
			);
		});

		it("should fall back to ~/.cache when XDG_CACHE_HOME is whitespace", () => {
			const env = linuxEnv({ XDG_CACHE_HOME: "   " });
			expect(cacheDir("my-cli", env)).toBe(
				join("/home/testuser", ".cache", "my-cli"),
			);
		});
	});

	describe("macOS (XDG convention)", () => {
		it("should use XDG_CACHE_HOME when set", () => {
			const env = darwinEnv({ XDG_CACHE_HOME: "/custom/cache" });
			expect(cacheDir("my-cli", env)).toBe(join("/custom/cache", "my-cli"));
		});

		it("should fall back to ~/.cache (XDG default)", () => {
			const env = darwinEnv();
			expect(cacheDir("my-cli", env)).toBe(
				join("/Users/testuser", ".cache", "my-cli"),
			);
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

		it("should fall back to ~/AppData/Local when LOCALAPPDATA is empty", () => {
			const env = win32Env({ LOCALAPPDATA: "" });
			expect(cacheDir("my-cli", env)).toBe(
				join("C:\\Users\\testuser", "AppData", "Local", "my-cli", "Cache"),
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
				cacheDir("my-cli", env);
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(CrustStoreError);
				expect((err as CrustStoreError).code).toBe("PATH");
				expect((err as CrustStoreError).message).toContain("freebsd");
			}
		});
	});

	describe("runtime environment fallback", () => {
		it("should resolve a path using real runtime environment", () => {
			const result = cacheDir("my-cli");
			expect(typeof result).toBe("string");
			expect(result.length).toBeGreaterThan(0);
			expect(result).toEndWith("my-cli");
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
				resolveStorePath("");
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(CrustStoreError);
				expect((err as CrustStoreError).code).toBe("PATH");
				expect((err as CrustStoreError).message).toContain("non-empty");
			}
		});

		it("should reject relative dirPath", () => {
			try {
				resolveStorePath("relative/path");
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(CrustStoreError);
				expect((err as CrustStoreError).code).toBe("PATH");
				expect((err as CrustStoreError).message).toContain("absolute");
			}
		});

		it("should reject dirPath ending in .json", () => {
			try {
				resolveStorePath("/absolute/path/config.json");
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(CrustStoreError);
				expect((err as CrustStoreError).code).toBe("PATH");
				expect((err as CrustStoreError).message).toContain(".json");
			}
		});

		it("should accept valid absolute dirPath", () => {
			const result = resolveStorePath("/home/user/.config/my-cli");
			expect(result).toBe(join("/home/user/.config/my-cli", "config.json"));
		});

		it("should accept Windows-style absolute dirPath", () => {
			const result = resolveStorePath("C:\\Users\\test\\config-dir");
			expect(result).toBe(join("C:\\Users\\test\\config-dir", "config.json"));
		});
	});

	describe("name parameter", () => {
		it("should default to config.json when name is not provided", () => {
			const result = resolveStorePath("/home/user/.config/my-cli");
			expect(result).toEndWith("config.json");
		});

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
			expect(resolveStorePath("/tmp/dir", "my-store")).toEndWith(
				"my-store.json",
			);
			expect(resolveStorePath("/tmp/dir", "cache_v2")).toEndWith(
				"cache_v2.json",
			);
		});
	});

	describe("cross-platform integration with path helpers", () => {
		it("should compose configDir + resolveStorePath", () => {
			const dir = configDir("my-cli", linuxEnv());
			const path = resolveStorePath(dir, "auth");
			expect(path).toBe(
				join("/home/testuser", ".config", "my-cli", "auth.json"),
			);
		});

		it("should compose dataDir + resolveStorePath", () => {
			const dir = dataDir("my-cli", linuxEnv());
			const path = resolveStorePath(dir);
			expect(path).toBe(
				join("/home/testuser", ".local", "share", "my-cli", "config.json"),
			);
		});

		it("should compose stateDir + resolveStorePath", () => {
			const dir = stateDir("my-cli", linuxEnv());
			const path = resolveStorePath(dir, "history");
			expect(path).toBe(
				join("/home/testuser", ".local", "state", "my-cli", "history.json"),
			);
		});

		it("should compose cacheDir + resolveStorePath", () => {
			const dir = cacheDir("my-cli", linuxEnv());
			const path = resolveStorePath(dir, "tokens");
			expect(path).toBe(
				join("/home/testuser", ".cache", "my-cli", "tokens.json"),
			);
		});
	});
});
