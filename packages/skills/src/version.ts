// ────────────────────────────────────────────────────────────────────────────
// Version checking — reads and compares installed skill versions
// ────────────────────────────────────────────────────────────────────────────

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { InstallStatus } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Reads the installed version from a skill directory's `manifest.json`.
 *
 * @param dir - Absolute path to the skill directory
 * @returns The version string if found, or `null` if the file is missing or malformed
 */
export async function readInstalledVersion(
	dir: string,
): Promise<string | null> {
	try {
		const raw = await readFile(join(dir, "manifest.json"), "utf-8");
		const parsed: unknown = JSON.parse(raw);

		if (
			typeof parsed === "object" &&
			parsed !== null &&
			"version" in parsed &&
			typeof (parsed as Record<string, unknown>).version === "string"
		) {
			return (parsed as Record<string, unknown>).version as string;
		}

		return null;
	} catch {
		return null;
	}
}

/**
 * Checks whether a skill directory needs installation or update.
 *
 * @param dir - Absolute path to the skill directory
 * @param newVersion - The version being installed
 * @returns `"installed"` if no manifest found, `"updated"` if versions differ,
 *          or `"up-to-date"` if versions match exactly
 */
export async function checkVersion(
	dir: string,
	newVersion: string,
): Promise<InstallStatus> {
	const installed = await readInstalledVersion(dir);

	if (installed === null) {
		return "installed";
	}

	if (installed !== newVersion) {
		return "updated";
	}

	return "up-to-date";
}
