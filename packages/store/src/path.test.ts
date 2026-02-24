import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { CrustStoreError } from "./errors.ts";
import { type PlatformEnv, resolveStorePath } from "./path.ts";

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
// resolveStorePath() — Platform path derivation
// ────────────────────────────────────────────────────────────────────────────

describe("resolveStorePath", () => {
	// ──────────────────────────────────────────────────────────────────────
	// Linux path resolution
	// ──────────────────────────────────────────────────────────────────────

	describe("Linux", () => {
		it("should use XDG_CONFIG_HOME when set", () => {
			const env = linuxEnv({ XDG_CONFIG_HOME: "/custom/config" });
			const result = resolveStorePath("my-cli", undefined, env);

			expect(result).toBe(join("/custom/config", "my-cli", "config.json"));
		});

		it("should fall back to ~/.config when XDG_CONFIG_HOME is not set", () => {
			const env = linuxEnv();
			const result = resolveStorePath("my-cli", undefined, env);

			expect(result).toBe(
				join("/home/testuser", ".config", "my-cli", "config.json"),
			);
		});

		it("should fall back to ~/.config when XDG_CONFIG_HOME is empty", () => {
			const env = linuxEnv({ XDG_CONFIG_HOME: "" });
			const result = resolveStorePath("my-cli", undefined, env);

			expect(result).toBe(
				join("/home/testuser", ".config", "my-cli", "config.json"),
			);
		});

		it("should fall back to ~/.config when XDG_CONFIG_HOME is whitespace", () => {
			const env = linuxEnv({ XDG_CONFIG_HOME: "   " });
			const result = resolveStorePath("my-cli", undefined, env);

			expect(result).toBe(
				join("/home/testuser", ".config", "my-cli", "config.json"),
			);
		});
	});

	// ──────────────────────────────────────────────────────────────────────
	// macOS path resolution
	// ──────────────────────────────────────────────────────────────────────

	describe("macOS", () => {
		it("should use ~/Library/Application Support", () => {
			const env = darwinEnv();
			const result = resolveStorePath("my-cli", undefined, env);

			expect(result).toBe(
				join(
					"/Users/testuser",
					"Library",
					"Application Support",
					"my-cli",
					"config.json",
				),
			);
		});

		it("should use custom homedir", () => {
			const env = darwinEnv({ homedir: "/Users/custom" });
			const result = resolveStorePath("app", undefined, env);

			expect(result).toBe(
				join(
					"/Users/custom",
					"Library",
					"Application Support",
					"app",
					"config.json",
				),
			);
		});
	});

	// ──────────────────────────────────────────────────────────────────────
	// Windows path resolution
	// ──────────────────────────────────────────────────────────────────────

	describe("Windows", () => {
		it("should use APPDATA when set", () => {
			const env = win32Env({
				APPDATA: "C:\\Users\\testuser\\AppData\\Roaming",
			});
			const result = resolveStorePath("my-cli", undefined, env);

			expect(result).toBe(
				join("C:\\Users\\testuser\\AppData\\Roaming", "my-cli", "config.json"),
			);
		});

		it("should fall back to ~/AppData/Roaming when APPDATA is not set", () => {
			const env = win32Env();
			const result = resolveStorePath("my-cli", undefined, env);

			expect(result).toBe(
				join(
					"C:\\Users\\testuser",
					"AppData",
					"Roaming",
					"my-cli",
					"config.json",
				),
			);
		});

		it("should fall back to ~/AppData/Roaming when APPDATA is empty", () => {
			const env = win32Env({ APPDATA: "" });
			const result = resolveStorePath("my-cli", undefined, env);

			expect(result).toBe(
				join(
					"C:\\Users\\testuser",
					"AppData",
					"Roaming",
					"my-cli",
					"config.json",
				),
			);
		});
	});

	// ──────────────────────────────────────────────────────────────────────
	// Unsupported platform
	// ──────────────────────────────────────────────────────────────────────

	describe("unsupported platform", () => {
		it("should throw CrustStoreError with PATH code", () => {
			const env: PlatformEnv = {
				platform: "freebsd",
				env: {},
				homedir: "/home/user",
			};

			try {
				resolveStorePath("my-cli", undefined, env);
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(CrustStoreError);
				const storeErr = err as CrustStoreError;
				expect(storeErr.code).toBe("PATH");
				expect(storeErr.message).toContain("freebsd");
				expect(storeErr.is("PATH") && storeErr.details.path).toBe("freebsd");
			}
		});
	});

	// ──────────────────────────────────────────────────────────────────────
	// Explicit filePath override
	// ──────────────────────────────────────────────────────────────────────

	describe("filePath override", () => {
		it("should use explicit absolute .json path and bypass platform derivation", () => {
			const result = resolveStorePath(
				"my-cli",
				"/custom/path/settings.json",
				linuxEnv(),
			);

			expect(result).toBe("/custom/path/settings.json");
		});

		it("should accept Windows-style absolute paths", () => {
			const result = resolveStorePath(
				"my-cli",
				"C:\\Users\\test\\config.json",
				win32Env(),
			);

			expect(result).toBe("C:\\Users\\test\\config.json");
		});

		it("should reject relative filePath", () => {
			try {
				resolveStorePath("my-cli", "relative/path/config.json", linuxEnv());
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(CrustStoreError);
				const storeErr = err as CrustStoreError;
				expect(storeErr.code).toBe("PATH");
				expect(storeErr.message).toContain("absolute");
				if (storeErr.is("PATH")) {
					expect(storeErr.details.path).toBe("relative/path/config.json");
				}
			}
		});

		it("should reject filePath not ending in .json", () => {
			try {
				resolveStorePath("my-cli", "/absolute/path/config.yaml", linuxEnv());
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(CrustStoreError);
				const storeErr = err as CrustStoreError;
				expect(storeErr.code).toBe("PATH");
				expect(storeErr.message).toContain(".json");
			}
		});

		it("should reject empty filePath", () => {
			try {
				resolveStorePath("my-cli", "", linuxEnv());
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(CrustStoreError);
				const storeErr = err as CrustStoreError;
				expect(storeErr.code).toBe("PATH");
				expect(storeErr.message).toContain("non-empty");
			}
		});
	});

	// ──────────────────────────────────────────────────────────────────────
	// appName validation
	// ──────────────────────────────────────────────────────────────────────

	describe("appName validation", () => {
		it("should reject empty appName", () => {
			try {
				resolveStorePath("", undefined, linuxEnv());
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(CrustStoreError);
				const storeErr = err as CrustStoreError;
				expect(storeErr.code).toBe("PATH");
				expect(storeErr.message).toContain("non-empty");
			}
		});

		it("should reject whitespace-only appName", () => {
			try {
				resolveStorePath("   ", undefined, linuxEnv());
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(CrustStoreError);
				const storeErr = err as CrustStoreError;
				expect(storeErr.code).toBe("PATH");
				expect(storeErr.message).toContain("non-empty");
			}
		});

		it("should reject appName with forward slashes", () => {
			try {
				resolveStorePath("my/app", undefined, linuxEnv());
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(CrustStoreError);
				const storeErr = err as CrustStoreError;
				expect(storeErr.code).toBe("PATH");
				expect(storeErr.message).toContain("path separators");
			}
		});

		it("should reject appName with backslashes", () => {
			try {
				resolveStorePath("my\\app", undefined, linuxEnv());
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(CrustStoreError);
				const storeErr = err as CrustStoreError;
				expect(storeErr.code).toBe("PATH");
				expect(storeErr.message).toContain("path separators");
			}
		});

		it("should validate appName even when filePath is provided", () => {
			try {
				resolveStorePath("", "/valid/path/config.json", linuxEnv());
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(CrustStoreError);
				const storeErr = err as CrustStoreError;
				expect(storeErr.code).toBe("PATH");
				expect(storeErr.message).toContain("non-empty");
			}
		});

		it("should accept valid appName characters", () => {
			const env = linuxEnv();

			// Simple names
			expect(resolveStorePath("my-cli", undefined, env)).toContain("my-cli");

			// Scoped-like names (dots, hyphens, underscores)
			expect(resolveStorePath("my_app.v2", undefined, env)).toContain(
				"my_app.v2",
			);
		});
	});

	// ──────────────────────────────────────────────────────────────────────
	// Table-driven cross-platform matrix
	// ──────────────────────────────────────────────────────────────────────

	describe("cross-platform path matrix", () => {
		const cases: Array<{
			label: string;
			appName: string;
			env: PlatformEnv;
			expected: string;
		}> = [
			{
				label: "Linux default",
				appName: "test-app",
				env: linuxEnv(),
				expected: join("/home/testuser", ".config", "test-app", "config.json"),
			},
			{
				label: "Linux with XDG",
				appName: "test-app",
				env: linuxEnv({ XDG_CONFIG_HOME: "/opt/config" }),
				expected: join("/opt/config", "test-app", "config.json"),
			},
			{
				label: "macOS default",
				appName: "test-app",
				env: darwinEnv(),
				expected: join(
					"/Users/testuser",
					"Library",
					"Application Support",
					"test-app",
					"config.json",
				),
			},
			{
				label: "Windows with APPDATA",
				appName: "test-app",
				env: win32Env({
					APPDATA: "C:\\Users\\testuser\\AppData\\Roaming",
				}),
				expected: join(
					"C:\\Users\\testuser\\AppData\\Roaming",
					"test-app",
					"config.json",
				),
			},
			{
				label: "Windows without APPDATA",
				appName: "test-app",
				env: win32Env(),
				expected: join(
					"C:\\Users\\testuser",
					"AppData",
					"Roaming",
					"test-app",
					"config.json",
				),
			},
		];

		for (const { label, appName, env, expected } of cases) {
			it(`should resolve correct path for ${label}`, () => {
				const result = resolveStorePath(appName, undefined, env);
				expect(result).toBe(expected);
			});
		}
	});

	// ──────────────────────────────────────────────────────────────────────
	// Runtime fallback (no env override)
	// ──────────────────────────────────────────────────────────────────────

	describe("runtime environment fallback", () => {
		it("should resolve a path using real runtime environment when no env is provided", () => {
			const result = resolveStorePath("my-cli");

			// Should return a non-empty string ending with config.json
			expect(typeof result).toBe("string");
			expect(result.length).toBeGreaterThan(0);
			expect(result).toEndWith(join("my-cli", "config.json"));
		});
	});
});
