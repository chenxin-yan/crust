import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

import { Crust, defineExtension } from "@crustjs/core";
import { snapshotCommand } from "@crustjs/core/tooling";

import {
	fetchLatestVersion,
	isNewerVersion,
	type UpdateNotifierCacheAdapter,
	type UpdateNotifierState,
	updateNotifier,
} from "./update-notifier.ts";

// ────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ────────────────────────────────────────────────────────────────────────────

/** Helper to mock globalThis.fetch without type errors from `preconnect`. */
function mockFetch(fn: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>) {
	globalThis.fetch = Object.assign(mock(fn), {
		preconnect: globalThis.fetch.preconnect,
	});
}

/** Returns a mock fetch that responds with the given latest version. */
function mockRegistryResponse(latestVersion: string) {
	mockFetch(() =>
		Promise.resolve(
			new Response(JSON.stringify({ "dist-tags": { latest: latestVersion } }), {
				status: 200,
			}),
		),
	);
}

/** Returns a mock fetch that fails with a network error. */
function mockRegistryFailure() {
	mockFetch(() => Promise.reject(new Error("Network failure")));
}

// ────────────────────────────────────────────────────────────────────────────
// isNewerVersion
// ────────────────────────────────────────────────────────────────────────────

describe("isNewerVersion", () => {
	it("returns true when latest major is higher", () => {
		expect(isNewerVersion("1.0.0", "2.0.0")).toBe(true);
	});

	it("returns true when latest minor is higher", () => {
		expect(isNewerVersion("1.0.0", "1.1.0")).toBe(true);
	});

	it("returns true when latest patch is higher", () => {
		expect(isNewerVersion("1.0.0", "1.0.1")).toBe(true);
	});

	it("returns false for equal versions", () => {
		expect(isNewerVersion("1.2.3", "1.2.3")).toBe(false);
	});

	it("returns false when latest is older (major)", () => {
		expect(isNewerVersion("2.0.0", "1.0.0")).toBe(false);
	});

	it("returns false when latest is older (minor)", () => {
		expect(isNewerVersion("1.2.0", "1.1.0")).toBe(false);
	});

	it("returns false when latest is older (patch)", () => {
		expect(isNewerVersion("1.0.2", "1.0.1")).toBe(false);
	});

	it("returns false when current is unparsable", () => {
		expect(isNewerVersion("invalid", "1.0.0")).toBe(false);
	});

	it("returns false when latest is unparsable", () => {
		expect(isNewerVersion("1.0.0", "invalid")).toBe(false);
	});

	it("returns false when both are unparsable", () => {
		expect(isNewerVersion("invalid", "also-invalid")).toBe(false);
	});

	it("notifies prerelease users when the stable release is available", () => {
		expect(isNewerVersion("1.2.3-beta.1", "1.2.3")).toBe(true);
	});

	it("handles prerelease latest versions", () => {
		expect(isNewerVersion("1.2.3", "1.2.4-rc.1")).toBe(true);
	});

	it("handles v-prefixed versions", () => {
		expect(isNewerVersion("v1.0.0", "v2.0.0")).toBe(true);
	});

	it("handles mixed v-prefix", () => {
		expect(isNewerVersion("v1.0.0", "2.0.0")).toBe(true);
		expect(isNewerVersion("1.0.0", "v2.0.0")).toBe(true);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// fetchLatestVersion
// ────────────────────────────────────────────────────────────────────────────

describe("fetchLatestVersion", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("returns latest version from registry response", async () => {
		mockFetch(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						"dist-tags": { latest: "2.0.0" },
					}),
					{ status: 200 },
				),
			),
		);

		const result = await fetchLatestVersion("my-cli", "https://registry.npmjs.org", 5000);
		expect(result).toBe("2.0.0");
	});

	it("constructs correct URL with encoded package name", async () => {
		let capturedUrl = "";
		mockFetch((input) => {
			capturedUrl = typeof input === "string" ? input : input.toString();
			return Promise.resolve(
				new Response(JSON.stringify({ "dist-tags": { latest: "1.0.0" } }), {
					status: 200,
				}),
			);
		});

		await fetchLatestVersion("@scope/my-cli", "https://registry.npmjs.org", 5000);
		expect(capturedUrl).toBe("https://registry.npmjs.org/%40scope%2Fmy-cli");
	});

	it("strips trailing slashes from registry URL", async () => {
		let capturedUrl = "";
		mockFetch((input) => {
			capturedUrl = typeof input === "string" ? input : input.toString();
			return Promise.resolve(
				new Response(JSON.stringify({ "dist-tags": { latest: "1.0.0" } }), {
					status: 200,
				}),
			);
		});

		await fetchLatestVersion("my-cli", "https://registry.npmjs.org///", 5000);
		expect(capturedUrl).toBe("https://registry.npmjs.org/my-cli");
	});

	it("returns null on non-OK response", async () => {
		mockFetch(() => Promise.resolve(new Response("Not Found", { status: 404 })));

		const result = await fetchLatestVersion(
			"nonexistent-package",
			"https://registry.npmjs.org",
			5000,
		);
		expect(result).toBeNull();
	});

	it("returns null on network error", async () => {
		mockFetch(() => Promise.reject(new Error("Network failure")));

		const result = await fetchLatestVersion("my-cli", "https://registry.npmjs.org", 5000);
		expect(result).toBeNull();
	});

	it("returns null when dist-tags is missing", async () => {
		mockFetch(() => Promise.resolve(new Response(JSON.stringify({}), { status: 200 })));

		const result = await fetchLatestVersion("my-cli", "https://registry.npmjs.org", 5000);
		expect(result).toBeNull();
	});

	it("returns null when latest is not a string", async () => {
		mockFetch(() =>
			Promise.resolve(
				new Response(JSON.stringify({ "dist-tags": { latest: 123 } }), {
					status: 200,
				}),
			),
		);

		const result = await fetchLatestVersion("my-cli", "https://registry.npmjs.org", 5000);
		expect(result).toBeNull();
	});

	it("returns null when latest is empty string", async () => {
		mockFetch(() =>
			Promise.resolve(
				new Response(JSON.stringify({ "dist-tags": { latest: "" } }), {
					status: 200,
				}),
			),
		);

		const result = await fetchLatestVersion("my-cli", "https://registry.npmjs.org", 5000);
		expect(result).toBeNull();
	});

	it("returns null on malformed JSON response", async () => {
		mockFetch(() => Promise.resolve(new Response("not json", { status: 200 })));

		const result = await fetchLatestVersion("my-cli", "https://registry.npmjs.org", 5000);
		expect(result).toBeNull();
	});

	it("returns null on timeout (abort)", async () => {
		mockFetch(
			(_input, init) =>
				new Promise<Response>((_resolve, reject) => {
					// Listen for abort and reject like a real fetch would
					if (init?.signal) {
						init.signal.addEventListener("abort", () => {
							reject(new DOMException("The operation was aborted.", "AbortError"));
						});
					}
				}),
		);

		const result = await fetchLatestVersion(
			"my-cli",
			"https://registry.npmjs.org",
			50, // Very short timeout
		);
		expect(result).toBeNull();
	});
});

// ────────────────────────────────────────────────────────────────────────────
// updateNotifier — post-run integration tests
// ────────────────────────────────────────────────────────────────────────────

describe("updateNotifier post-run hook", () => {
	const originalFetch = globalThis.fetch;
	const originalProcessArgv = [...process.argv];
	const originalUserAgent = process.env.npm_config_user_agent;
	const originalNpmExecpath = process.env.npm_execpath;
	const originalNpmConfigGlobal = process.env.npm_config_global;
	const originalBunInstall = process.env.BUN_INSTALL;
	const originalPrefix = process.env.PREFIX;
	const originalNpmConfigPrefix = process.env.npm_config_prefix;
	const originalPnpmHome = process.env.PNPM_HOME;
	let originalStderrWrite: typeof process.stderr.write;
	let originalConsoleError: typeof console.error;
	let processStderrChunks: string[];
	let stderrChunks: string[];
	let cachedState: UpdateNotifierState | undefined;

	/** Auto-incrementing counter to generate unique package names per test. */
	let testCounter = 0;

	beforeEach(() => {
		testCounter++;
		cachedState = undefined;

		stderrChunks = [];
		processStderrChunks = [];
		originalStderrWrite = process.stderr.write;
		originalConsoleError = console.error;
		process.stderr.write = (chunk: string | Uint8Array) => {
			processStderrChunks.push(String(chunk));
			return true;
		};
		console.error = (...args: unknown[]) => {
			stderrChunks.push(args.map(String).join(" "));
		};
	});

	function restoreEnv(key: string, original: string | undefined) {
		if (original === undefined) delete process.env[key];
		else process.env[key] = original;
	}

	afterEach(() => {
		globalThis.fetch = originalFetch;
		process.stderr.write = originalStderrWrite;
		console.error = originalConsoleError;
		process.argv = [...originalProcessArgv];
		restoreEnv("npm_config_user_agent", originalUserAgent);
		restoreEnv("npm_execpath", originalNpmExecpath);
		restoreEnv("npm_config_global", originalNpmConfigGlobal);
		restoreEnv("BUN_INSTALL", originalBunInstall);
		restoreEnv("PREFIX", originalPrefix);
		restoreEnv("npm_config_prefix", originalNpmConfigPrefix);
		restoreEnv("PNPM_HOME", originalPnpmHome);
		process.exitCode = 0;
	});

	function getOutput() {
		return stderrChunks.join("");
	}

	/**
	 * Generate a unique package name for this test to isolate cache state.
	 */
	function uniquePackageName(suffix = ""): string {
		return `__crust-test-${testCounter}-${Date.now()}${suffix ? `-${suffix}` : ""}`;
	}

	function setCachedState(state: UpdateNotifierState): void {
		cachedState = { ...state };
	}

	function getCachedState(): UpdateNotifierState | undefined {
		return cachedState;
	}

	const memoryCache: UpdateNotifierCacheAdapter = {
		read: async () => getCachedState(),
		write: async (state: UpdateNotifierState) => {
			setCachedState(state);
		},
	};

	/** Create a basic command node for testing. */
	function makeCommandSnapshot(name = "test-cli") {
		return snapshotCommand(new Crust(name).action(() => {})._node);
	}

	/** Helper to invoke the extension post-run hook with a completed outcome. */
	async function runExtensionMiddleware(
		options: {
			currentVersion: string;
			packageName: string;
			intervalMs?: number;
			timeoutMs?: number;
			registryUrl?: string;
			packageManager?: "npm" | "pnpm" | "yarn" | "bun" | "auto";
			installScope?: "local" | "global" | "auto";
			updateCommand?:
				| string
				| ((
						packageName: string,
						packageManager: "npm" | "pnpm" | "yarn" | "bun",
						installScope: "local" | "global",
				  ) => string);
			cache?: UpdateNotifierCacheAdapter;
		},
		overrides?: {
			commandName?: string;
			disableDefaultCache?: boolean;
		},
	) {
		const { intervalMs, cache: cacheAdapter, ...rest } = options;
		const resolvedAdapter = overrides?.disableDefaultCache
			? cacheAdapter
			: (cacheAdapter ?? memoryCache);
		const extensionOptions = {
			...rest,
			...(resolvedAdapter ? { cache: { adapter: resolvedAdapter, intervalMs } } : {}),
		};
		const extension = updateNotifier(extensionOptions);

		const rootCommand = makeCommandSnapshot(overrides?.commandName ?? options.packageName);

		const context = {
			argv: [] as readonly string[],
			rootCommand,
			command: rootCommand,
			commandPath: [rootCommand.meta.name] as readonly string[],
			args: {},
			flags: {},
			rawArgs: [] as readonly string[],
			finish: () => undefined as never,
			stdout: () => {},
			stderr: (text: string) => stderrChunks.push(text),
		};

		const postRun = extension.hooks?.postRun;
		if (!postRun) throw new Error("update notifier must define a post-run hook");
		await postRun(context, { status: "completed" });

		return { extension };
	}

	// ── Update available flow ─────────────────────────────────────────────

	describe("update available flow", () => {
		it("emits update notice when registry returns a newer version", async () => {
			const pkgName = uniquePackageName("update-avail");
			mockRegistryResponse("2.0.0");

			await runExtensionMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
			});

			expect(getOutput()).toContain("Update available");
			expect(getOutput()).toContain("1.0.0");
			expect(getOutput()).toContain("2.0.0");
		});

		it("includes upgrade instruction in update notice", async () => {
			const pkgName = uniquePackageName("upgrade-instr");
			mockRegistryResponse("3.0.0");

			await runExtensionMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
				packageManager: "npm",
				installScope: "local",
			});

			expect(getOutput()).toContain(`npm install ${pkgName}@latest`);
		});
	});

	// ── No update flow ────────────────────────────────────────────────────

	describe("no update flow", () => {
		it("does not emit notice when versions are equal", async () => {
			const pkgName = uniquePackageName("no-update-eq");
			mockRegistryResponse("1.0.0");

			await runExtensionMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
			});

			expect(getOutput()).toBe("");
		});

		it("does not emit notice when current is newer than registry", async () => {
			const pkgName = uniquePackageName("no-update-newer");
			mockRegistryResponse("0.9.0");

			await runExtensionMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
			});

			expect(getOutput()).toBe("");
		});
	});

	// ── Cache gate / stale cache flows ────────────────────────────────────

	describe("cache gate logic", () => {
		it("skips network check when cache is fresh (within intervalMs)", async () => {
			const pkgName = uniquePackageName("cache-fresh");

			// Write a recent timestamp with a cached newer version
			setCachedState({
				lastCheckedAt: Date.now(),
				latestVersion: "2.0.0",
				lastNotifiedVersion: undefined,
			});

			// Fetch should NOT be called since cache is fresh
			const fetchFn = mock(() =>
				Promise.resolve(
					new Response(JSON.stringify({ "dist-tags": { latest: "3.0.0" } }), {
						status: 200,
					}),
				),
			);
			mockFetch(fetchFn);

			await runExtensionMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
			});

			// Should emit notice from cached version, not from fetch
			expect(getOutput()).toContain("2.0.0");
			expect(getOutput()).not.toContain("3.0.0");
		});

		it("performs network check when cache is stale (exceeds intervalMs)", async () => {
			const pkgName = uniquePackageName("cache-stale");

			// Write an old timestamp (well beyond default 24h)
			setCachedState({
				lastCheckedAt: 0,
				latestVersion: undefined,
				lastNotifiedVersion: undefined,
			});

			mockRegistryResponse("2.0.0");

			await runExtensionMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
			});

			expect(getOutput()).toContain("2.0.0");
		});

		it("respects custom intervalMs — cache still fresh", async () => {
			const pkgName = uniquePackageName("custom-interval-fresh");

			// Set lastCheckedAt to 500ms ago
			setCachedState({
				lastCheckedAt: Date.now() - 500,
				latestVersion: "2.0.0",
				lastNotifiedVersion: undefined,
			});

			// With intervalMs=1000, 500ms ago is still fresh — should use cache
			const fetchFn = mock(() =>
				Promise.resolve(
					new Response(JSON.stringify({ "dist-tags": { latest: "3.0.0" } }), {
						status: 200,
					}),
				),
			);
			mockFetch(fetchFn);

			await runExtensionMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
				intervalMs: 1000,
			});

			// Notice should come from cached version (2.0.0), not fetch (3.0.0)
			expect(getOutput()).toContain("2.0.0");
			expect(getOutput()).not.toContain("3.0.0");
		});

		it("refetches when custom intervalMs is exceeded", async () => {
			const pkgName = uniquePackageName("interval-exceeded");

			// Set lastCheckedAt to 2000ms ago
			setCachedState({
				lastCheckedAt: Date.now() - 2000,
				latestVersion: "1.5.0",
				lastNotifiedVersion: undefined,
			});

			// With intervalMs=1000, 2000ms ago is stale — should refetch
			mockRegistryResponse("3.0.0");

			await runExtensionMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
				intervalMs: 1000,
			});

			// Notice should come from fresh fetch (3.0.0)
			expect(getOutput()).toContain("3.0.0");
		});
	});

	// ── Network failure tolerance ─────────────────────────────────────────

	describe("failure tolerance", () => {
		it("does not emit notice when registry is unreachable", async () => {
			const pkgName = uniquePackageName("fail-no-notice");
			mockRegistryFailure();

			await runExtensionMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
			});

			expect(getOutput()).toBe("");
		});

		it("does not throw or set non-zero exit code on fetch failure", async () => {
			const pkgName = uniquePackageName("fail-exitcode");
			mockRegistryFailure();

			await runExtensionMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
			});

			expect(process.exitCode).toBeFalsy();
		});

		it("updates lastCheckedAt even on fetch failure to avoid hammering", async () => {
			const pkgName = uniquePackageName("fail-timestamp");
			mockRegistryFailure();

			const beforeRun = Date.now();
			await runExtensionMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
			});

			const state = getCachedState();
			expect(state).toBeDefined();
			if (!state) throw new Error("state should exist");
			expect(state.lastCheckedAt).toBeGreaterThanOrEqual(beforeRun);
		});

		it("swallows internal errors and never affects exit code", async () => {
			const pkgName = uniquePackageName("swallow-error");
			// Throw synchronously from fetch mock
			mockFetch(() => {
				throw new TypeError("Cannot read properties of undefined");
			});

			await runExtensionMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
			});

			expect(process.exitCode).toBeFalsy();
			expect(getOutput()).toBe("");
		});
	});

	// ── Timeout behavior ──────────────────────────────────────────────────

	describe("timeout behavior", () => {
		it("does not block command execution when fetch is slow", async () => {
			const pkgName = uniquePackageName("timeout-nonblock");
			// Simulate a very slow fetch that would hang
			mockFetch(
				(_input, init) =>
					new Promise<Response>((_resolve, reject) => {
						if (init?.signal) {
							init.signal.addEventListener("abort", () => {
								reject(new DOMException("The operation was aborted.", "AbortError"));
							});
						}
					}),
			);

			const start = Date.now();
			const result = await runExtensionMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
				timeoutMs: 100, // Very short timeout
			});
			const elapsed = Date.now() - start;

			expect(result.extension.hooks?.postRun).toBeDefined();
			// Should complete quickly (timeout + overhead), not hang
			expect(elapsed).toBeLessThan(5000);
			// No notice on timeout
			expect(getOutput()).toBe("");
		});

		it("respects custom timeoutMs", async () => {
			const pkgName = uniquePackageName("custom-timeout");
			mockFetch(
				(_input, init) =>
					new Promise<Response>((_resolve, reject) => {
						if (init?.signal) {
							init.signal.addEventListener("abort", () => {
								reject(new DOMException("The operation was aborted.", "AbortError"));
							});
						}
					}),
			);

			const start = Date.now();
			await runExtensionMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
				timeoutMs: 50,
			});
			const elapsed = Date.now() - start;

			// Should complete relatively close to the timeout value
			expect(elapsed).toBeLessThan(2000);
		});
	});

	// ── Dedupe behavior ───────────────────────────────────────────────────

	describe("dedupe behavior", () => {
		it("skips check on second invocation with same state (process dedupe)", async () => {
			const pkgName = uniquePackageName("dedupe-process");
			mockRegistryResponse("2.0.0");

			// First invocation — should emit notice
			await runExtensionMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
			});
			expect(getOutput()).toContain("Update available");

			// Clear stderr for second check
			stderrChunks = [];

			// Second invocation against the same cache adapter — deduped via
			// the persisted lastNotifiedVersion (process-level state is gone)
			await runExtensionMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
			});
			expect(getOutput()).toBe("");
		});

		it("does not re-notify for same version already notified (persisted dedupe)", async () => {
			const pkgName = uniquePackageName("dedupe-persist");

			// Pre-seed: we already notified about 2.0.0
			setCachedState({
				lastCheckedAt: 0,
				latestVersion: "2.0.0",
				lastNotifiedVersion: "2.0.0",
			});

			mockRegistryResponse("2.0.0");

			await runExtensionMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
			});

			// Should NOT notify again since lastNotifiedVersion matches
			expect(getOutput()).toBe("");
		});

		it("notifies again when a newer version appears after previous notification", async () => {
			const pkgName = uniquePackageName("dedupe-new-ver");

			// Pre-seed: we already notified about 2.0.0
			setCachedState({
				lastCheckedAt: 0,
				latestVersion: "2.0.0",
				lastNotifiedVersion: "2.0.0",
			});

			// New version 3.0.0 is available
			mockRegistryResponse("3.0.0");

			await runExtensionMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
			});

			// Should notify about the new 3.0.0 version
			expect(getOutput()).toContain("3.0.0");
		});
	});

	// ── Option behavior ───────────────────────────────────────────────────

	describe("option behavior", () => {
		it("uses global commands when installScope is explicitly global", async () => {
			const pkgName = uniquePackageName("explicit-global");
			mockRegistryResponse("2.0.0");

			await runExtensionMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
				packageManager: "bun",
				installScope: "global",
			});

			expect(getOutput()).toContain(`bun add -g ${pkgName}@latest`);
		});

		it("uses local commands when installScope is explicitly local", async () => {
			const pkgName = uniquePackageName("explicit-local");
			mockRegistryResponse("2.0.0");

			await runExtensionMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
				packageManager: "npm",
				installScope: "local",
			});

			expect(getOutput()).toContain(`npm install ${pkgName}@latest`);
		});

		it("infers global npm installs from npm_config_global", async () => {
			const pkgName = uniquePackageName("npm-global-env");
			delete process.env.npm_config_user_agent;
			process.env.npm_execpath = "/usr/local/bin/npm";
			process.env.npm_config_global = "true";
			mockRegistryResponse("2.0.0");

			await runExtensionMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
			});

			expect(getOutput()).toContain(`npm install -g ${pkgName}@latest`);
		});

		it("infers bun from npm_execpath when user agent is missing", async () => {
			const pkgName = uniquePackageName("npm-execpath-bun");
			delete process.env.npm_config_user_agent;
			delete process.env.BUN_INSTALL;
			delete process.env.PREFIX;
			delete process.env.npm_config_prefix;
			delete process.env.PNPM_HOME;
			delete process.env.npm_config_global;
			process.env.npm_execpath = "/opt/homebrew/bin/bun";
			mockRegistryResponse("2.0.0");

			await runExtensionMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
			});

			// With no scope env vars set, default is "global"
			expect(getOutput()).toContain(`bun add -g ${pkgName}@latest`);
		});

		it("infers global bun installs from BUN_INSTALL-owned paths when user agent is missing", async () => {
			const pkgName = uniquePackageName("bun-install-global");
			delete process.env.npm_config_user_agent;
			delete process.env.npm_execpath;
			process.env.BUN_INSTALL = "/tmp/.bun";
			process.argv = [
				"/tmp/.bun/bin/test-cli",
				"/tmp/.bun/install/global/node_modules/test-cli/bin.js",
			];
			mockRegistryResponse("2.0.0");

			await runExtensionMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
			});

			expect(getOutput()).toContain(`bun add -g ${pkgName}@latest`);
		});

		it("infers local installs from node_modules paths", async () => {
			const pkgName = uniquePackageName("local-node-modules");
			delete process.env.npm_config_user_agent;
			delete process.env.npm_execpath;
			delete process.env.BUN_INSTALL;
			delete process.env.PREFIX;
			delete process.env.npm_config_prefix;
			delete process.env.npm_config_global;
			delete process.env.PNPM_HOME;
			const cwd = process.cwd();
			process.argv = [
				`${cwd}/node_modules/.bin/test-cli`,
				`${cwd}/node_modules/test-cli/dist/index.js`,
			];
			mockRegistryResponse("2.0.0");

			await runExtensionMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
				packageManager: "bun",
			});

			expect(getOutput()).toContain(`bun add ${pkgName}@latest`);
		});

		it("passes inferred installScope to updateCommand callback", async () => {
			const pkgName = uniquePackageName("update-command-callback");
			process.env.npm_config_global = "true";
			mockRegistryResponse("2.0.0");

			await runExtensionMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
				packageManager: "npm",
				updateCommand: (_name, packageManager, installScope) => `${packageManager}:${installScope}`,
			});

			expect(getOutput()).toContain("npm:global");
		});

		it("does not persist cache by default when adapter is omitted", async () => {
			const pkgName = uniquePackageName("no-default-cache");
			let fetchCalls = 0;
			mockFetch(() => {
				fetchCalls++;
				return Promise.resolve(
					new Response(JSON.stringify({ "dist-tags": { latest: "2.0.0" } }), {
						status: 200,
					}),
				);
			});

			await runExtensionMiddleware(
				{
					currentVersion: "1.0.0",
					packageName: pkgName,
					intervalMs: Number.MAX_SAFE_INTEGER,
				},
				{ disableDefaultCache: true },
			);

			await runExtensionMiddleware(
				{
					currentVersion: "1.0.0",
					packageName: pkgName,
					intervalMs: Number.MAX_SAFE_INTEGER,
				},
				{ disableDefaultCache: true },
			);

			expect(fetchCalls).toBe(2);
		});

		it("uses explicit packageName over command meta name", async () => {
			const pkgName = uniquePackageName("explicit-pkg");
			let capturedUrl = "";
			mockFetch((input) => {
				capturedUrl = typeof input === "string" ? input : input.toString();
				return Promise.resolve(
					new Response(JSON.stringify({ "dist-tags": { latest: "2.0.0" } }), {
						status: 200,
					}),
				);
			});

			await runExtensionMiddleware(
				{
					currentVersion: "1.0.0",
					packageName: pkgName,
				},
				{ commandName: "different-cmd-name" },
			);

			// Should use the explicit packageName in the fetch URL
			expect(capturedUrl).toContain(encodeURIComponent(pkgName));
			expect(capturedUrl).not.toContain("different-cmd-name");
		});

		it("uses custom registryUrl for fetch", async () => {
			const pkgName = uniquePackageName("custom-registry");
			let capturedUrl = "";
			mockFetch((input) => {
				capturedUrl = typeof input === "string" ? input : input.toString();
				return Promise.resolve(
					new Response(JSON.stringify({ "dist-tags": { latest: "2.0.0" } }), {
						status: 200,
					}),
				);
			});

			await runExtensionMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
				registryUrl: "https://custom-registry.example.com",
			});

			expect(capturedUrl).toStartWith("https://custom-registry.example.com/");
		});

		it("uses custom updateCommand in the notice", async () => {
			const pkgName = uniquePackageName("custom-update-cmd");
			mockRegistryResponse("2.0.0");

			await runExtensionMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
				updateCommand: "brew upgrade my-cli",
			});

			expect(getOutput()).toContain("brew upgrade my-cli");
		});
	});

	// ── Post-run ordering ─────────────────────────────────────────────────

	describe("post-run ordering", () => {
		it("runs after the command action", async () => {
			const pkgName = uniquePackageName("ordering");
			mockRegistryResponse("2.0.0");
			const executionOrder: string[] = [];
			const app = new Crust(pkgName)
				.extend(updateNotifier({ currentVersion: "1.0.0", packageName: pkgName }))
				.action(() => {
					executionOrder.push("command");
				});

			await app.run([], { stderr: () => executionOrder.push("notice") });

			expect(executionOrder).toEqual(["command", "notice"]);
		});

		it("does not run after a failed command", async () => {
			const pkgName = uniquePackageName("failed-command");
			let fetchCalled = false;
			mockFetch(() => {
				fetchCalled = true;
				return Promise.resolve(
					new Response(JSON.stringify({ "dist-tags": { latest: "2.0.0" } }), { status: 200 }),
				);
			});
			const app = new Crust(pkgName)
				.extend(updateNotifier({ currentVersion: "1.0.0", packageName: pkgName }))
				.action(() => {
					throw new Error("command failed");
				});

			await expect(app.run([])).rejects.toThrow("command failed");

			expect(fetchCalled).toBe(false);
		});
	});

	// ── Integration with Crust ──────────────────────────────────────────

	describe("Crust.execute() integration", () => {
		it("works as an extension passed to Crust.execute()", async () => {
			const pkgName = uniquePackageName("runcommand");
			mockRegistryResponse("5.0.0");

			let commandExecuted = false;
			const app = new Crust(pkgName, { description: "Test" })
				.extend(
					updateNotifier({
						currentVersion: "1.0.0",
						packageName: pkgName,
					}),
				)
				.action(() => {
					commandExecuted = true;
				});

			await app.execute({ argv: [] });

			expect(commandExecuted).toBe(true);
			expect(getOutput()).toContain("Update available");
			expect(getOutput()).toContain("5.0.0");
		});

		it("does not interfere with other extensions", async () => {
			const pkgName = uniquePackageName("other-extensions");
			mockRegistryResponse("2.0.0");

			let commandExecuted = false;

			// Combine with a custom no-op extension
			const otherExtension = defineExtension("test-other");

			const app = new Crust(pkgName, { description: "Test" })
				.extend(otherExtension)
				.extend(
					updateNotifier({
						currentVersion: "1.0.0",
						packageName: pkgName,
					}),
				)
				.action(() => {
					commandExecuted = true;
				});

			await app.execute({ argv: [] });

			expect(commandExecuted).toBe(true);
			expect(getOutput()).toContain("Update available");
		});

		it("does not break command execution when registry is down", async () => {
			const pkgName = uniquePackageName("registry-down");
			mockRegistryFailure();

			let commandExecuted = false;
			const app = new Crust(pkgName, { description: "Test" })
				.extend(
					updateNotifier({
						currentVersion: "1.0.0",
						packageName: pkgName,
					}),
				)
				.action(() => {
					commandExecuted = true;
				});

			await app.execute({ argv: [] });

			expect(commandExecuted).toBe(true);
			expect(getOutput()).toBe("");
		});
	});

	describe("Crust.run() integration", () => {
		it("writes update notices through injected stderr", async () => {
			const pkgName = uniquePackageName("injected-stderr");
			mockRegistryResponse("5.0.0");
			const stderr: string[] = [];
			const app = new Crust(pkgName)
				.extend(
					updateNotifier({
						currentVersion: "1.0.0",
						packageName: pkgName,
					}),
				)
				.action(() => {});

			await app.run([], { stderr: (text) => stderr.push(text) });

			expect(stderr.join("\n")).toContain("Update available");
			expect(stderr.join("\n")).toContain("5.0.0");
			expect(processStderrChunks.join("")).toBe("");
		});
	});
});
