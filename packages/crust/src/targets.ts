import { existsSync } from "node:fs";

export const BUILD_RUNTIMES = ["bun", "deno", "node"] as const;
export type BuildRuntime = (typeof BUILD_RUNTIMES)[number];

export type TargetInfo = {
	alias: string;
	platformKey: string;
	os: "linux" | "darwin" | "win32";
	cpu: "x64" | "arm64";
	/** C library the Linux binary links against; drives the npm `libc` field and launcher selection. */
	libc?: "glibc" | "musl";
};

export type TargetTable<T extends string> = {
	runtime: "Bun" | "Deno" | "Node";
	targets: readonly T[];
	info: Record<T, TargetInfo>;
};

const BUN_TARGET_NAMES = [
	"bun-linux-x64",
	"bun-linux-arm64",
	"bun-linux-x64-musl",
	"bun-linux-arm64-musl",
	"bun-darwin-x64",
	"bun-darwin-arm64",
	"bun-windows-x64",
	"bun-windows-arm64",
] as const;

export type BunTarget = (typeof BUN_TARGET_NAMES)[number];

export const BUN_TARGETS = {
	runtime: "Bun",
	targets: BUN_TARGET_NAMES,
	info: {
		"bun-linux-x64": {
			alias: "linux-x64",
			platformKey: "linux-x64",
			os: "linux",
			cpu: "x64",
			libc: "glibc",
		},
		"bun-linux-arm64": {
			alias: "linux-arm64",
			platformKey: "linux-arm64",
			os: "linux",
			cpu: "arm64",
			libc: "glibc",
		},
		"bun-linux-x64-musl": {
			alias: "linux-x64-musl",
			platformKey: "linux-x64-musl",
			os: "linux",
			cpu: "x64",
			libc: "musl",
		},
		"bun-linux-arm64-musl": {
			alias: "linux-arm64-musl",
			platformKey: "linux-arm64-musl",
			os: "linux",
			cpu: "arm64",
			libc: "musl",
		},
		"bun-darwin-x64": {
			alias: "darwin-x64",
			platformKey: "darwin-x64",
			os: "darwin",
			cpu: "x64",
		},
		"bun-darwin-arm64": {
			alias: "darwin-arm64",
			platformKey: "darwin-arm64",
			os: "darwin",
			cpu: "arm64",
		},
		"bun-windows-x64": {
			alias: "windows-x64",
			platformKey: "win32-x64",
			os: "win32",
			cpu: "x64",
		},
		"bun-windows-arm64": {
			alias: "windows-arm64",
			platformKey: "win32-arm64",
			os: "win32",
			cpu: "arm64",
		},
	},
} as const satisfies TargetTable<BunTarget>;

const DENO_TARGET_NAMES = [
	"x86_64-unknown-linux-gnu",
	"aarch64-unknown-linux-gnu",
	"x86_64-apple-darwin",
	"aarch64-apple-darwin",
	"x86_64-pc-windows-msvc",
	"aarch64-pc-windows-msvc",
] as const;

export type DenoTarget = (typeof DENO_TARGET_NAMES)[number];

export const DENO_TARGETS = {
	runtime: "Deno",
	targets: DENO_TARGET_NAMES,
	info: {
		"x86_64-unknown-linux-gnu": {
			alias: "linux-x64",
			platformKey: "linux-x64",
			os: "linux",
			cpu: "x64",
			libc: "glibc",
		},
		"aarch64-unknown-linux-gnu": {
			alias: "linux-arm64",
			platformKey: "linux-arm64",
			os: "linux",
			cpu: "arm64",
			libc: "glibc",
		},
		"x86_64-apple-darwin": {
			alias: "darwin-x64",
			platformKey: "darwin-x64",
			os: "darwin",
			cpu: "x64",
		},
		"aarch64-apple-darwin": {
			alias: "darwin-arm64",
			platformKey: "darwin-arm64",
			os: "darwin",
			cpu: "arm64",
		},
		"x86_64-pc-windows-msvc": {
			alias: "windows-x64",
			platformKey: "win32-x64",
			os: "win32",
			cpu: "x64",
		},
		"aarch64-pc-windows-msvc": {
			alias: "windows-arm64",
			platformKey: "win32-arm64",
			os: "win32",
			cpu: "arm64",
		},
	},
} as const satisfies TargetTable<DenoTarget>;

// Node's own release platform names (`node-v26.10.0-win-x64`), which tsdown's
// executable builder accepts as `{ platform, arch }`. It has no libc variant:
// the official Linux builds link glibc, so musl hosts have no Node target.
const NODE_TARGET_NAMES = [
	"linux-x64",
	"linux-arm64",
	"darwin-x64",
	"darwin-arm64",
	"win-x64",
	"win-arm64",
] as const;

export type NodeTarget = (typeof NODE_TARGET_NAMES)[number];

export const NODE_TARGETS = {
	runtime: "Node",
	targets: NODE_TARGET_NAMES,
	info: {
		"linux-x64": {
			alias: "linux-x64",
			platformKey: "linux-x64",
			os: "linux",
			cpu: "x64",
			libc: "glibc",
		},
		"linux-arm64": {
			alias: "linux-arm64",
			platformKey: "linux-arm64",
			os: "linux",
			cpu: "arm64",
			libc: "glibc",
		},
		"darwin-x64": {
			alias: "darwin-x64",
			platformKey: "darwin-x64",
			os: "darwin",
			cpu: "x64",
		},
		"darwin-arm64": {
			alias: "darwin-arm64",
			platformKey: "darwin-arm64",
			os: "darwin",
			cpu: "arm64",
		},
		"win-x64": {
			alias: "windows-x64",
			platformKey: "win32-x64",
			os: "win32",
			cpu: "x64",
		},
		"win-arm64": {
			alias: "windows-arm64",
			platformKey: "win32-arm64",
			os: "win32",
			cpu: "arm64",
		},
	},
} as const satisfies TargetTable<NodeTarget>;

/** `--target` value that stands for this machine's canonical target. */
export const HOST_TARGET = "host";

/**
 * Canonical targets for `--target` inputs, deduplicated in input order. No
 * inputs means every target of the table; `host` means this machine's target.
 */
export function resolveTargets<T extends string>(
	table: TargetTable<T>,
	targetFlags: readonly string[] | undefined,
): T[] {
	if (!targetFlags?.length) return [...table.targets];

	const targets = targetFlags.map((input) => {
		if (input === HOST_TARGET) {
			const host = hostTarget(table);
			if (host === null) {
				throw new Error(
					`No ${table.runtime} target matches this machine (${hostPlatformKey()}).\n  Valid targets: ${table.targets.join(", ")}`,
				);
			}
			return host;
		}
		const exact = table.targets.find((target) => target === input);
		if (exact) return exact;

		const canonical = table.targets.find((target) => table.info[target].alias === input);
		const hint = canonical ? ` Did you mean "${canonical}"?` : "";
		const runtime = table.runtime === "Bun" ? "" : `${table.runtime} `;
		throw new Error(
			`Unknown ${runtime}target "${input}". Targets must use canonical ${table.runtime} names.${hint}\n  Valid targets: ${table.targets.join(", ")}`,
		);
	});
	return [...new Set(targets)];
}

/** True on musl-based Linux (Alpine, Void, …). Mirrors the check in Bun's own npm installer. */
function isMuslHost(): boolean {
	if (process.platform !== "linux") return false;
	try {
		// SAFETY: @types/node types the report as `object`; header.glibcVersionRuntime is a documented field.
		const report = process.report?.getReport() as
			| { header?: { glibcVersionRuntime?: string } }
			| undefined;
		if (report?.header) return report.header.glibcVersionRuntime === undefined;
	} catch {
		// process.report is unavailable in some embedders; fall through to the file probe.
	}
	return existsSync("/etc/alpine-release");
}

function hostPlatformKey(): string {
	return `${process.platform}-${process.arch}${isMuslHost() ? "-musl" : ""}`;
}

export function hostTarget<T extends string>(table: TargetTable<T>): T | null {
	const platformKey = hostPlatformKey();
	return table.targets.find((target) => table.info[target].platformKey === platformKey) ?? null;
}
