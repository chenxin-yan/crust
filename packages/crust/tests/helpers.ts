import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";

import { which } from "@crustjs/utils/process";
import satisfies from "semver/functions/satisfies.js";

import { BUN_TARGETS, hostTarget as resolveHostTarget } from "../src/targets.ts";

export function hostTarget() {
	return resolveHostTarget(BUN_TARGETS);
}

/**
 * Directory of a node able to build Node standalone binaries with the pinned
 * tsdown: the node on PATH. Null skips those tests; the repository's pinned
 * Node 26 qualifies. >=26 is the verified intersection of tsdown 0.23's engines
 * and executable minimum; the build itself reads both from the installed tsdown.
 */
export function seaNodeBinDir(): string | null {
	const node = which("node");
	if (!node) return null;
	const version = spawnSync(node, ["--version"], { encoding: "utf8", timeout: 10_000 }).stdout;
	return satisfies(version.trim(), ">=26.0.0") ? dirname(node) : null;
}

/**
 * The executable of the oldest `runtime` that `@crustjs/core`'s `engines` allows
 * (`">=24"` is Node 24.0.0), fetched through mise. Tests that call it carry the
 * `mise` tag, so they skip where mise is missing outside CI.
 */
export function floorRuntime(runtime: "node" | "bun"): string {
	const engines = JSON.parse(
		readFileSync(join(import.meta.dirname, "..", "..", "core", "package.json"), "utf8"),
	).engines as Record<string, string>;
	const range = engines[runtime];
	if (!range?.startsWith(">=")) throw new Error(`core's engines.${runtime} is not a ">=" range`);
	const version = [...range.slice(2).split("."), "0", "0"].slice(0, 3).join(".");
	const found = spawnSync(
		"mise",
		["exec", `${runtime}@${version}`, "--", runtime, "-e", "console.log(process.execPath)"],
		{ encoding: "utf8", timeout: 300_000 },
	);
	if (found.status !== 0) {
		throw new Error(`mise could not provide ${runtime} ${version}: ${found.stderr || found.error}`);
	}
	return found.stdout.trim();
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
