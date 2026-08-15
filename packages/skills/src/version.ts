import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { SkillKind } from "./types.ts";

export const CRUST_MANIFEST = "crust.json";

function isStringKeyedObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Ownership and version metadata shipped with and copied from a skill source. */
export interface InstalledSkillManifest {
	readonly name: string;
	readonly description: string;
	readonly version: string;
	readonly kind: SkillKind;
}

export type InstalledManifestMalformedReason =
	| "parse-error"
	| "not-an-object"
	| "missing-name"
	| "missing-description"
	| "missing-version"
	| "missing-kind"
	| "unknown-kind";

export type InstalledManifestStatus =
	| { readonly status: "ok"; readonly manifest: InstalledSkillManifest }
	| { readonly status: "absent" }
	| {
			readonly status: "malformed";
			readonly reason: InstalledManifestMalformedReason;
			readonly rawKind?: string;
	  };

export async function inspectInstalledManifest(dir: string): Promise<InstalledManifestStatus> {
	let raw: string;
	try {
		raw = await readFile(join(dir, CRUST_MANIFEST), "utf-8");
	} catch {
		return { status: "absent" };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { status: "malformed", reason: "parse-error" };
	}

	if (!isStringKeyedObject(parsed)) {
		return { status: "malformed", reason: "not-an-object" };
	}

	if (typeof parsed.name !== "string" || parsed.name.length === 0) {
		return { status: "malformed", reason: "missing-name" };
	}
	if (typeof parsed.description !== "string") {
		return { status: "malformed", reason: "missing-description" };
	}
	if (typeof parsed.version !== "string") {
		return { status: "malformed", reason: "missing-version" };
	}
	if (parsed.kind === undefined) {
		return { status: "malformed", reason: "missing-kind" };
	}
	if (parsed.kind !== "bundle" && parsed.kind !== "generated") {
		return {
			status: "malformed",
			reason: "unknown-kind",
			rawKind: typeof parsed.kind === "string" ? parsed.kind : JSON.stringify(parsed.kind),
		};
	}

	return {
		status: "ok",
		manifest: {
			name: parsed.name,
			description: parsed.description,
			version: parsed.version,
			kind: parsed.kind,
		},
	};
}

export async function readInstalledManifest(dir: string): Promise<InstalledSkillManifest | null> {
	const result = await inspectInstalledManifest(dir);
	return result.status === "ok" ? result.manifest : null;
}
