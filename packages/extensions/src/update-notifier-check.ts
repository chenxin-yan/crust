// ────────────────────────────────────────────────────────────────────────────
// @crustjs/extensions — Update notifier check (loaded only when a check runs)
// ────────────────────────────────────────────────────────────────────────────

import { bold, cyan, dim, green, padEnd, stringWidth, yellow } from "@crustjs/style";
import { isJsonObject, type JsonValue } from "@crustjs/utils/json";
import { packageManagerFromUserAgent } from "@crustjs/utils/package-manager";

import type {
	UpdateNotifierCacheAdapter,
	UpdateNotifierOptions,
	UpdateNotifierPackageManager,
	UpdateNotifierState,
} from "./update-notifier.ts";

/** Resolved options for one check; the root module applies defaults and the suppression rules. */
export interface UpdateCheck {
	readonly currentVersion: string;
	readonly packageName: string;
	readonly timeoutMs: number;
	readonly registryUrl: string;
	readonly intervalMs: number;
	readonly updateCommand: UpdateNotifierOptions["updateCommand"];
	readonly updateDocsUrl: string | undefined;
	readonly cache: UpdateNotifierOptions["cache"];
	readonly stderr: (text: string) => void;
}

function compareSemver(left: string, right: string): -1 | 0 | 1 {
	const parse = (version: string) => {
		const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
			version,
		);
		if (!match) throw new TypeError(`Invalid semantic version: ${version}`);
		return {
			core: match.slice(1, 4).map(Number),
			prerelease: match[4]?.split(".") ?? [],
		};
	};
	const a = parse(left);
	const b = parse(right);
	for (let index = 0; index < 3; index++) {
		if (a.core[index] !== b.core[index]) return a.core[index]! < b.core[index]! ? -1 : 1;
	}
	if (a.prerelease.length === 0 || b.prerelease.length === 0) {
		return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length === 0 ? 1 : -1;
	}
	for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index++) {
		const x = a.prerelease[index];
		const y = b.prerelease[index];
		if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
		if (x === y) continue;
		const xNumeric = /^\d+$/.test(x);
		const yNumeric = /^\d+$/.test(y);
		if (xNumeric && yNumeric) return Number(x) < Number(y) ? -1 : 1;
		if (xNumeric !== yNumeric) return xNumeric ? -1 : 1;
		return x < y ? -1 : 1;
	}
	return 0;
}

/**
 * Returns whether `latest` is newer, or false when either version is invalid.
 *
 * @internal
 */
export function isNewerVersion(current: string, latest: string): boolean {
	try {
		return compareSemver(latest, current) === 1;
	} catch {
		return false;
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Internal utilities — npm registry fetch
// ────────────────────────────────────────────────────────────────────────────

/**
 * Fetch the `dist-tags.latest` version string for a package from an npm
 * registry.
 *
 * Uses the platform timeout signal so network stalls cannot hang the CLI process.
 *
 * Returns `null` on any failure (network error, timeout, non-OK status,
 * missing/malformed response body).
 *
 * @internal
 */
export async function fetchLatestVersion(
	packageName: string,
	registryUrl: string,
	timeoutMs: number,
): Promise<string | null> {
	try {
		const url = `${registryUrl.replace(/\/+$/, "")}/${encodeURIComponent(packageName)}`;
		const response = await fetch(url, {
			signal: AbortSignal.timeout(timeoutMs),
			headers: { Accept: "application/vnd.npm.install-v1+json" },
		});

		if (!response.ok) return null;

		const data: JsonValue = JSON.parse(await response.text());
		const tags = isJsonObject(data) ? data["dist-tags"] : undefined;
		const latest = tags !== undefined && isJsonObject(tags) ? tags.latest : undefined;
		return typeof latest === "string" && latest.length > 0 ? latest : null;
	} catch {
		// Network error, abort, JSON parse failure — all soft failures
		return null;
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Cache state — notifier persistence fields
// ────────────────────────────────────────────────────────────────────────────

function normalizeNotifierState(
	input: UpdateNotifierState | null | undefined,
): UpdateNotifierState {
	if (!input) return { lastCheckedAt: 0 };

	const lastCheckedAt = Number.isFinite(input.lastCheckedAt) ? input.lastCheckedAt : 0;
	const latestVersion = input.latestVersion?.length ? input.latestVersion : undefined;
	const lastNotifiedVersion = input.lastNotifiedVersion?.length
		? input.lastNotifiedVersion
		: undefined;

	return {
		lastCheckedAt,
		latestVersion,
		lastNotifiedVersion,
	};
}

const NO_CACHE_ADAPTER: UpdateNotifierCacheAdapter = {
	read: async () => null,
	write: async () => {},
};

/** @internal */
export async function createStoreCacheAdapter(
	packageName: string,
	registryUrl: string,
): Promise<UpdateNotifierCacheAdapter> {
	const { createStore, stateDir } = await import("@crustjs/store");
	const store = createStore({
		// stateDir rejects path separators; encodeURIComponent is injective
		// (@scope/cli → %40scope%2Fcli), so distinct packages never collide
		dirPath: stateDir(encodeURIComponent(packageName)),
		name: "update-notifier",
		fields: {
			lastCheckedAt: { type: "number", default: 0 },
			latestVersion: { type: "string" },
			lastNotifiedVersion: { type: "string" },
			registryUrl: { type: "string" },
		},
	});
	return {
		// State cached from a different registry is stale, not reusable
		read: async () => {
			const state = await store.read();
			if (state.registryUrl !== registryUrl) return null;
			return {
				lastCheckedAt: state.lastCheckedAt,
				latestVersion: state.latestVersion,
				lastNotifiedVersion: state.lastNotifiedVersion,
			};
		},
		// Explicit keys: the store's write type requires every field present
		write: async (state) => {
			await store.write({
				lastCheckedAt: state.lastCheckedAt,
				latestVersion: state.latestVersion,
				lastNotifiedVersion: state.lastNotifiedVersion,
				registryUrl,
			});
		},
	};
}

function detectPackageManager(): UpdateNotifierPackageManager {
	const detectedFromUserAgent = packageManagerFromUserAgent(process.env.npm_config_user_agent);
	if (detectedFromUserAgent) return detectedFromUserAgent;

	const detectedFromExecPath = detectPackageManagerFromExecPath(process.env.npm_execpath);
	if (detectedFromExecPath) return detectedFromExecPath;

	const detectedFromRuntime = detectPackageManagerFromExecPath(process.execPath);
	if (detectedFromRuntime) return detectedFromRuntime;

	return "npm";
}

function detectPackageManagerFromExecPath(
	execPath: string | undefined,
): UpdateNotifierPackageManager | null {
	if (!execPath) return null;

	const executable = process.getBuiltinModule("node:path").basename(execPath).toLowerCase();
	if (executable === "bun" || executable.startsWith("bun-")) return "bun";
	if (executable === "pnpm" || executable.startsWith("pnpm-")) return "pnpm";
	if (executable === "yarn" || executable.startsWith("yarn-")) return "yarn";
	if (executable === "npm" || executable.startsWith("npm-")) return "npm";
	return null;
}

// Yarn Berry has no `global`, so global Yarn installs fall back to npm.
const INSTALL_COMMANDS = {
	npm: { global: "npm install -g", local: "npm install" },
	pnpm: { global: "pnpm add -g", local: "pnpm add" },
	yarn: { global: "npm install -g", local: "yarn add" },
	bun: { global: "bun add -g", local: "bun add" },
} as const satisfies Record<UpdateNotifierPackageManager, Record<"global" | "local", string>>;

function defaultUpdateCommand(
	packageName: string,
	packageManager: UpdateNotifierPackageManager,
	scope: "global" | "local",
): string {
	return `${INSTALL_COMMANDS[packageManager][scope]} ${packageName}@latest`;
}

function resolveUpdateCommand(
	packageName: string,
	updateCommand: UpdateNotifierOptions["updateCommand"],
): string | undefined {
	if (updateCommand === undefined || typeof updateCommand === "string") return updateCommand;

	const packageManager = detectPackageManager();
	if (typeof updateCommand === "function") {
		return updateCommand({ packageName, packageManager });
	}
	return defaultUpdateCommand(packageName, packageManager, updateCommand.scope);
}

/** Check the registry (or the cache) and print a notice when a newer version exists. */
export async function runUpdateCheck(check: UpdateCheck): Promise<void> {
	const {
		currentVersion,
		packageName,
		timeoutMs,
		registryUrl,
		intervalMs,
		updateCommand,
		updateDocsUrl,
		cache,
		stderr,
	} = check;
	try {
		let cacheAdapter: UpdateNotifierCacheAdapter = NO_CACHE_ADAPTER;
		if (cache !== false) {
			if (cache?.adapter) {
				cacheAdapter = cache.adapter;
			} else {
				cacheAdapter = await createStoreCacheAdapter(packageName, registryUrl);
			}
		}

		// Corrupt/unreadable cache (e.g. CrustStoreError PARSE) reads as empty
		// so the next successful write repairs the file instead of permanently
		// disabling the notifier.
		const state = normalizeNotifierState(await cacheAdapter.read().catch(() => null));
		const notify = (latestVersion: string): boolean => {
			if (
				!isNewerVersion(currentVersion, latestVersion) ||
				state.lastNotifiedVersion === latestVersion
			) {
				return false;
			}
			emitUpdateNotice(
				currentVersion,
				latestVersion,
				resolveUpdateCommand(packageName, updateCommand),
				updateDocsUrl,
				stderr,
			);
			return true;
		};

		// ── Cache gate: skip network if within interval ──────────
		const now = Date.now();
		const elapsed = now - state.lastCheckedAt;

		// Negative elapsed (clock rollback, corrupt future timestamp) is
		// treated as stale so the refetch rewrites lastCheckedAt.
		if (cache !== false && elapsed >= 0 && elapsed < intervalMs) {
			// Cache is still fresh — use cached version if available
			if (state.latestVersion && notify(state.latestVersion)) {
				await cacheAdapter.write({
					...state,
					lastNotifiedVersion: state.latestVersion,
				});
			}
			return;
		}

		// ── Network check: fetch latest version ──────────────────
		const latestVersion = await fetchLatestVersion(packageName, registryUrl, timeoutMs);

		if (latestVersion === null) {
			// Soft failure — update timestamp to avoid retrying too soon
			await cacheAdapter.write({
				...state,
				lastCheckedAt: now,
			});
			return;
		}

		// ── Persist fetched version and timestamp ─────────────────
		const nextState: UpdateNotifierState = {
			...state,
			lastCheckedAt: now,
			latestVersion,
		};

		// ── Emit notice if newer and not already notified ─────────
		// `finally` records the check even when an `updateCommand` callback
		// throws, so a broken callback cannot force a refetch on every run.
		let notified = false;
		try {
			notified = notify(latestVersion);
		} finally {
			await cacheAdapter.write(
				notified ? { ...nextState, lastNotifiedVersion: latestVersion } : nextState,
			);
		}
	} catch {
		// Registry, cache, and notification failures must not fail the completed command.
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Internal — Update notice output
// ────────────────────────────────────────────────────────────────────────────

/**
 * Emits a styled, boxed update notice to stderr.
 *
 * Uses stderr so the notice does not interfere with piped stdout.
 *
 * The notice uses rounded-corner box-drawing characters and ANSI colors:
 * - Yellow box border
 * - Dim current version, bold green latest version
 * - Optional cyan update command and documentation URL
 *
 * @internal
 */
function emitUpdateNotice(
	currentVersion: string,
	latestVersion: string,
	updateCommand: string | undefined,
	updateDocsUrl: string | undefined,
	stderr: (text: string) => void,
): void {
	const PADDING = 3;

	const contentLines = [
		`Update available  ${dim(currentVersion)} ${yellow("→")} ${bold(green(latestVersion))}`,
		...(updateCommand !== undefined ? [`Run ${cyan(updateCommand)}`] : []),
		...(updateDocsUrl !== undefined ? [`See ${cyan(updateDocsUrl)} to update`] : []),
	];

	// Determine content width from the longest visible line
	const contentWidth = Math.max(...contentLines.map((line) => stringWidth(line)));
	const innerWidth = contentWidth + PADDING * 2;

	const border = "─".repeat(innerWidth);
	const pad = " ".repeat(PADDING);
	const emptyLine = `${yellow("│")}${" ".repeat(innerWidth)}${yellow("│")}`;

	const lines = [
		"",
		`${yellow("╭")}${yellow(border)}${yellow("╮")}`,
		emptyLine,
		...contentLines.map(
			(line) => `${yellow("│")}${pad}${padEnd(line, contentWidth)}${pad}${yellow("│")}`,
		),
		emptyLine,
		`${yellow("╰")}${yellow(border)}${yellow("╯")}`,
		"",
	];

	stderr(lines.join("\n"));
}
