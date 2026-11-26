import { describe, expect, it } from "vite-plus/test";

import {
	BUN_TARGETS,
	hostTarget,
	NODE_TARGETS,
	resolveTargets,
	type TargetTable,
} from "./targets.ts";

describe("resolveTargets", () => {
	it("deduplicates target names in input order", () => {
		expect(resolveTargets(NODE_TARGETS, ["darwin-arm64", "linux-x64", "darwin-arm64"])).toEqual([
			"darwin-arm64",
			"linux-x64",
		]);
	});

	it.skipIf(hostTarget(BUN_TARGETS) === null)("defaults to this machine's target", () => {
		expect(resolveTargets(BUN_TARGETS, undefined)).toEqual([hostTarget(BUN_TARGETS)]);
		expect(resolveTargets(BUN_TARGETS, [])).toEqual([hostTarget(BUN_TARGETS)]);
	});

	it("rejects all and host like any unknown target", () => {
		for (const input of ["all", "host"]) {
			expect(() => resolveTargets(BUN_TARGETS, [input])).toThrow(
				`Unknown target "${input}". Targets must use canonical Bun names.\n  Valid targets: bun-linux-x64,`,
			);
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

	it("rejects no target names when the table has no target for this machine", () => {
		// A table with no entries for this platform reproduces the unsupported-host case deterministically.
		const empty: TargetTable<never> = { runtime: "Bun", targets: [], info: {} };
		expect(() => resolveTargets(empty, undefined)).toThrow(
			/No Bun target matches this machine \(\w+-\w+(-musl)?\)/,
		);
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
