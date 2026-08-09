import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
	appendEditorProbe,
	measureEditorLatency,
	median,
	offsetToPosition,
	probePositions,
} from "./editor-latency.ts";
import { generateConsumerFixture } from "./type-perf-report.ts";

const repoRoot = resolve(import.meta.dir, "..");

describe("editor latency helpers", () => {
	it("converts offsets to LSP positions", () => {
		expect(offsetToPosition("ab\ncd", 0)).toEqual({ line: 0, character: 0 });
		expect(offsetToPosition("ab\ncd", 4)).toEqual({ line: 1, character: 1 });
	});

	it("computes medians for odd and even sample counts", () => {
		expect(median([3, 1, 2])).toBe(2);
		expect(median([1, 2, 3, 4])).toBe(2.5);
	});

	it("appends the probe idempotently and locates cursor positions", () => {
		const fixtureDir = mkdtempSync(join(tmpdir(), "crust-editor-probe-"));
		try {
			generateConsumerFixture(fixtureDir, join(repoRoot, "packages/core"), 10);
			const file = appendEditorProbe(fixtureDir);
			const once = readFileSync(file, "utf8");
			appendEditorProbe(fixtureDir);
			expect(readFileSync(file, "utf8")).toBe(once);

			const positions = probePositions(once);
			const lines = once.split("\n");
			expect(lines[positions.completion.line]!.slice(0, positions.completion.character)).toEndWith(
				"void flags.",
			);
			expect(lines[positions.hover.line]!.slice(positions.hover.character)).toStartWith(
				"editorProbeBuilder",
			);
		} finally {
			rmSync(fixtureDir, { recursive: true, force: true });
		}
	});
});

describe("editor latency measurement (LSP integration)", () => {
	it("measures completion/hover round-trips against the native LSP", async () => {
		const fixtureDir = mkdtempSync(join(tmpdir(), "crust-editor-latency-test-"));
		try {
			generateConsumerFixture(fixtureDir, join(repoRoot, "packages/core"), 10);
			const metrics = await measureEditorLatency(
				fixtureDir,
				join(repoRoot, "node_modules/.bin/tsc"),
				2,
			);
			for (const value of Object.values(metrics)) {
				expect(value).toBeGreaterThan(0);
				expect(Number.isFinite(value)).toBe(true);
			}
		} finally {
			rmSync(fixtureDir, { recursive: true, force: true });
		}
	}, 60_000);
});
