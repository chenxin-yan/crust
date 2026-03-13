import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { Crust } from "@crustjs/core";
import {
	fetchLatestVersion,
	isNewerVersion,
	parseSemver,
	type UpdateNotifierCacheAdapter,
	type UpdateNotifierState,
	updateNotifierPlugin,
} from "./update-notifier.ts";

// ────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ────────────────────────────────────────────────────────────────────────────

/** Helper to mock globalThis.fetch without type errors from `preconnect`. */
function mockFetch(
	fn: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>,
) {
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
// parseSemver
// ────────────────────────────────────────────────────────────────────────────

describe("parseSemver", () => {
	it("parses standard semver", () => {
		expect(parseSemver("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
	});

	it("parses version with leading v", () => {
		expect(parseSemver("v1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
	});

	it("parses version 0.0.0", () => {
		expect(parseSemver("0.0.0")).toEqual({ major: 0, minor: 0, patch: 0 });
	});

	it("parses large version numbers", () => {
		expect(parseSemver("100.200.300")).toEqual({
			major: 100,
			minor: 200,
			patch: 300,
		});
	});

	it("strips prerelease suffix", () => {
		expect(parseSemver("1.2.3-beta.1")).toEqual({
			major: 1,
			minor: 2,
			patch: 3,
		});
	});

	it("strips build metadata", () => {
		expect(parseSemver("1.2.3+build.456")).toEqual({
			major: 1,
			minor: 2,
			patch: 3,
		});
	});

	it("strips prerelease and build metadata combined", () => {
		expect(parseSemver("1.2.3-rc.1+sha.abc")).toEqual({
			major: 1,
			minor: 2,
			patch: 3,
		});
	});

	it("returns null for empty string", () => {
		expect(parseSemver("")).toBeNull();
	});

	it("returns null for non-version string", () => {
		expect(parseSemver("not-a-version")).toBeNull();
	});

	it("returns null for two-part version", () => {
		expect(parseSemver("1.2")).toBeNull();
	});

	it("returns null for four-part version", () => {
		expect(parseSemver("1.2.3.4")).toBeNull();
	});

	it("returns null for NaN segments", () => {
		expect(parseSemver("a.b.c")).toBeNull();
	});

	it("returns null for Infinity", () => {
		expect(parseSemver("Infinity.0.0")).toBeNull();
	});

	it("returns null for negative segments", () => {
		expect(parseSemver("-1.0.0")).toBeNull();
	});
});

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

	it("handles prerelease current — compares base only", () => {
		// 1.2.3-beta.1 base is 1.2.3, latest 1.2.3 is not newer
		expect(isNewerVersion("1.2.3-beta.1", "1.2.3")).toBe(false);
	});

	it("handles prerelease latest — compares base only", () => {
		// 1.2.4-rc.1 base is 1.2.4 which is newer than 1.2.3
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

		const result = await fetchLatestVersion(
			"my-cli",
			"https://registry.npmjs.org",
			5000,
		);
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

		await fetchLatestVersion(
			"@scope/my-cli",
			"https://registry.npmjs.org",
			5000,
		);
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
		mockFetch(() =>
			Promise.resolve(new Response("Not Found", { status: 404 })),
		);

		const result = await fetchLatestVersion(
			"nonexistent-package",
			"https://registry.npmjs.org",
			5000,
		);
		expect(result).toBeNull();
	});

	it("returns null on network error", async () => {
		mockFetch(() => Promise.reject(new Error("Network failure")));

		const result = await fetchLatestVersion(
			"my-cli",
			"https://registry.npmjs.org",
			5000,
		);
		expect(result).toBeNull();
	});

	it("returns null when dist-tags is missing", async () => {
		mockFetch(() =>
			Promise.resolve(new Response(JSON.stringify({}), { status: 200 })),
		);

		const result = await fetchLatestVersion(
			"my-cli",
			"https://registry.npmjs.org",
			5000,
		);
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

		const result = await fetchLatestVersion(
			"my-cli",
			"https://registry.npmjs.org",
			5000,
		);
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

		const result = await fetchLatestVersion(
			"my-cli",
			"https://registry.npmjs.org",
			5000,
		);
		expect(result).toBeNull();
	});

	it("returns null on malformed JSON response", async () => {
		mockFetch(() => Promise.resolve(new Response("not json", { status: 200 })));

		const result = await fetchLatestVersion(
			"my-cli",
			"https://registry.npmjs.org",
			5000,
		);
		expect(result).toBeNull();
	});

	it("returns null on timeout (abort)", async () => {
		mockFetch(
			(_input, init) =>
				new Promise<Response>((_resolve, reject) => {
					// Listen for abort and reject like a real fetch would
					if (init?.signal) {
						init.signal.addEventListener("abort", () => {
							reject(
								new DOMException("The operation was aborted.", "AbortError"),
							);
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
// updateNotifierPlugin — middleware integration tests
// ────────────────────────────────────────────────────────────────────────────

describe("updateNotifierPlugin middleware", () => {
	const originalFetch = globalThis.fetch;
	const originalProcessArgv = [...process.argv];
	const originalUserAgent = process.env.npm_config_user_agent;
	const originalNpmExecpath = process.env.npm_execpath;
	const originalNpmConfigGlobal = process.env.npm_config_global;
	const originalBunInstall = process.env.BUN_INSTALL;
	let originalLog: typeof console.log;
	let stdoutChunks: string[];
	let cachedState: UpdateNotifierState | undefined;

	/** Auto-incrementing counter to generate unique package names per test. */
	let testCounter = 0;

	beforeEach(() => {
		testCounter++;
		cachedState = undefined;

		// Capture stdout (console.log) for update notice assertions
		stdoutChunks = [];
		originalLog = console.log;
		console.log = (...args: unknown[]) => {
			stdoutChunks.push(args.map((arg) => String(arg)).join(" "));
		};
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		console.log = originalLog;
		process.argv = [...originalProcessArgv];
		process.env.npm_config_user_agent = originalUserAgent;
		process.env.npm_execpath = originalNpmExecpath;
		process.env.npm_config_global = originalNpmConfigGlobal;
		process.env.BUN_INSTALL = originalBunInstall;
		process.exitCode = 0;
	});

	function getStdout() {
		return stdoutChunks.join("\n");
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
	function makeCommand(name = "test-cli") {
		const node = new Crust(name)._node;
		node.run = () => {};
		return node;
	}

	/** Build a mock PluginState from a Map. */
	function makePluginState(map: Map<string, unknown>) {
		return {
			get: <T = unknown>(key: string) => map.get(key) as T | undefined,
			has: (key: string) => map.has(key),
			set: (key: string, value: unknown) => map.set(key, value),
			delete: (key: string) => map.delete(key),
		};
	}

	/**
	 * Helper to invoke the plugin middleware directly with controlled context.
	 */
	async function runPluginMiddleware(
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
			state?: Map<string, unknown>;
			disableDefaultCache?: boolean;
		},
	) {
		const { intervalMs, cache: cacheAdapter, ...rest } = options;
		const resolvedAdapter = overrides?.disableDefaultCache
			? cacheAdapter
			: (cacheAdapter ?? memoryCache);
		const pluginOptions = {
			...rest,
			...(resolvedAdapter
				? { cache: { adapter: resolvedAdapter, intervalMs } }
				: {}),
		};
		const plugin = updateNotifierPlugin(pluginOptions);

		if (!plugin.middleware) {
			return { plugin, ran: false, state: new Map<string, unknown>() };
		}

		let commandRan = false;
		const stateMap = overrides?.state ?? new Map<string, unknown>();
		const rootCommand = makeCommand(
			overrides?.commandName ?? options.packageName,
		);

		const context = {
			argv: [] as readonly string[],
			rootCommand,
			state: makePluginState(stateMap),
			route: null,
			input: null,
		};

		const next = async () => {
			commandRan = true;
		};

		await plugin.middleware(
			context as Parameters<typeof plugin.middleware>[0],
			next,
		);

		return { plugin, ran: commandRan, state: stateMap };
	}

	// ── Update available flow ─────────────────────────────────────────────

	describe("update available flow", () => {
		it("emits update notice when registry returns a newer version", async () => {
			const pkgName = uniquePackageName("update-avail");
			mockRegistryResponse("2.0.0");

			await runPluginMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
			});

			expect(getStdout()).toContain("Update available");
			expect(getStdout()).toContain("1.0.0");
			expect(getStdout()).toContain("2.0.0");
		});

		it("includes upgrade instruction in update notice", async () => {
			const pkgName = uniquePackageName("upgrade-instr");
			mockRegistryResponse("3.0.0");

			await runPluginMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
				packageManager: "npm",
			});

			expect(getStdout()).toContain(`npm install ${pkgName}@latest`);
		});
	});

	// ── No update flow ────────────────────────────────────────────────────

	describe("no update flow", () => {
		it("does not emit notice when versions are equal", async () => {
			const pkgName = uniquePackageName("no-update-eq");
			mockRegistryResponse("1.0.0");

			await runPluginMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
			});

			expect(getStdout()).toBe("");
		});

		it("does not emit notice when current is newer than registry", async () => {
			const pkgName = uniquePackageName("no-update-newer");
			mockRegistryResponse("0.9.0");

			await runPluginMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
			});

			expect(getStdout()).toBe("");
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

			await runPluginMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
			});

			// Should emit notice from cached version, not from fetch
			expect(getStdout()).toContain("2.0.0");
			expect(getStdout()).not.toContain("3.0.0");
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

			await runPluginMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
			});

			expect(getStdout()).toContain("2.0.0");
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

			await runPluginMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
				intervalMs: 1000,
			});

			// Notice should come from cached version (2.0.0), not fetch (3.0.0)
			expect(getStdout()).toContain("2.0.0");
			expect(getStdout()).not.toContain("3.0.0");
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

			await runPluginMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
				intervalMs: 1000,
			});

			// Notice should come from fresh fetch (3.0.0)
			expect(getStdout()).toContain("3.0.0");
		});
	});

	// ── Network failure tolerance ─────────────────────────────────────────

	describe("failure tolerance", () => {
		it("does not emit notice when registry is unreachable", async () => {
			const pkgName = uniquePackageName("fail-no-notice");
			mockRegistryFailure();

			await runPluginMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
			});

			expect(getStdout()).toBe("");
		});

		it("does not throw or set non-zero exit code on fetch failure", async () => {
			const pkgName = uniquePackageName("fail-exitcode");
			mockRegistryFailure();

			await runPluginMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
			});

			expect(process.exitCode).toBeFalsy();
		});

		it("updates lastCheckedAt even on fetch failure to avoid hammering", async () => {
			const pkgName = uniquePackageName("fail-timestamp");
			mockRegistryFailure();

			const beforeRun = Date.now();
			await runPluginMiddleware({
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

			await runPluginMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
			});

			expect(process.exitCode).toBeFalsy();
			expect(getStdout()).toBe("");
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
								reject(
									new DOMException("The operation was aborted.", "AbortError"),
								);
							});
						}
					}),
			);

			const start = Date.now();
			const result = await runPluginMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
				timeoutMs: 100, // Very short timeout
			});
			const elapsed = Date.now() - start;

			// Command should have run
			expect(result.ran).toBe(true);
			// Should complete quickly (timeout + overhead), not hang
			expect(elapsed).toBeLessThan(5000);
			// No notice on timeout
			expect(getStdout()).toBe("");
		});

		it("respects custom timeoutMs", async () => {
			const pkgName = uniquePackageName("custom-timeout");
			mockFetch(
				(_input, init) =>
					new Promise<Response>((_resolve, reject) => {
						if (init?.signal) {
							init.signal.addEventListener("abort", () => {
								reject(
									new DOMException("The operation was aborted.", "AbortError"),
								);
							});
						}
					}),
			);

			const start = Date.now();
			await runPluginMiddleware({
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

			// Share state between invocations to simulate same process
			const sharedState = new Map<string, unknown>();

			// First invocation — should emit notice
			await runPluginMiddleware(
				{
					currentVersion: "1.0.0",
					packageName: pkgName,
				},
				{ state: sharedState },
			);
			expect(getStdout()).toContain("Update available");

			// Clear stderr for second check
			stdoutChunks = [];

			// Second invocation with same state — should be deduped
			await runPluginMiddleware(
				{
					currentVersion: "1.0.0",
					packageName: pkgName,
				},
				{ state: sharedState },
			);
			expect(getStdout()).toBe("");
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

			await runPluginMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
			});

			// Should NOT notify again since lastNotifiedVersion matches
			expect(getStdout()).toBe("");
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

			await runPluginMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
			});

			// Should notify about the new 3.0.0 version
			expect(getStdout()).toContain("3.0.0");
		});
	});

	// ── Option behavior ───────────────────────────────────────────────────

	describe("option behavior", () => {
		it("uses global commands when installScope is explicitly global", async () => {
			const pkgName = uniquePackageName("explicit-global");
			mockRegistryResponse("2.0.0");

			await runPluginMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
				packageManager: "bun",
				installScope: "global",
			});

			expect(getStdout()).toContain(`bun add -g ${pkgName}@latest`);
		});

		it("uses local commands when installScope is explicitly local", async () => {
			const pkgName = uniquePackageName("explicit-local");
			mockRegistryResponse("2.0.0");

			await runPluginMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
				packageManager: "npm",
				installScope: "local",
			});

			expect(getStdout()).toContain(`npm install ${pkgName}@latest`);
		});

		it("infers global npm installs from npm_config_global", async () => {
			const pkgName = uniquePackageName("npm-global-env");
			delete process.env.npm_config_user_agent;
			process.env.npm_execpath = "/usr/local/bin/npm";
			process.env.npm_config_global = "true";
			mockRegistryResponse("2.0.0");

			await runPluginMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
			});

			expect(getStdout()).toContain(`npm install -g ${pkgName}@latest`);
		});

		it("infers bun from npm_execpath when user agent is missing", async () => {
			const pkgName = uniquePackageName("npm-execpath-bun");
			delete process.env.npm_config_user_agent;
			process.env.npm_execpath = "/opt/homebrew/bin/bun";
			mockRegistryResponse("2.0.0");

			await runPluginMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
			});

			expect(getStdout()).toContain(`bun add ${pkgName}@latest`);
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

			await runPluginMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
			});

			expect(getStdout()).toContain(`bun add -g ${pkgName}@latest`);
		});

		it("infers local installs from node_modules paths", async () => {
			const pkgName = uniquePackageName("local-node-modules");
			delete process.env.npm_config_user_agent;
			delete process.env.npm_execpath;
			delete process.env.BUN_INSTALL;
			process.argv = [
				"/Users/test/project/node_modules/.bin/test-cli",
				"/Users/test/project/node_modules/test-cli/dist/index.js",
			];
			mockRegistryResponse("2.0.0");

			await runPluginMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
				packageManager: "bun",
			});

			expect(getStdout()).toContain(`bun add ${pkgName}@latest`);
		});

		it("passes inferred installScope to updateCommand callback", async () => {
			const pkgName = uniquePackageName("update-command-callback");
			process.env.npm_config_global = "true";
			mockRegistryResponse("2.0.0");

			await runPluginMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
				packageManager: "npm",
				updateCommand: (_name, packageManager, installScope) =>
					`${packageManager}:${installScope}`,
			});

			expect(getStdout()).toContain("npm:global");
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

			await runPluginMiddleware(
				{
					currentVersion: "1.0.0",
					packageName: pkgName,
					intervalMs: Number.MAX_SAFE_INTEGER,
				},
				{ disableDefaultCache: true },
			);

			await runPluginMiddleware(
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

			await runPluginMiddleware(
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

			await runPluginMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
				registryUrl: "https://custom-registry.example.com",
			});

			expect(capturedUrl).toStartWith("https://custom-registry.example.com/");
		});

		it("uses custom updateCommand in the notice", async () => {
			const pkgName = uniquePackageName("custom-update-cmd");
			mockRegistryResponse("2.0.0");

			await runPluginMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
				updateCommand: "brew upgrade my-cli",
			});

			expect(getStdout()).toContain("brew upgrade my-cli");
		});
	});

	// ── Middleware ordering ────────────────────────────────────────────────

	describe("middleware ordering", () => {
		it("runs command handler (next) before emitting update notice", async () => {
			const pkgName = uniquePackageName("ordering");
			mockRegistryResponse("2.0.0");

			const executionOrder: string[] = [];

			const plugin = updateNotifierPlugin({
				currentVersion: "1.0.0",
				packageName: pkgName,
			});

			const stateMap = new Map<string, unknown>();
			const rootCommand = makeCommand(pkgName);

			const context = {
				argv: [] as readonly string[],
				rootCommand,
				state: makePluginState(stateMap),
				route: null,
				input: null,
			};

			// Override console.log to track ordering
			const prevLog = console.log;
			console.log = (...args: unknown[]) => {
				executionOrder.push("notice");
				stdoutChunks.push(args.map((arg) => String(arg)).join(" "));
			};

			await plugin.middleware?.(
				context as Parameters<NonNullable<typeof plugin.middleware>>[0],
				async () => {
					executionOrder.push("command");
				},
			);

			console.log = prevLog;

			// Command must run before notice
			expect(executionOrder).toContain("command");
			expect(executionOrder).toContain("notice");
			expect(executionOrder.indexOf("command")).toBeLessThan(
				executionOrder.indexOf("notice"),
			);
		});

		it("calls next() even if notifier work would fail", async () => {
			const pkgName = uniquePackageName("next-on-fail");
			// Throw from fetch to simulate a broken state
			mockFetch(() => {
				throw new Error("Catastrophic failure");
			});

			const result = await runPluginMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
			});

			// Command should still have run via next()
			expect(result.ran).toBe(true);
		});
	});

	// ── Integration with Crust.execute() ────────────────────────────────

	describe("Crust.execute() integration", () => {
		it("works as a plugin passed to Crust.execute()", async () => {
			const pkgName = uniquePackageName("runcommand");
			mockRegistryResponse("5.0.0");

			let commandExecuted = false;
			const app = new Crust(pkgName)
				.meta({ description: "Test" })
				.use(
					updateNotifierPlugin({
						currentVersion: "1.0.0",
						packageName: pkgName,
					}),
				)
				.run(() => {
					commandExecuted = true;
				});

			await app.execute({ argv: [] });

			expect(commandExecuted).toBe(true);
			expect(getStdout()).toContain("Update available");
			expect(getStdout()).toContain("5.0.0");
		});

		it("does not interfere with other plugins", async () => {
			const pkgName = uniquePackageName("other-plugins");
			mockRegistryResponse("2.0.0");

			let commandExecuted = false;

			// Combine with a custom no-op plugin
			const otherPlugin = {
				name: "test-other",
				async middleware(
					_ctx: Parameters<
						NonNullable<import("@crustjs/core").CrustPlugin["middleware"]>
					>[0],
					next: () => Promise<void>,
				) {
					await next();
				},
			};

			const app = new Crust(pkgName)
				.meta({ description: "Test" })
				.use(otherPlugin)
				.use(
					updateNotifierPlugin({
						currentVersion: "1.0.0",
						packageName: pkgName,
					}),
				)
				.run(() => {
					commandExecuted = true;
				});

			await app.execute({ argv: [] });

			expect(commandExecuted).toBe(true);
			expect(getStdout()).toContain("Update available");
		});

		it("does not break command execution when registry is down", async () => {
			const pkgName = uniquePackageName("registry-down");
			mockRegistryFailure();

			let commandExecuted = false;
			const app = new Crust(pkgName)
				.meta({ description: "Test" })
				.use(
					updateNotifierPlugin({
						currentVersion: "1.0.0",
						packageName: pkgName,
					}),
				)
				.run(() => {
					commandExecuted = true;
				});

			await app.execute({ argv: [] });

			expect(commandExecuted).toBe(true);
			expect(getStdout()).toBe("");
		});
	});
});
