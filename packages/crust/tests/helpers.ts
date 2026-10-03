import { spawnSync } from "node:child_process";
import { delimiter, dirname } from "node:path";

import { which } from "@crustjs/utils/process";
import satisfies from "semver/functions/satisfies.js";

import { BUN_TARGETS, DENO_TARGETS, hostTarget as resolveHostTarget } from "../src/targets.ts";

export function hostTarget() {
	return resolveHostTarget(BUN_TARGETS);
}

export function hostDenoTarget() {
	return resolveHostTarget(DENO_TARGETS);
}

/**
 * Directory of a node able to build Node standalone binaries with the pinned
 * tsdown: `CRUST_TEST_SEA_NODE` (a node executable; must qualify), else the
 * node on PATH. Null skips those tests; the repository's pinned Node 24 does
 * not qualify. >=26 is the verified intersection of tsdown 0.23's engines and
 * executable minimum; the build itself reads both from the installed tsdown.
 */
export function seaNodeBinDir(): string | null {
	const explicit = process.env.CRUST_TEST_SEA_NODE;
	const node = explicit ?? which("node");
	if (!node) return null;
	const version = spawnSync(node, ["--version"], { encoding: "utf8", timeout: 10_000 }).stdout;
	if (satisfies(version.trim(), ">=26.0.0")) return dirname(node);
	if (explicit) throw new Error(`CRUST_TEST_SEA_NODE=${explicit} is not Node >=26: ${version}`);
	return null;
}

/** Runs `run` with `dir` first on PATH, where crust looks up compilers. */
export async function withPathPrefix<T>(dir: string, run: () => Promise<T>): Promise<T> {
	const path = process.env.PATH;
	process.env.PATH = `${dir}${delimiter}${path ?? ""}`;
	try {
		return await run();
	} finally {
		process.env.PATH = path;
	}
}
