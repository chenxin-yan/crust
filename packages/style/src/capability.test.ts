import { withCapturedStdout } from "@crustjs/utils/terminal";
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

	it("treats a captured stdout as not a terminal unless overridden or forced", () => {
		const isTTY = process.stdout.isTTY;
		Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
		try {
			expect(resolveColorDepth("auto")).toBe("16");
			expect(resolveModifierCapability("auto")).toBe(true);
			withCapturedStdout(() => {
				expect(resolveColorDepth("auto")).toBe("none");
				expect(resolveModifierCapability("auto")).toBe(false);
				expect(resolveColorDepth("auto", { isTTY: true })).toBe("16");
				vi.stubEnv("FORCE_COLOR", "1");
				expect(resolveColorDepth("auto")).toBe("16");
				expect(resolveModifierCapability("auto")).toBe(true);
			});
		} finally {
			Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: isTTY });
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

		it('TTY + NO_COLOR set → "none"', () => {
			expect(
				resolveColorDepth("auto", {
					isTTY: true,
					noColor: "1",
					colorTerm: "truecolor",
				}),
			).toBe("none");
		});

		it('TTY + COLORTERM=24bit (case-insensitive) → "truecolor"', () => {
			expect(
				resolveColorDepth("auto", {
					isTTY: true,
					noColor: undefined,
					colorTerm: "24BIT",
				}),
			).toBe("truecolor");
		});

		it('TTY + TERM=screen-256color (uppercase) → "256" (case-insensitive)', () => {
			expect(
				resolveColorDepth("auto", {
					isTTY: true,
					noColor: undefined,
					colorTerm: undefined,
					term: "SCREEN-256COLOR",
				}),
			).toBe("256");
		});

		it('TTY + TERM=xterm → "16"', () => {
			expect(
				resolveColorDepth("auto", {
					isTTY: true,
					noColor: undefined,
					colorTerm: undefined,
					term: "xterm",
				}),
			).toBe("16");
		});

		it.each(["DUMB", "Dumb", "dUmB"])('TTY + TERM=%s (case-insensitive) → "none"', (term) => {
			expect(
				resolveColorDepth("auto", {
					isTTY: true,
					noColor: undefined,
					colorTerm: undefined,
					term,
				}),
			).toBe("none");
		});

		it("TERM=dumb wins over COLORTERM=truecolor and disables modifiers too", () => {
			const dumb = { isTTY: true, colorTerm: "truecolor", term: "dumb" };
			expect(resolveColorDepth("auto", dumb)).toBe("none");
			expect(resolveModifierCapability("auto", dumb)).toBe(false);
			expect(resolveModifierCapability("auto", { ...dumb, forceColor: "1" })).toBe(true);
		});

		it('TTY + TERM=xterm-24bit → "truecolor"', () => {
			expect(
				resolveColorDepth("auto", {
					isTTY: true,
					noColor: undefined,
					colorTerm: undefined,
					term: "xterm-24bit",
				}),
			).toBe("truecolor");
		});

		it('TTY + TERM=xterm-256color-direct → "truecolor" (`-direct` suffix wins over `256color`)', () => {
			expect(
				resolveColorDepth("auto", {
					isTTY: true,
					noColor: undefined,
					colorTerm: undefined,
					term: "xterm-256color-direct",
				}),
			).toBe("truecolor");
		});

		it('TTY + TERM=xterm-TRUECOLOR → "truecolor" (case-insensitive)', () => {
			expect(
				resolveColorDepth("auto", {
					isTTY: true,
					noColor: undefined,
					colorTerm: undefined,
					term: "xterm-TRUECOLOR",
				}),
			).toBe("truecolor");
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
