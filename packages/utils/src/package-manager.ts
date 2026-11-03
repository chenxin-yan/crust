export type PackageManager = "npm" | "pnpm" | "bun" | "yarn";

/** Parse the package manager from npm's user-agent environment value. */
export function packageManagerFromUserAgent(userAgent: string | undefined): PackageManager | null {
	if (userAgent?.startsWith("bun")) return "bun";
	if (userAgent?.startsWith("pnpm")) return "pnpm";
	if (userAgent?.startsWith("yarn")) return "yarn";
	if (userAgent?.startsWith("npm")) return "npm";
	return null;
}
