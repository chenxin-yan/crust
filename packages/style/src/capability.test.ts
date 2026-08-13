import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { resolveColorDepth } from "./capability.ts";
import { createStyle, style } from "./createStyle.ts";
import { bold, red } from "./index.ts";
import { snapshotEnv } from "./testEnv.ts";

const restoreEnvVars = snapshotEnv("NO_COLOR", "FORCE_COLOR");
const originalStdoutIsTTY = process.stdout.isTTY;

/** Restore mutable runtime env (`NO_COLOR`, `FORCE_COLOR`, `isTTY`). */
function restoreRuntimeEnv() {
	restoreEnvVars();
	Object.defineProperty(process.stdout, "isTTY", {
		configurable: true,
		value: originalStdoutIsTTY,
	});
}

beforeEach(() => {
	restoreRuntimeEnv();
	// Tests exercise the auto ladder; ambient NO_COLOR/FORCE_COLOR (e.g. CI
	// runners) must not leak in. afterEach still restores the ambient values.
	delete process.env.NO_COLOR;
	delete process.env.FORCE_COLOR;
});
afterEach(restoreRuntimeEnv);

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

// ────────────────────────────────────────────────────────────────────────────
// createStyle — always mode
// ────────────────────────────────────────────────────────────────────────────

describe("createStyle — always mode", () => {
	const s = createStyle({ mode: "always" });

	it("reports enabled as true", () => {
		expect(s.enabled).toBe(true);
	});

	it("bold emits ANSI codes", () => {
		expect(s.bold("text")).toBe("\x1b[1mtext\x1b[22m");
	});

	it("red emits ANSI codes", () => {
		expect(s.red("text")).toBe("\x1b[31mtext\x1b[39m");
	});

	it("bgBlue emits ANSI codes", () => {
		expect(s.bgBlue("text")).toBe("\x1b[44mtext\x1b[49m");
	});

	it("supports chainable styles", () => {
		expect(s.bold.red("text")).toBe("\x1b[1m\x1b[31mtext\x1b[39m\x1b[22m");
	});

	it("last color in chain takes precedence", () => {
		expect(s.red.blue("text")).toBe("\x1b[31m\x1b[34mtext\x1b[39m\x1b[31m\x1b[39m");
	});

	it("handles empty string", () => {
		expect(s.bold("")).toBe("");
		expect(s.red("")).toBe("");
	});

	it("preserves nesting behavior", () => {
		const inner = s.blue("sky");
		const outer = s.red(`roses ${inner} are red`);
		expect(outer).toBe("\x1b[31mroses \x1b[34msky\x1b[39m\x1b[31m are red\x1b[39m");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// createStyle — never mode
// ────────────────────────────────────────────────────────────────────────────

describe("createStyle — never mode", () => {
	const s = createStyle({ mode: "never" });

	it("reports enabled as false", () => {
		expect(s.enabled).toBe(false);
	});

	it("all named style methods return plain text", () => {
		const methodNames = [
			"bold",
			"dim",
			"italic",
			"underline",
			"inverse",
			"hidden",
			"strikethrough",
			"black",
			"red",
			"green",
			"yellow",
			"blue",
			"magenta",
			"cyan",
			"white",
			"gray",
			"brightRed",
			"brightGreen",
			"brightYellow",
			"brightBlue",
			"brightMagenta",
			"brightCyan",
			"brightWhite",
			"bgBlack",
			"bgRed",
			"bgGreen",
			"bgYellow",
			"bgBlue",
			"bgMagenta",
			"bgCyan",
			"bgWhite",
			"bgBrightBlack",
			"bgBrightRed",
			"bgBrightGreen",
			"bgBrightYellow",
			"bgBrightBlue",
			"bgBrightMagenta",
			"bgBrightCyan",
			"bgBrightWhite",
		] as const;

		for (const methodName of methodNames) {
			expect(s[methodName]("text")).toBe("text");
		}
	});

	it("supports chainable styles without ANSI output", () => {
		expect(s.bold.red("text")).toBe("text");
		expect(s.bgBlue.underline("text")).toBe("text");
	});

	it("handles empty string", () => {
		expect(s.bold("")).toBe("");
		expect(s.red("")).toBe("");
	});

	it("preserves text content structurally", () => {
		const inner = s.blue("sky");
		const outer = s.red(`roses ${inner} are red`);
		expect(outer).toBe("roses sky are red");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// createStyle — auto mode with overrides
// ────────────────────────────────────────────────────────────────────────────

describe("createStyle — auto mode with overrides", () => {
	it("enables color when TTY and NO_COLOR not set", () => {
		const s = createStyle({
			mode: "auto",
			overrides: { isTTY: true, noColor: undefined },
		});
		expect(s.enabled).toBe(true);
		expect(s.bold("text")).toBe("\x1b[1mtext\x1b[22m");
	});

	it("disables all styling when not a TTY", () => {
		const s = createStyle({
			mode: "auto",
			overrides: { isTTY: false, noColor: undefined },
		});
		expect(s.enabled).toBe(false);
		expect(s.colorsEnabled).toBe(false);
		expect(s.bold("text")).toBe("text");
		expect(s.red("text")).toBe("text");
	});

	it("disables color when NO_COLOR is set", () => {
		const s = createStyle({
			mode: "auto",
			overrides: { isTTY: true, noColor: "1" },
		});
		expect(s.enabled).toBe(true);
		expect(s.colorsEnabled).toBe(false);
		expect(s.bold("text")).toBe("\x1b[1mtext\x1b[22m");
		expect(s.red("text")).toBe("text");
	});

	it("does not disable color when NO_COLOR is empty string", () => {
		const s = createStyle({
			mode: "auto",
			overrides: { isTTY: true, noColor: "" },
		});
		expect(s.enabled).toBe(true);
		expect(s.colorsEnabled).toBe(true);
		expect(s.red("text")).toBe("\x1b[31mtext\x1b[39m");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// createStyle — instance immutability
// ────────────────────────────────────────────────────────────────────────────

describe("createStyle — instance immutability", () => {
	it("returns a frozen object", () => {
		const s = createStyle({ mode: "always" });
		expect(Object.isFrozen(s)).toBe(true);
	});

	it("prevents property reassignment", () => {
		const s = createStyle({ mode: "always" });
		expect(() => {
			(s as any).bold = () => "hacked";
		}).toThrow();
	});
});

// ────────────────────────────────────────────────────────────────────────────
// createStyle — default instance
// ────────────────────────────────────────────────────────────────────────────

describe("createStyle — defaults", () => {
	it("defaults to auto mode when no options provided", () => {
		const s = createStyle();
		// We can't assert the exact value of `enabled` since it depends on
		// the runtime environment, but we can verify the instance is valid
		expect(typeof s.enabled).toBe("boolean");
		expect(typeof s.bold).toBe("function");
		expect(typeof s.red).toBe("function");
	});

	it("defaults to auto mode when empty options provided", () => {
		const s = createStyle({});
		expect(typeof s.enabled).toBe("boolean");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// createStyle — structural equivalence in never mode
// ────────────────────────────────────────────────────────────────────────────

describe("createStyle — structural equivalence", () => {
	it("never mode produces structurally identical text to always mode", () => {
		const always = createStyle({ mode: "always" });
		const never = createStyle({ mode: "never" });

		// The plain text content should be preserved
		const alwaysResult = always.bold(`hello ${always.red("world")} end`);
		const neverResult = never.bold(`hello ${never.red("world")} end`);

		// Strip ANSI from always result to compare structural equivalence
		// oxlint-disable-next-line no-control-regex -- stripping ANSI escape sequences
		const stripped = alwaysResult.replace(/\x1b\[\d+m/g, "");
		expect(stripped).toBe(neverResult);
	});

	it("preserves multiline structure in never mode", () => {
		const s = createStyle({ mode: "never" });
		expect(s.bold("line1\nline2")).toBe("line1\nline2");
	});

	it("preserves whitespace in never mode", () => {
		const s = createStyle({ mode: "never" });
		expect(s.bold("  spaced  ")).toBe("  spaced  ");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Default exported style instance
// ────────────────────────────────────────────────────────────────────────────

describe("default style instance", () => {
	it("is importable from createStyle module", async () => {
		const { style } = await import("./createStyle.ts");
		expect(typeof style.bold).toBe("function");
		expect(typeof style.red).toBe("function");
		expect(typeof style.enabled).toBe("boolean");
		expect(typeof style.colorsEnabled).toBe("boolean");
		expect(Object.isFrozen(style)).toBe(true);
	});

	it("is importable from barrel", async () => {
		const { style } = await import("./index.ts");
		expect(typeof style.bold).toBe("function");
		expect(typeof style.enabled).toBe("boolean");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// createStyle — dynamic color (truecolor) mode gating
// ────────────────────────────────────────────────────────────────────────────

describe("createStyle — dynamic colors always mode", () => {
	const s = createStyle({ mode: "always" });

	it("reports trueColorEnabled as true", () => {
		expect(s.trueColorEnabled).toBe(true);
	});

	it("fg emits truecolor ANSI codes from `[r, g, b]`", () => {
		expect(s.fg("text", [255, 0, 0])).toBe("\x1b[38;2;255;0;0mtext\x1b[39m");
	});

	it("bg emits truecolor ANSI codes from `[r, g, b]`", () => {
		expect(s.bg("text", [0, 128, 255])).toBe("\x1b[48;2;0;128;255mtext\x1b[49m");
	});

	it("fg emits truecolor ANSI codes from hex string", () => {
		expect(s.fg("text", "#ff0000")).toBe("\x1b[38;2;255;0;0mtext\x1b[39m");
	});

	it("bg emits truecolor ANSI codes from hex string", () => {
		expect(s.bg("text", "#00ff88")).toBe("\x1b[48;2;0;255;136mtext\x1b[49m");
	});

	it("handles empty string", () => {
		expect(s.fg("", [255, 0, 0])).toBe("");
		expect(s.fg("", "#fff")).toBe("");
	});
});

describe("createStyle — dynamic colors never mode", () => {
	const s = createStyle({ mode: "never" });

	it("reports trueColorEnabled as false", () => {
		expect(s.trueColorEnabled).toBe(false);
	});

	it("fg returns plain text from `[r, g, b]`", () => {
		expect(s.fg("text", [255, 0, 0])).toBe("text");
	});

	it("bg returns plain text from `[r, g, b]`", () => {
		expect(s.bg("text", [0, 128, 255])).toBe("text");
	});

	it("fg returns plain text from hex", () => {
		expect(s.fg("text", "#ff0000")).toBe("text");
	});

	it("bg returns plain text from hex", () => {
		expect(s.bg("text", "#00ff88")).toBe("text");
	});
});

describe("createStyle — dynamic colors auto mode with truecolor overrides", () => {
	it("emits truecolor when TTY + COLORTERM=truecolor", () => {
		const s = createStyle({
			mode: "auto",
			overrides: { isTTY: true, noColor: undefined, colorTerm: "truecolor" },
		});
		expect(s.trueColorEnabled).toBe(true);
		expect(s.fg("text", [255, 0, 0])).toBe("\x1b[38;2;255;0;0mtext\x1b[39m");
	});

	it("falls back to 256-color when TTY + TERM=xterm-256color (no truecolor env)", () => {
		const s = createStyle({
			mode: "auto",
			overrides: {
				isTTY: true,
				noColor: undefined,
				colorTerm: undefined,
				term: "xterm-256color",
			},
		});
		expect(s.enabled).toBe(true);
		expect(s.trueColorEnabled).toBe(false);
		expect(s.colorDepth).toBe("256");
		// fg now downgrades to ansi-256 instead of returning plain text.
		const expectedOpen = Bun.color([255, 0, 0], "ansi-256");
		expect(s.fg("text", [255, 0, 0])).toBe(`${expectedOpen}text\x1b[39m`);
	});

	it("falls back to 16-color when TTY but no truecolor / 256 env", () => {
		const s = createStyle({
			mode: "auto",
			overrides: {
				isTTY: true,
				noColor: undefined,
				colorTerm: undefined,
				term: undefined,
			},
		});
		expect(s.enabled).toBe(true);
		expect(s.trueColorEnabled).toBe(false);
		expect(s.colorDepth).toBe("16");
		// Static 16-color helpers continue to work.
		expect(s.red("text")).toBe("\x1b[31mtext\x1b[39m");
		// Dynamic colors quantize in-package to a clean compact 16-color SGR.
		// Pure red → bright red (`91`).
		expect(s.fg("text", [255, 0, 0])).toBe("\x1b[91mtext\x1b[39m");
	});

	it("disables everything when not a TTY", () => {
		const s = createStyle({
			mode: "auto",
			overrides: {
				isTTY: false,
				noColor: undefined,
				colorTerm: "truecolor",
			},
		});
		expect(s.enabled).toBe(false);
		expect(s.colorsEnabled).toBe(false);
		expect(s.trueColorEnabled).toBe(false);
		expect(s.red("text")).toBe("text");
		expect(s.bold("text")).toBe("text");
		expect(s.fg("text", [255, 0, 0])).toBe("text");
	});
});

describe("runtime-aware default exports", () => {
	it("keeps modifiers enabled when NO_COLOR is set", () => {
		process.env.NO_COLOR = "1";
		Object.defineProperty(process.stdout, "isTTY", {
			configurable: true,
			value: true,
		});

		expect(bold("text")).toBe("\x1b[1mtext\x1b[22m");
		expect(red("text")).toBe("text");
		expect(style.bold.red("text")).toBe("\x1b[1mtext\x1b[22m");
		expect(style.enabled).toBe(true);
		expect(style.colorsEnabled).toBe(false);
	});

	it("FORCE_COLOR forces colors on — overrides NO_COLOR and non-TTY", () => {
		process.env.NO_COLOR = "1";
		process.env.FORCE_COLOR = "3";
		Object.defineProperty(process.stdout, "isTTY", {
			configurable: true,
			value: false,
		});

		expect(red("text")).toBe("\x1b[31mtext\x1b[39m");
		expect(style.colorsEnabled).toBe(true);
	});

	it("FORCE_COLOR=0 forces all ANSI off — overrides TTY", () => {
		process.env.FORCE_COLOR = "0";
		Object.defineProperty(process.stdout, "isTTY", {
			configurable: true,
			value: true,
		});

		expect(red("text")).toBe("text");
		expect(bold("text")).toBe("text");
		expect(style.colorsEnabled).toBe(false);
		expect(style.enabled).toBe(false);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Runtime style — TERM / COLORTERM changes
// ────────────────────────────────────────────────────────────────────────────

describe("runtime style — TERM/COLORTERM changes", () => {
	const originalTerm = process.env.TERM;
	const originalColorTerm = process.env.COLORTERM;

	function restoreVar(name: "TERM" | "COLORTERM", original: string | undefined) {
		if (original === undefined) {
			delete process.env[name];
		} else {
			process.env[name] = original;
		}
	}

	beforeEach(() => {
		delete process.env.NO_COLOR;
		Object.defineProperty(process.stdout, "isTTY", {
			configurable: true,
			value: true,
		});
	});

	afterEach(() => {
		restoreVar("TERM", originalTerm);
		restoreVar("COLORTERM", originalColorTerm);
	});

	it("re-resolves colorDepth when TERM changes", () => {
		delete process.env.COLORTERM;
		process.env.TERM = "xterm-16color";
		expect(style.colorDepth).toBe("16");

		process.env.TERM = "xterm-256color";
		expect(style.colorDepth).toBe("256");
	});

	it("re-resolves colorDepth when COLORTERM changes", () => {
		process.env.TERM = "xterm-256color";
		delete process.env.COLORTERM;
		expect(style.colorDepth).toBe("256");

		process.env.COLORTERM = "truecolor";
		expect(style.colorDepth).toBe("truecolor");
	});

	it("re-resolves colorDepth when both TERM and COLORTERM change", () => {
		process.env.TERM = "dumb";
		delete process.env.COLORTERM;
		expect(style.colorDepth).toBe("none");

		process.env.TERM = "xterm-256color";
		process.env.COLORTERM = "truecolor";
		expect(style.colorDepth).toBe("truecolor");
	});
});
