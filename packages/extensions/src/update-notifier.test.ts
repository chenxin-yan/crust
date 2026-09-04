import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Crust } from "@crustjs/core";
import { snapshotCommand } from "@crustjs/core/tooling";

import {
	createStoreCacheAdapter,
	fetchLatestVersion,
	isNewerVersion,
	type UpdateNotifierCacheAdapter,
	type UpdateNotifierOptions,
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

	it("orders prerelease identifiers per SemVer precedence", () => {
		expect(isNewerVersion("1.0.0-alpha.2", "1.0.0-alpha.10")).toBe(true);
		expect(isNewerVersion("1.0.0-alpha", "1.0.0-alpha.1")).toBe(true);
		expect(isNewerVersion("1.0.0-1", "1.0.0-alpha")).toBe(true);
		expect(isNewerVersion("1.0.0+build.1", "1.0.0+build.2")).toBe(false);
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
			capturedUrl = input.toString();
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
			capturedUrl = input.toString();
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
	const originalUserAgent = process.env.npm_config_user_agent;
	const originalNpmExecpath = process.env.npm_execpath;
	const originalXdgStateHome = process.env.XDG_STATE_HOME;
	let originalStderrWrite: typeof process.stderr.write;
	let originalConsoleError: typeof console.error;
	let processStderrChunks: string[];
	let stderrChunks: string[];
	let cachedState: UpdateNotifierState | undefined;
	let tempDirs: string[];

	/** Auto-incrementing counter to generate unique package names per test. */
	let testCounter = 0;

	beforeEach(async () => {
		testCounter++;
		cachedState = undefined;
		tempDirs = [];

		// Default-on built-in cache writes to stateDir(); sandbox it per test so
		// suites that don't care about caching never touch the real user state dir.
		const stateHome = await mkdtemp(join(tmpdir(), "crust-update-notifier-state-"));
		tempDirs.push(stateHome);
		process.env.XDG_STATE_HOME = stateHome;

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

	afterEach(async () => {
		globalThis.fetch = originalFetch;
		process.stderr.write = originalStderrWrite;
		console.error = originalConsoleError;
		restoreEnv("npm_config_user_agent", originalUserAgent);
		restoreEnv("npm_execpath", originalNpmExecpath);
		restoreEnv("XDG_STATE_HOME", originalXdgStateHome);
		await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
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

	/**
	 * Points XDG_STATE_HOME at a plain file so any built-in cache read/write
	 * fails loudly; returns the file path to assert it stays untouched.
	 */
	async function makeUnusableStateHome(label: string): Promise<string> {
		const stateHomeFile = join(
			await mkdtemp(join(tmpdir(), `crust-update-notifier-${label}-`)),
			"not-a-directory",
		);
		tempDirs.push(join(stateHomeFile, ".."));
		await writeFile(stateHomeFile, "unchanged");
		process.env.XDG_STATE_HOME = stateHomeFile;
		return stateHomeFile;
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
		options: Omit<UpdateNotifierOptions, "cache"> & {
			intervalMs?: number;
			cache?: UpdateNotifierCacheAdapter | false;
		},
		overrides?: {
			commandName?: string;
			useBuiltInCache?: boolean;
		},
	) {
		const { intervalMs, cache, ...rest } = options;
		const resolvedCache = overrides?.useBuiltInCache ? undefined : (cache ?? memoryCache);
		const extensionOptions = {
			...rest,
			...(resolvedCache === false
				? { cache: false as const }
				: resolvedCache
					? { cache: { adapter: resolvedCache, intervalMs } }
					: intervalMs !== undefined
						? { cache: { intervalMs } }
						: {}),
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
			ctx: {},
			finish: () => undefined as never,
			stdout: () => {},
			stderr: (text: string) => stderrChunks.push(text),
		};

		const postRun = extension.hooks?.postRun;
		if (!postRun) throw new Error("update notifier must define a post-run hook");
		await postRun(context, { status: "completed" });

		return { extension };
	}

	describe("built-in cache adapter", () => {
		it("round-trips notifier state at the adapter seam", async () => {
			const adapter = await createStoreCacheAdapter(
				uniquePackageName("adapter-round-trip"),
				"https://registry.npmjs.org",
			);
			const state: UpdateNotifierState = {
				lastCheckedAt: 123,
				latestVersion: "2.0.0",
				lastNotifiedVersion: "2.0.0",
			};

			expect(await adapter.read()).toBeNull();
			await adapter.write(state);
			expect(await adapter.read()).toEqual(state);
		});

		it("rejects state written for another registry", async () => {
			const packageName = uniquePackageName("adapter-registry");
			const publicRegistry = await createStoreCacheAdapter(
				packageName,
				"https://registry.npmjs.org",
			);
			await publicRegistry.write({ lastCheckedAt: 123, latestVersion: "2.0.0" });

			const privateRegistry = await createStoreCacheAdapter(
				packageName,
				"https://registry.example.com",
			);
			expect(await privateRegistry.read()).toBeNull();
		});
	});

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
			process.env.npm_config_user_agent = "npm/10.0.0 node/v22";
			mockRegistryResponse("3.0.0");

			await runExtensionMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
				updateCommand: { scope: "local" },
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

		it("refetches when elapsed equals intervalMs exactly (strict boundary)", async () => {
			const pkgName = uniquePackageName("ttl-boundary");
			const fixedNow = 1_700_000_000_000;
			const realNow = Date.now;
			Date.now = () => fixedNow;
			try {
				setCachedState({
					lastCheckedAt: fixedNow - 1000,
					latestVersion: "2.0.0",
					lastNotifiedVersion: undefined,
				});
				mockRegistryResponse("3.0.0");

				await runExtensionMiddleware({
					currentVersion: "1.0.0",
					packageName: pkgName,
					intervalMs: 1000,
				});

				// elapsed === intervalMs is stale (`<`, not `<=`) — fresh fetch wins
				expect(getOutput()).toContain("3.0.0");
			} finally {
				Date.now = realNow;
			}
		});

		it("treats a future lastCheckedAt as stale and rewrites it", async () => {
			const pkgName = uniquePackageName("future-timestamp");
			// Clock rollback / corrupt timestamp: without the elapsed >= 0 guard
			// this state would stay "fresh" forever and never be repaired.
			setCachedState({
				lastCheckedAt: Date.now() + 9e12,
				latestVersion: "2.0.0",
				lastNotifiedVersion: undefined,
			});
			mockRegistryResponse("3.0.0");

			await runExtensionMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
			});

			expect(getOutput()).toContain("3.0.0");
			const state = getCachedState();
			if (!state) throw new Error("state should exist");
			expect(state.lastCheckedAt).toBeLessThanOrEqual(Date.now());
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
		it("uses global commands when updateCommand scope is global", async () => {
			const pkgName = uniquePackageName("explicit-global");
			process.env.npm_config_user_agent = "bun/1.3.0";
			mockRegistryResponse("2.0.0");

			await runExtensionMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
				updateCommand: { scope: "global" },
			});

			expect(getOutput()).toContain(`bun add -g ${pkgName}@latest`);
		});

		it("uses local commands when updateCommand scope is local", async () => {
			const pkgName = uniquePackageName("explicit-local");
			process.env.npm_config_user_agent = "npm/10.0.0 node/v22";
			mockRegistryResponse("2.0.0");

			await runExtensionMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
				updateCommand: { scope: "local" },
			});

			expect(getOutput()).toContain(`npm install ${pkgName}@latest`);
		});

		it("infers bun from npm_execpath when user agent is missing", async () => {
			const pkgName = uniquePackageName("npm-execpath-bun");
			delete process.env.npm_config_user_agent;
			process.env.npm_execpath = "/opt/homebrew/bin/bun";
			mockRegistryResponse("2.0.0");

			await runExtensionMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
				updateCommand: { scope: "global" },
			});

			expect(getOutput()).toContain(`bun add -g ${pkgName}@latest`);
		});

		it("omits the update command when updateCommand is unset", async () => {
			const pkgName = uniquePackageName("commandless-default");
			mockRegistryResponse("2.0.0");

			await runExtensionMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
			});

			expect(getOutput()).toContain("Update available");
			expect(getOutput()).not.toContain("Run ");
			expect(getOutput()).not.toContain(`${pkgName}@latest`);
		});

		it("includes updateDocsUrl without generating an update command", async () => {
			const pkgName = uniquePackageName("docs-url");
			mockRegistryResponse("2.0.0");

			await runExtensionMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
				updateDocsUrl: "https://example.com/update",
			});

			expect(getOutput()).toContain("See");
			expect(getOutput()).toContain("https://example.com/update");
			expect(getOutput()).not.toContain("Run ");
		});

		it("passes package information to updateCommand callbacks", async () => {
			const pkgName = uniquePackageName("callback-info");
			const received: Array<{ packageName: string; packageManager: string }> = [];
			process.env.npm_config_user_agent = "pnpm/10.0.0 node/v22";
			mockRegistryResponse("2.0.0");

			await runExtensionMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
				updateCommand: (info) => {
					received.push(info);
					return "custom update";
				},
			});

			expect(received).toEqual([{ packageName: pkgName, packageManager: "pnpm" }]);
		});

		it("persists and deduplicates with the built-in cache by default", async () => {
			const pkgName = uniquePackageName("built-in-cache");
			const stateHome = process.env.XDG_STATE_HOME as string;
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
				{ currentVersion: "1.0.0", packageName: pkgName },
				{ useBuiltInCache: true },
			);
			expect(getOutput()).toContain("Update available");

			stderrChunks = [];
			await runExtensionMiddleware(
				{ currentVersion: "1.0.0", packageName: pkgName },
				{ useBuiltInCache: true },
			);

			expect(fetchCalls).toBe(1);
			expect(getOutput()).toBe("");
			const persisted = JSON.parse(
				await readFile(join(stateHome, pkgName, "update-notifier.json"), "utf8"),
			) as UpdateNotifierState;
			expect(persisted.latestVersion).toBe("2.0.0");
			expect(persisted.lastNotifiedVersion).toBe("2.0.0");
		});

		it("sanitizes scoped package names for the built-in state directory", async () => {
			const scopedName = `@crust-test/scoped-${testCounter}-${Date.now()}`;
			const stateHome = process.env.XDG_STATE_HOME as string;
			mockRegistryResponse("2.0.0");

			await runExtensionMiddleware(
				{ currentVersion: "1.0.0", packageName: scopedName },
				{ useBuiltInCache: true },
			);

			// A raw scoped name would make stateDir() throw and silently kill the notifier
			expect(getOutput()).toContain("Update available");
			const sanitized = encodeURIComponent(scopedName);
			const persisted = JSON.parse(
				await readFile(join(stateHome, sanitized, "update-notifier.json"), "utf8"),
			) as UpdateNotifierState;
			expect(persisted.latestVersion).toBe("2.0.0");
		});

		it("discards built-in cached state from a different registryUrl", async () => {
			const pkgName = uniquePackageName("registry-switch");
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
				{ currentVersion: "1.0.0", packageName: pkgName },
				{ useBuiltInCache: true },
			);
			expect(fetchCalls).toBe(1);

			// Cache is fresh, but a different registry must not reuse it
			await runExtensionMiddleware(
				{
					currentVersion: "1.0.0",
					packageName: pkgName,
					registryUrl: "https://private.example.com",
				},
				{ useBuiltInCache: true },
			);
			expect(fetchCalls).toBe(2);
		});

		it("treats a corrupt built-in cache file as empty and repairs it", async () => {
			const pkgName = uniquePackageName("corrupt-cache");
			const stateHome = process.env.XDG_STATE_HOME as string;
			await mkdir(join(stateHome, pkgName), { recursive: true });
			const cacheFile = join(stateHome, pkgName, "update-notifier.json");
			await writeFile(cacheFile, "not json");
			mockRegistryResponse("2.0.0");

			await runExtensionMiddleware(
				{ currentVersion: "1.0.0", packageName: pkgName },
				{ useBuiltInCache: true },
			);

			expect(getOutput()).toContain("Update available");
			const persisted = JSON.parse(await readFile(cacheFile, "utf8")) as UpdateNotifierState;
			expect(persisted.latestVersion).toBe("2.0.0");
		});

		it("honors intervalMs with the built-in cache when no adapter is given", async () => {
			const pkgName = uniquePackageName("builtin-interval");
			let fetchCalls = 0;
			mockFetch(() => {
				fetchCalls++;
				return Promise.resolve(
					new Response(JSON.stringify({ "dist-tags": { latest: "2.0.0" } }), {
						status: 200,
					}),
				);
			});

			// intervalMs: 0 disables reuse — the default 24h would dedupe to 1 fetch
			await runExtensionMiddleware(
				{ currentVersion: "1.0.0", packageName: pkgName, intervalMs: 0 },
				{ useBuiltInCache: true },
			);
			await runExtensionMiddleware(
				{ currentVersion: "1.0.0", packageName: pkgName, intervalMs: 0 },
				{ useBuiltInCache: true },
			);

			expect(fetchCalls).toBe(2);
		});

		it("does not read or write the built-in cache when cache is false", async () => {
			const pkgName = uniquePackageName("cache-disabled");
			const stateHomeFile = await makeUnusableStateHome("disabled");
			let fetchCalls = 0;
			mockFetch(() => {
				fetchCalls++;
				return Promise.resolve(
					new Response(JSON.stringify({ "dist-tags": { latest: "2.0.0" } }), {
						status: 200,
					}),
				);
			});

			await runExtensionMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
				cache: false,
			});
			expect(getOutput()).toContain("Update available");
			stderrChunks = [];
			await runExtensionMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
				cache: false,
			});
			// No persistence means no dedupe — the notice must reappear
			expect(getOutput()).toContain("Update available");

			expect(fetchCalls).toBe(2);
			expect(await readFile(stateHomeFile, "utf8")).toBe("unchanged");
		});

		it("uses a custom adapter without touching the built-in store", async () => {
			const pkgName = uniquePackageName("custom-cache");
			const stateHomeFile = await makeUnusableStateHome("custom");
			mockRegistryResponse("2.0.0");

			await runExtensionMiddleware({
				currentVersion: "1.0.0",
				packageName: pkgName,
				cache: memoryCache,
			});

			expect(getCachedState()?.latestVersion).toBe("2.0.0");
			expect(await readFile(stateHomeFile, "utf8")).toBe("unchanged");
		});

		it("uses explicit packageName over command meta name", async () => {
			const pkgName = uniquePackageName("explicit-pkg");
			let capturedUrl = "";
			mockFetch((input) => {
				capturedUrl = input.toString();
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
				capturedUrl = input.toString();
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

			await app.run([], undefined, { stderr: () => executionOrder.push("notice") });

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

			await app.run([], undefined, { stderr: (text) => stderr.push(text) });

			expect(stderr.join("\n")).toContain("Update available");
			expect(stderr.join("\n")).toContain("5.0.0");
			expect(processStderrChunks.join("")).toBe("");
		});
	});
});
