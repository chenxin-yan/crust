import { describe, expect, it } from "vite-plus/test";

import {
	BUN_TARGETS,
	DENO_TARGETS,
	NODE_TARGETS,
	resolveTargets,
	type TargetTable,
} from "./targets.ts";

describe("resolveTargets", () => {
	it("accepts full Bun target names directly", () => {
		for (const target of BUN_TARGETS.targets) {
			expect(resolveTargets(BUN_TARGETS, [target])[0]).toBe(target);
		}
	});

	it("rejects every short alias with canonical-name guidance and a did-you-mean hint", () => {
		for (const target of BUN_TARGETS.targets) {
			const alias = BUN_TARGETS.info[target].alias;
			expect(() => resolveTargets(BUN_TARGETS, [alias])).toThrow(
				`Unknown target "${alias}". Targets must use canonical Bun names. Did you mean "${target}"?`,
			);
			expect(() => resolveTargets(BUN_TARGETS, [alias])).toThrow(/Valid targets: bun-linux-x64/);
		}
	});

	it("throws on unknown target", () => {
		expect(() => resolveTargets(BUN_TARGETS, ["linux-arm32"])).toThrow(/Unknown target/);
	});

	it("dedupes repeated targets in input order", () => {
		expect(
			resolveTargets(BUN_TARGETS, ["bun-darwin-arm64", "bun-linux-x64", "bun-darwin-arm64"]),
		).toEqual(["bun-darwin-arm64", "bun-linux-x64"]);
	});

	it("rejects host when the table has no target for this machine", () => {
		// A table with no entries for this platform reproduces the unsupported-host case deterministically.
		const empty: TargetTable<never> = { runtime: "Bun", targets: [], info: {} };
		expect(() => resolveTargets(empty, ["host"])).toThrow(
			/No Bun target matches this machine \(\w+-\w+(-musl)?\)/,
		);
	});

	it("accepts exactly the targets supported by deno compile", () => {
		for (const target of DENO_TARGETS.targets)
			expect(resolveTargets(DENO_TARGETS, [target])[0]).toBe(target);
		expect(resolveTargets(DENO_TARGETS, undefined)).toEqual([...DENO_TARGETS.targets]);
	});

	it("guides aliases to canonical Deno target names", () => {
		for (const target of DENO_TARGETS.targets) {
			expect(() => resolveTargets(DENO_TARGETS, [DENO_TARGETS.info[target].alias])).toThrow(
				`Did you mean "${target}"?`,
			);
		}
	});

	it("rejects musl and points package aliases at the canonical Node target", () => {
		expect(() => resolveTargets(NODE_TARGETS, ["linux-x64-musl"])).toThrow(
			'Unknown Node target "linux-x64-musl". Targets must use canonical Node names.\n  Valid targets: linux-x64, linux-arm64, darwin-x64, darwin-arm64, win-x64, win-arm64',
		);
		expect(() => resolveTargets(NODE_TARGETS, ["windows-x64"])).toThrow(
			'Unknown Node target "windows-x64". Targets must use canonical Node names. Did you mean "win-x64"?',
		);
		expect(() => resolveTargets(NODE_TARGETS, ["bun-linux-x64"])).toThrow(
			'Unknown Node target "bun-linux-x64"',
		);
	});
});
