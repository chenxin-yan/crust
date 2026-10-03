import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { resolveColorDepth } from "./capability.ts";

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

		it('non-TTY → "none"', () => {
			expect(
				resolveColorDepth("auto", {
					isTTY: false,
					noColor: undefined,
					colorTerm: "truecolor",
					term: "xterm-256color",
				}),
			).toBe("none");
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

		it('TTY + NO_COLOR="" (empty) does NOT disable color', () => {
			expect(
				resolveColorDepth("auto", {
					isTTY: true,
					noColor: "",
					colorTerm: "truecolor",
				}),
			).toBe("truecolor");
		});

		it('TTY + COLORTERM=truecolor → "truecolor"', () => {
			expect(
				resolveColorDepth("auto", {
					isTTY: true,
					noColor: undefined,
					colorTerm: "truecolor",
				}),
			).toBe("truecolor");
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

		it('TTY + TERM=xterm-direct → "truecolor"', () => {
			expect(
				resolveColorDepth("auto", {
					isTTY: true,
					noColor: undefined,
					colorTerm: undefined,
					term: "xterm-direct",
				}),
			).toBe("truecolor");
		});

		it('TTY + TERM contains truecolor → "truecolor"', () => {
			expect(
				resolveColorDepth("auto", {
					isTTY: true,
					noColor: undefined,
					colorTerm: undefined,
					term: "xterm-truecolor",
				}),
			).toBe("truecolor");
		});

		it('TTY + TERM=xterm-256color → "256"', () => {
			expect(
				resolveColorDepth("auto", {
					isTTY: true,
					noColor: undefined,
					colorTerm: undefined,
					term: "xterm-256color",
				}),
			).toBe("256");
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

		it('TTY + TERM=dumb → "none"', () => {
			expect(
				resolveColorDepth("auto", {
					isTTY: true,
					noColor: undefined,
					colorTerm: undefined,
					term: "dumb",
				}),
			).toBe("none");
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

		it('TTY + no env vars → "16"', () => {
			expect(
				resolveColorDepth("auto", {
					isTTY: true,
					noColor: undefined,
					colorTerm: undefined,
					term: undefined,
				}),
			).toBe("16");
		});

		it("COLORTERM truecolor wins over TERM=dumb (TERM=dumb only checked when no truecolor signal)", () => {
			expect(
				resolveColorDepth("auto", {
					isTTY: true,
					noColor: undefined,
					colorTerm: "truecolor",
					term: "dumb",
				}),
			).toBe("truecolor");
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

		it("takes precedence over NO_COLOR and non-TTY", () => {
			expect(resolveColorDepth("auto", { isTTY: false, noColor: "1", forceColor: "3" })).toBe(
				"truecolor",
			);
		});

		it("unset FORCE_COLOR falls through to the normal ladder", () => {
			expect(
				resolveColorDepth("auto", { isTTY: true, noColor: undefined, forceColor: undefined }),
			).toBe("16");
		});
	});
});
