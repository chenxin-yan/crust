import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { CrustStoreError } from "./errors.ts";
import { configDir, type PlatformEnv, resolveStorePath } from "./path.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test helpers
// ────────────────────────────────────────────────────────────────────────────

function linuxEnv(
	overrides?: Partial<PlatformEnv> & { XDG_CONFIG_HOME?: string },
): PlatformEnv {
	return {
		platform: "linux",
		env: {
			XDG_CONFIG_HOME: overrides?.XDG_CONFIG_HOME,
		},
		homedir: overrides?.homedir ?? "/home/testuser",
	};
}

function darwinEnv(overrides?: Partial<PlatformEnv>): PlatformEnv {
	return {
		platform: "darwin",
		env: {},
		homedir: overrides?.homedir ?? "/Users/testuser",
	};
}

function win32Env(
	overrides?: Partial<PlatformEnv> & { APPDATA?: string },
): PlatformEnv {
	return {
		platform: "win32",
		env: {
			APPDATA: overrides?.APPDATA,
		},
		homedir: overrides?.homedir ?? "C:\\Users\\testuser",
	};
}

// ────────────────────────────────────────────────────────────────────────────
// configDir() — Platform config directory resolution
// ────────────────────────────────────────────────────────────────────────────

describe("configDir", () => {
	describe("Linux", () => {
		it("should use XDG_CONFIG_HOME when set", () => {
			const env = linuxEnv({ XDG_CONFIG_HOME: "/custom/config" });
			const result = configDir("my-cli", env);

			expect(result).toBe(join("/custom/config", "my-cli"));
		});

		it("should fall back to ~/.config when XDG_CONFIG_HOME is not set", () => {
			const env = linuxEnv();
			const result = configDir("my-cli", env);

			expect(result).toBe(join("/home/testuser", ".config", "my-cli"));
		});

		it("should fall back to ~/.config when XDG_CONFIG_HOME is empty", () => {
			const env = linuxEnv({ XDG_CONFIG_HOME: "" });
			const result = configDir("my-cli", env);

			expect(result).toBe(join("/home/testuser", ".config", "my-cli"));
		});

		it("should fall back to ~/.config when XDG_CONFIG_HOME is whitespace", () => {
			const env = linuxEnv({ XDG_CONFIG_HOME: "   " });
			const result = configDir("my-cli", env);

			expect(result).toBe(join("/home/testuser", ".config", "my-cli"));
		});
	});

	describe("macOS", () => {
		it("should use ~/Library/Application Support", () => {
			const env = darwinEnv();
			const result = configDir("my-cli", env);

			expect(result).toBe(
				join("/Users/testuser", "Library", "Application Support", "my-cli"),
			);
		});

		it("should use custom homedir", () => {
			const env = darwinEnv({ homedir: "/Users/custom" });
			const result = configDir("app", env);

			expect(result).toBe(
				join("/Users/custom", "Library", "Application Support", "app"),
			);
		});
	});

	describe("Windows", () => {
		it("should use APPDATA when set", () => {
			const env = win32Env({
				APPDATA: "C:\\Users\\testuser\\AppData\\Roaming",
			});
			const result = configDir("my-cli", env);

			expect(result).toBe(
				join("C:\\Users\\testuser\\AppData\\Roaming", "my-cli"),
			);
		});

		it("should fall back to ~/AppData/Roaming when APPDATA is not set", () => {
			const env = win32Env();
			const result = configDir("my-cli", env);

			expect(result).toBe(
				join("C:\\Users\\testuser", "AppData", "Roaming", "my-cli"),
			);
		});

		it("should fall back to ~/AppData/Roaming when APPDATA is empty", () => {
			const env = win32Env({ APPDATA: "" });
			const result = configDir("my-cli", env);

			expect(result).toBe(
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

	describe("cross-platform integration with configDir", () => {
		it("should compose configDir + resolveStorePath", () => {
			const dir = configDir("my-cli", linuxEnv());
			const path = resolveStorePath(dir, "auth");

			expect(path).toBe(
				join("/home/testuser", ".config", "my-cli", "auth.json"),
			);
		});
	});
});
