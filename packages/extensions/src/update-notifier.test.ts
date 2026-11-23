import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Crust, defineCommand } from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
	createStoreCacheAdapter,
	fetchLatestVersion,
	isNewerVersion,
	lookUpLatestVersion,
} from "./update-notifier-check.ts";
import {
	type UpdateNotifierCacheAdapter,
	type UpdateNotifierOptions,
	type UpdateNotifierState,
	updateNotifier,
} from "./update-notifier.ts";

// ────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ────────────────────────────────────────────────────────────────────────────

/** Replace globalThis.fetch with a mock, keeping `preconnect` for the fetch type. */
function mockFetch(fn: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>) {
	const fetchFn = vi.fn(fn);
	globalThis.fetch = Object.assign(fetchFn, { preconnect: globalThis.fetch.preconnect });
	return fetchFn;
}

function registryResponse(latest: unknown): Response {
	return new Response(JSON.stringify({ "dist-tags": { latest } }), { status: 200 });
}

/** Mock a registry whose `latest` dist-tag is `latestVersion`. */
function mockRegistryResponse(latestVersion: string) {
	return mockFetch(() => Promise.resolve(registryResponse(latestVersion)));
}

/** Returns a mock fetch that fails with a network error. */
function mockRegistryFailure() {
	mockFetch(() => Promise.reject(new Error("Network failure")));
}

// ────────────────────────────────────────────────────────────────────────────
// isNewerVersion
// ────────────────────────────────────────────────────────────────────────────

describe("isNewerVersion", () => {
	it("returns false when latest is older (major)", async () => {
		expect(isNewerVersion("2.0.0", "1.0.0")).toBe(false);
	});

	it("returns false when current is unparsable", async () => {
		expect(isNewerVersion("invalid", "1.0.0")).toBe(false);
	});

	it("notifies prerelease users when the stable release is available", async () => {
		expect(isNewerVersion("1.2.3-beta.1", "1.2.3")).toBe(true);
	});

	it("orders prerelease identifiers per SemVer precedence", async () => {
		expect(isNewerVersion("1.0.0-alpha.2", "1.0.0-alpha.10")).toBe(true);
		expect(isNewerVersion("1.0.0-alpha", "1.0.0-alpha.1")).toBe(true);
		expect(isNewerVersion("1.0.0-1", "1.0.0-alpha")).toBe(true);
		expect(isNewerVersion("1.0.0+build.1", "1.0.0+build.2")).toBe(false);
	});

	it("handles v-prefixed versions", async () => {
		expect(isNewerVersion("v1.0.0", "v2.0.0")).toBe(true);
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

	it("constructs correct URL with encoded package name", async () => {
		const fetchFn = mockRegistryResponse("1.0.0");

		await fetchLatestVersion("@scope/my-cli", "https://registry.npmjs.org", 5000);
		expect(fetchFn).toHaveBeenCalledWith(
			"https://registry.npmjs.org/%40scope%2Fmy-cli",
			expect.anything(),
		);
	});

	it("strips trailing slashes from registry URL", async () => {
		const fetchFn = mockRegistryResponse("1.0.0");

		await fetchLatestVersion("my-cli", "https://registry.npmjs.org///", 5000);
		expect(fetchFn).toHaveBeenCalledWith("https://registry.npmjs.org/my-cli", expect.anything());
	});

	it("stops waiting as soon as the invocation signal aborts", async () => {
		mockFetch(
			(_input, init) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
				}),
		);
		const controller = new AbortController();

		const result = fetchLatestVersion(
			"my-cli",
			"https://registry.npmjs.org",
			60_000,
			controller.signal,
		);
		controller.abort(new DOMException("Interrupted by SIGINT.", "AbortError"));

		expect(await result).toBeNull();
	});

	it.each([
		["a non-OK response", () => new Response("Not Found", { status: 404 })],
		["a latest that is not a string", () => registryResponse(123)],
		["an empty latest", () => registryResponse("")],
	])("returns null on %s", async (_label, response) => {
		mockFetch(() => Promise.resolve(response()));

		expect(await fetchLatestVersion("my-cli", "https://registry.npmjs.org", 5000)).toBeNull();
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

describe("lookUpLatestVersion", () => {
	it("returns the version the lookup resolves to", async () => {
		expect(await lookUpLatestVersion(async () => "2.0.0", 5000)).toBe("2.0.0");
		expect(await lookUpLatestVersion(() => "2.0.0", 5000)).toBe("2.0.0");
	});

	it.each([
		["nothing", async () => undefined],
		["an empty version", async () => ""],
		["a throw", async () => Promise.reject(new Error("offline"))],
		[
			"a sync throw",
			() => {
				throw new Error("offline");
			},
		],
	])("returns null when the lookup gives %s", async (_label, lookup) => {
		expect(await lookUpLatestVersion(lookup, 5000)).toBeNull();
	});

	it("stops waiting at the timeout even when the lookup ignores its signal", async () => {
		const seen: AbortSignal[] = [];
		const result = await lookUpLatestVersion((signal) => {
			seen.push(signal);
			return new Promise<string>(() => {});
		}, 20);

		expect(result).toBeNull();
		expect(seen[0]?.aborted).toBe(true);
	});

	it("leaves no pending rejection after a sync throw", async () => {
		const lookup = () => {
			throw new Error("offline");
		};
		expect(await lookUpLatestVersion(lookup, 10)).toBeNull();
		// The timeout fires after the call returned; an unhandled rejection fails the run.
		await new Promise((resolve) => setTimeout(resolve, 30));
	});

	it("does not call the lookup when the invocation signal has already aborted", async () => {
		const lookup = vi.fn(() => "2.0.0");

		expect(await lookUpLatestVersion(lookup, 5000, AbortSignal.abort())).toBeNull();
		expect(lookup).not.toHaveBeenCalled();
	});

	it("stops waiting as soon as the invocation signal aborts", async () => {
		const controller = new AbortController();
		const result = lookUpLatestVersion(
			() => new Promise<string>(() => {}),
			60_000,
			controller.signal,
		);
		controller.abort();

		expect(await result).toBeNull();
	});
});

// ────────────────────────────────────────────────────────────────────────────
// updateNotifier — post-run integration tests
// ────────────────────────────────────────────────────────────────────────────

describe("updateNotifier post-run hook", () => {
	const originalFetch = globalThis.fetch;
	// Each test gets its own state directory, so one package name serves every test.
	const pkgName = "my-cli";
	let stderrChunks: string[];
	let stderrIsTTY: boolean;
	let cachedState: UpdateNotifierState | undefined;
	let tempDirs: string[];

	beforeEach(async () => {
		cachedState = undefined;
		tempDirs = [];

		// Default-on built-in cache writes to stateDir(); sandbox it per test so
		// suites that don't care about caching never touch the real user state dir.
		const stateHome = await mkdtemp(join(tmpdir(), "crust-update-notifier-state-"));
		tempDirs.push(stateHome);
		vi.stubEnv("XDG_STATE_HOME", stateHome);
		// The check runs only in an interactive, non-CI terminal; the runner may be neither.
		vi.stubEnv("CI", undefined);
		vi.stubEnv("NO_UPDATE_NOTIFIER", undefined);
		stderrIsTTY = true;

		stderrChunks = [];
	});

	afterEach(async () => {
		globalThis.fetch = originalFetch;
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
		await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
	});

	function getOutput() {
		return stderrChunks.join("");
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
		vi.stubEnv("XDG_STATE_HOME", stateHomeFile);
		return stateHomeFile;
	}

	const memoryCache: UpdateNotifierCacheAdapter = {
		read: async () => cachedState,
		write: async (state: UpdateNotifierState) => {
			cachedState = { ...state };
		},
	};

	/**
	 * Run an application with the extension so its post-run hook sees a completed outcome.
	 * Defaults to `pkgName` at 1.0.0 with `memoryCache`; `cache: undefined` selects the built-in store.
	 */
	async function runNotifier(options: Partial<UpdateNotifierOptions> = {}) {
		const exitCode = await new Crust(pkgName)
			.extend(
				updateNotifier({
					currentVersion: "1.0.0",
					packageName: pkgName,
					cache: { adapter: memoryCache },
					...options,
				}),
			)
			.action(() => {})
			.execute({
				argv: [],
				io: {
					stdout: { write() {} },
					stderr: { write: (chunk) => void stderrChunks.push(String(chunk)), isTTY: stderrIsTTY },
				},
			});
		expect(exitCode).toBe(0);
	}

	describe("built-in cache adapter", () => {
		it("rejects state written for another registry", async () => {
			const publicRegistry = await createStoreCacheAdapter(pkgName, "https://registry.npmjs.org");
			await publicRegistry.write({ lastCheckedAt: 123, latestVersion: "2.0.0" });

			const privateRegistry = await createStoreCacheAdapter(
				pkgName,
				"https://registry.example.com",
			);
			expect(await privateRegistry.read()).toBeNull();
		});
	});

	// ── Update available flow ─────────────────────────────────────────────

	describe("update available flow", () => {
		it("emits update notice when registry returns a newer version", async () => {
			mockRegistryResponse("2.0.0");

			await runNotifier();

			expect(getOutput()).toContain("Update available");
			expect(getOutput()).toContain("1.0.0");
			expect(getOutput()).toContain("2.0.0");
		});
	});

	// ── Suppression ───────────────────────────────────────────────────────

	describe("suppression", () => {
		async function expectSkipped(): Promise<void> {
			const fetchFn = mockRegistryResponse("2.0.0");
			const read = vi.fn(async () => undefined);

			await runNotifier({ cache: { adapter: { read, write: async () => {} } } });

			expect(fetchFn).not.toHaveBeenCalled();
			expect(read).not.toHaveBeenCalled();
			expect(getOutput()).toBe("");
		}

		it.each(["true", "1", "github-actions"])("skips the check when CI=%s", async (ci) => {
			vi.stubEnv("CI", ci);
			await expectSkipped();
		});

		it.each(["", "0", "false", "FALSE"])("treats CI=%j as unset", async (ci) => {
			vi.stubEnv("CI", ci);
			mockRegistryResponse("2.0.0");

			await runNotifier();

			expect(getOutput()).toContain("Update available");
		});

		it.each(["1", "0", "false"])("skips the check when NO_UPDATE_NOTIFIER=%s", async (value) => {
			vi.stubEnv("NO_UPDATE_NOTIFIER", value);
			await expectSkipped();
		});

		it("skips the check when stderr is not a TTY", async () => {
			stderrIsTTY = false;
			await expectSkipped();
		});

		it("reads the root version without building sibling commands", async () => {
			vi.stubEnv("CI", "true");
			const built: string[] = [];
			const command = (name: string) =>
				defineCommand(name, (c) => {
					built.push(name);
					return c.action(() => {});
				});
			const outcome = await new Crust(pkgName, { version: "1.0.0" })
				.extend(updateNotifier({ packageName: pkgName }))
				.add(command("a"), command("b"))
				.run(["a"]);

			expect(outcome).toMatchObject({ status: "completed" });
			expect(built).toEqual(["a"]);
		});
	});

	// ── No update flow ────────────────────────────────────────────────────

	describe("no update flow", () => {
		it("does not emit notice when versions are equal", async () => {
			mockRegistryResponse("1.0.0");

			await runNotifier();

			expect(getOutput()).toBe("");
		});
	});

	// ── Cache gate / stale cache flows ────────────────────────────────────

	describe("cache gate logic", () => {
		it("skips network check when cache is fresh (within intervalMs)", async () => {
			cachedState = { lastCheckedAt: Date.now(), latestVersion: "2.0.0" };
			const fetchFn = mockRegistryResponse("3.0.0");

			await runNotifier();

			// Should emit notice from cached version, not from fetch
			expect(getOutput()).toContain("2.0.0");
			expect(getOutput()).not.toContain("3.0.0");
			expect(fetchFn).not.toHaveBeenCalled();
		});

		it("refetches when elapsed equals intervalMs exactly (strict boundary)", async () => {
			const fixedNow = 1_700_000_000_000;
			vi.spyOn(Date, "now").mockReturnValue(fixedNow);
			cachedState = { lastCheckedAt: fixedNow - 1000, latestVersion: "2.0.0" };
			mockRegistryResponse("3.0.0");

			await runNotifier({ cache: { adapter: memoryCache, intervalMs: 1000 } });

			// elapsed === intervalMs is stale (`<`, not `<=`) — fresh fetch wins
			expect(getOutput()).toContain("3.0.0");
		});

		it("treats a future lastCheckedAt as stale and rewrites it", async () => {
			// Clock rollback / corrupt timestamp: without the elapsed >= 0 guard
			// this state would stay "fresh" forever and never be repaired.
			cachedState = { lastCheckedAt: Date.now() + 9e12, latestVersion: "2.0.0" };
			mockRegistryResponse("3.0.0");

			await runNotifier();

			expect(getOutput()).toContain("3.0.0");
			expect(cachedState?.lastCheckedAt).toBeLessThanOrEqual(Date.now());
		});
	});

	// ── Network failure tolerance ─────────────────────────────────────────

	describe("failure tolerance", () => {
		it("updates lastCheckedAt even on fetch failure to avoid hammering", async () => {
			mockRegistryFailure();

			const beforeRun = Date.now();
			await runNotifier();

			expect(cachedState?.lastCheckedAt).toBeGreaterThanOrEqual(beforeRun);
		});

		it("swallows adapter write failures after emitting the update notice", async () => {
			mockRegistryResponse("2.0.0");
			let writeAttempted = false;
			await runNotifier({
				cache: {
					adapter: {
						read: async () => null,
						write: async () => {
							writeAttempted = true;
							throw new Error("disk full");
						},
					},
				},
			});
			expect(writeAttempted).toBe(true);
			expect(getOutput()).toContain("Update available");
			expect(getOutput()).toContain("2.0.0");
		});

		it("completes the command when the check chunk fails to load", async () => {
			vi.doMock("./update-notifier-check.ts", () => {
				throw new Error("Cannot find module");
			});
			const fetchFn = mockRegistryResponse("2.0.0");
			try {
				await runNotifier();
			} finally {
				vi.doUnmock("./update-notifier-check.ts");
			}
			expect(fetchFn).not.toHaveBeenCalled();
			expect(getOutput()).toBe("");
		});
	});

	// ── Dedupe behavior ───────────────────────────────────────────────────

	describe("dedupe behavior", () => {
		it("does not re-notify for same version already notified (persisted dedupe)", async () => {
			cachedState = { lastCheckedAt: 0, latestVersion: "2.0.0", lastNotifiedVersion: "2.0.0" };
			mockRegistryResponse("2.0.0");

			await runNotifier();

			expect(getOutput()).toBe("");
		});

		it("notifies again when a newer version appears after previous notification", async () => {
			cachedState = { lastCheckedAt: 0, latestVersion: "2.0.0", lastNotifiedVersion: "2.0.0" };
			mockRegistryResponse("3.0.0");

			await runNotifier();

			expect(getOutput()).toContain("3.0.0");
		});
	});

	// ── Option behavior ───────────────────────────────────────────────────

	describe("option behavior", () => {
		it("uses global commands when updateCommand scope is global", async () => {
			vi.stubEnv("npm_config_user_agent", "bun/1.3.0");
			mockRegistryResponse("2.0.0");

			await runNotifier({ updateCommand: { scope: "global" } });

			expect(getOutput()).toContain(`bun add -g ${pkgName}@latest`);
		});

		it("uses local commands when updateCommand scope is local", async () => {
			vi.stubEnv("npm_config_user_agent", "npm/10.0.0 node/v22");
			mockRegistryResponse("2.0.0");

			await runNotifier({ updateCommand: { scope: "local" } });

			expect(getOutput()).toContain(`npm install ${pkgName}@latest`);
		});

		it("infers bun from npm_execpath when user agent is missing", async () => {
			vi.stubEnv("npm_config_user_agent", undefined);
			vi.stubEnv("npm_execpath", "/opt/homebrew/bin/bun");
			mockRegistryResponse("2.0.0");

			await runNotifier({ updateCommand: { scope: "global" } });

			expect(getOutput()).toContain(`bun add -g ${pkgName}@latest`);
		});

		it("omits the update command when updateCommand is unset", async () => {
			mockRegistryResponse("2.0.0");

			await runNotifier();

			expect(getOutput()).toContain("Update available");
			expect(getOutput()).not.toContain("Run ");
			expect(getOutput()).not.toContain(`${pkgName}@latest`);
		});

		it("includes updateDocsUrl without generating an update command", async () => {
			mockRegistryResponse("2.0.0");

			await runNotifier({ updateDocsUrl: "https://example.com/update" });

			expect(getOutput()).toContain("See");
			expect(getOutput()).toContain("https://example.com/update");
			expect(getOutput()).not.toContain("Run ");
		});

		it("passes package information to updateCommand callbacks", async () => {
			const received: Array<{ packageName: string; packageManager: string }> = [];
			vi.stubEnv("npm_config_user_agent", "pnpm/10.0.0 node/v22");
			mockRegistryResponse("2.0.0");

			await runNotifier({
				updateCommand: (info) => {
					received.push(info);
					return "custom update";
				},
			});

			expect(received).toEqual([{ packageName: pkgName, packageManager: "pnpm" }]);
		});

		it("does not call updateCommand callbacks when no notice is shown", async () => {
			let calls = 0;
			mockRegistryResponse("1.0.0");

			await runNotifier({
				updateCommand: () => {
					calls++;
					return "custom update";
				},
			});

			expect(calls).toBe(0);
			expect(getOutput()).toBe("");
		});

		it("records the check when an updateCommand callback throws", async () => {
			mockRegistryResponse("2.0.0");

			await runNotifier({
				updateCommand: () => {
					throw new Error("callback failed");
				},
			});

			expect(getOutput()).toBe("");
			expect(cachedState).toMatchObject({ latestVersion: "2.0.0" });
		});

		it("persists and deduplicates with the built-in cache by default", async () => {
			const stateHome = process.env.XDG_STATE_HOME as string;
			const fetchFn = mockRegistryResponse("2.0.0");

			await runNotifier({ cache: undefined });
			expect(getOutput()).toContain("Update available");

			stderrChunks = [];
			await runNotifier({ cache: undefined });

			expect(fetchFn).toHaveBeenCalledTimes(1);
			expect(getOutput()).toBe("");
			const persisted = JSON.parse(
				await readFile(join(stateHome, pkgName, "update-notifier.json"), "utf8"),
			) as UpdateNotifierState;
			expect(persisted.latestVersion).toBe("2.0.0");
			expect(persisted.lastNotifiedVersion).toBe("2.0.0");
		});

		it("sanitizes scoped package names for the built-in state directory", async () => {
			const scopedName = "@crust-test/scoped";
			const stateHome = process.env.XDG_STATE_HOME as string;
			mockRegistryResponse("2.0.0");

			await runNotifier({ packageName: scopedName, cache: undefined });

			// A raw scoped name would make stateDir() throw and silently kill the notifier
			expect(getOutput()).toContain("Update available");
			const sanitized = encodeURIComponent(scopedName);
			const persisted = JSON.parse(
				await readFile(join(stateHome, sanitized, "update-notifier.json"), "utf8"),
			) as UpdateNotifierState;
			expect(persisted.latestVersion).toBe("2.0.0");
		});

		it("treats a corrupt built-in cache file as empty and repairs it", async () => {
			const stateHome = process.env.XDG_STATE_HOME as string;
			await mkdir(join(stateHome, pkgName), { recursive: true });
			const cacheFile = join(stateHome, pkgName, "update-notifier.json");
			await writeFile(cacheFile, "not json");
			mockRegistryResponse("2.0.0");

			await runNotifier({ cache: undefined });

			expect(getOutput()).toContain("Update available");
			const persisted = JSON.parse(await readFile(cacheFile, "utf8")) as UpdateNotifierState;
			expect(persisted.latestVersion).toBe("2.0.0");
		});

		it("honors intervalMs with the built-in cache when no adapter is given", async () => {
			const fetchFn = mockRegistryResponse("2.0.0");

			// intervalMs: 0 disables reuse — the default 24h would dedupe to 1 fetch
			await runNotifier({ cache: { intervalMs: 0 } });
			await runNotifier({ cache: { intervalMs: 0 } });

			expect(fetchFn).toHaveBeenCalledTimes(2);
		});

		it("does not read or write the built-in cache when cache is false", async () => {
			const stateHomeFile = await makeUnusableStateHome("disabled");
			const fetchFn = mockRegistryResponse("2.0.0");

			await runNotifier({ cache: false });
			expect(getOutput()).toContain("Update available");
			stderrChunks = [];
			await runNotifier({ cache: false });
			// No persistence means no dedupe — the notice must reappear
			expect(getOutput()).toContain("Update available");

			expect(fetchFn).toHaveBeenCalledTimes(2);
			expect(await readFile(stateHomeFile, "utf8")).toBe("unchanged");
		});

		it("uses a custom adapter without touching the built-in store", async () => {
			const stateHomeFile = await makeUnusableStateHome("custom");
			mockRegistryResponse("2.0.0");

			await runNotifier({ cache: { adapter: memoryCache } });

			expect(cachedState?.latestVersion).toBe("2.0.0");
			expect(await readFile(stateHomeFile, "utf8")).toBe("unchanged");
		});

		it("uses custom registryUrl for fetch", async () => {
			const fetchFn = mockRegistryResponse("2.0.0");

			await runNotifier({ registryUrl: "https://custom-registry.example.com" });

			expect(fetchFn).toHaveBeenCalledWith(
				expect.stringMatching(/^https:\/\/custom-registry\.example\.com\//),
				expect.anything(),
			);
		});

		it("asks latestVersion instead of the npm registry", async () => {
			const fetchFn = mockRegistryResponse("9.0.0");

			await runNotifier({ latestVersion: async () => "2.0.0" });

			expect(fetchFn).not.toHaveBeenCalled();
			expect(getOutput()).toContain("2.0.0");
			expect(cachedState?.latestVersion).toBe("2.0.0");
		});

		it("uses custom updateCommand in the notice", async () => {
			mockRegistryResponse("2.0.0");

			await runNotifier({ updateCommand: "brew upgrade my-cli" });

			expect(getOutput()).toContain("brew upgrade my-cli");
		});
	});

	// ── Post-run ordering ─────────────────────────────────────────────────

	describe("post-run ordering", () => {
		it("does not run after a failed command", async () => {
			const fetchFn = mockRegistryResponse("2.0.0");
			const app = new Crust(pkgName)
				.extend(updateNotifier({ currentVersion: "1.0.0", packageName: pkgName }))
				.action(() => {
					throw new Error("command failed");
				});

			expect(await captureExecute(app, [], { isTTY: true })).toMatchObject({
				stderr: "Error: command failed\n",
				exitCode: 1,
			});

			expect(fetchFn).not.toHaveBeenCalled();
		});
	});

	// ── Integration with Crust ──────────────────────────────────────────

	describe("Crust.execute() integration", () => {
		it("uses the root metadata version with Crust.execute()", async () => {
			mockRegistryResponse("5.0.0");

			let commandExecuted = false;
			const app = new Crust(pkgName, { description: "Test", version: "1.0.0" })
				.extend(updateNotifier({ packageName: pkgName }))
				.action(() => {
					commandExecuted = true;
				});

			const { stderr } = await captureExecute(app, [], { isTTY: true });

			expect(commandExecuted).toBe(true);
			expect(stderr).toContain("Update available");
			expect(stderr).toContain("5.0.0");
		});

		it("does not break command execution when registry is down", async () => {
			mockRegistryFailure();

			let commandExecuted = false;
			const app = new Crust(pkgName, { description: "Test" })
				.extend(updateNotifier({ currentVersion: "1.0.0", packageName: pkgName }))
				.action(() => {
					commandExecuted = true;
				});

			const { stderr, exitCode } = await captureExecute(app, [], { isTTY: true });

			expect(commandExecuted).toBe(true);
			expect(exitCode).toBe(0);
			expect(stderr).toBe("");
		});
	});
});
