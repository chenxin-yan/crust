import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { resolveColorDepth, resolveModifierCapability } from "./capability.ts";

beforeEach(() => {
	// Tests exercise the auto ladder; ambient NO_COLOR/FORCE_COLOR (e.g. CI
	// runners) must not leak in. afterEach still restores the ambient values.
	vi.stubEnv("NO_COLOR", undefined);
	vi.stubEnv("FORCE_COLOR", undefined);
	vi.stubEnv("COLORTERM", undefined);
	vi.stubEnv("TERM", undefined);
});
afterEach(() => vi.unstubAllEnvs());

// ────────────────────────────────────────────────────────────────────────────
// resolveColorDepth — depth-tier resolution
// ────────────────────────────────────────────────────────────────────────────

describe("resolveColorDepth", () => {
	it("does not read process.stdout when isTTY is overridden", () => {
		const stdout = vi.spyOn(process, "stdout", "get");
		try {
			expect(resolveColorDepth("auto", { isTTY: true })).toBe("16");
			expect(resolveColorDepth("auto", { isTTY: undefined })).toBe("none");
			expect(stdout).not.toHaveBeenCalled();
		} finally {
			stdout.mockRestore();
		}
	});

	it('`never` mode → "none"', () => {
		expect(resolveColorDepth("never")).toBe("none");
		expect(
			resolveColorDepth("never", {
				isTTY: true,
				noColor: undefined,
				colorTerm: "truecolor",
			}),
		).toBe("none");
	});

	it('`always` mode → "truecolor"', () => {
		expect(resolveColorDepth("always")).toBe("truecolor");
		expect(
			resolveColorDepth("always", {
				isTTY: false,
				noColor: "1",
				colorTerm: undefined,
				term: undefined,
			}),
		).toBe("truecolor");
	});

	describe("`auto` mode", () => {
		it("falls back to the environment for each omitted override", () => {
			vi.stubEnv("COLORTERM", "truecolor");
			expect(resolveColorDepth("auto", { isTTY: true })).toBe("truecolor");
		});

		it.each([
			["NO_COLOR set", "none", { noColor: "1", colorTerm: "truecolor" }],
			["COLORTERM=24bit (case-insensitive)", "truecolor", { colorTerm: "24BIT" }],
			["TERM=screen-256color (uppercase, case-insensitive)", "256", { term: "SCREEN-256COLOR" }],
			["TERM=xterm", "16", { term: "xterm" }],
			["TERM=DUMB (case-insensitive)", "none", { term: "DUMB" }],
			["TERM=Dumb (case-insensitive)", "none", { term: "Dumb" }],
			["TERM=dUmB (case-insensitive)", "none", { term: "dUmB" }],
			["TERM=xterm-24bit", "truecolor", { term: "xterm-24bit" }],
			[
				"TERM=xterm-256color-direct (`-direct` suffix wins over `256color`)",
				"truecolor",
				{ term: "xterm-256color-direct" },
			],
			["TERM=xterm-TRUECOLOR (case-insensitive)", "truecolor", { term: "xterm-TRUECOLOR" }],
		])("TTY + %s → %j", (_label, depth, overrides) => {
			expect(resolveColorDepth("auto", { isTTY: true, ...overrides })).toBe(depth);
		});

		it("TERM=dumb wins over COLORTERM=truecolor and disables modifiers too", () => {
			const dumb = { isTTY: true, colorTerm: "truecolor", term: "dumb" };
			expect(resolveColorDepth("auto", dumb)).toBe("none");
			expect(resolveModifierCapability("auto", dumb)).toBe(false);
			expect(resolveModifierCapability("auto", { ...dumb, forceColor: "1" })).toBe(true);
		});
	});

	describe("auto mode — FORCE_COLOR", () => {
		it("numeric levels map like chalk: 1→16, 2→256, 3→truecolor", () => {
			expect(resolveColorDepth("auto", { isTTY: false, forceColor: "1" })).toBe("16");
			expect(resolveColorDepth("auto", { isTTY: false, forceColor: "2" })).toBe("256");
			expect(resolveColorDepth("auto", { isTTY: false, forceColor: "3" })).toBe("truecolor");
		});

		it('"0" and "false" force off — even on a truecolor TTY', () => {
			const tty = { isTTY: true, colorTerm: "truecolor" };
			expect(resolveColorDepth("auto", { ...tty, forceColor: "0" })).toBe("none");
			expect(resolveColorDepth("auto", { ...tty, forceColor: "false" })).toBe("none");
		});

		it('empty string / "true" force on at the COLORTERM/TERM-detected depth', () => {
			expect(resolveColorDepth("auto", { isTTY: false, forceColor: "" })).toBe("16");
			expect(
				resolveColorDepth("auto", { isTTY: false, forceColor: "true", colorTerm: "truecolor" }),
			).toBe("truecolor");
			expect(
				resolveColorDepth("auto", { isTTY: false, forceColor: "", term: "xterm-256color" }),
			).toBe("256");
		});

		it("force-on beats TERM=dumb — forced depth detection never returns none", () => {
			expect(resolveColorDepth("auto", { isTTY: false, forceColor: "1", term: "dumb" })).toBe("16");
			expect(resolveColorDepth("auto", { isTTY: false, forceColor: "", term: "dumb" })).toBe("16");
		});
	});
});
