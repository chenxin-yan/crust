import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as codes from "./ansiCodes.ts";
import {
	resolveColorCapability,
	resolveColorDepth,
	resolveTrueColorCapability,
} from "./capability.ts";
import {
	createStyle,
	getGlobalColorMode,
	setGlobalColorMode,
	style,
} from "./createStyle.ts";
import { bold, red } from "./index.ts";
import { composeStyles } from "./styleEngine.ts";

const originalNoColor = process.env.NO_COLOR;
const originalStdoutIsTTY = process.stdout.isTTY;

/** Restore mutable runtime env (`NO_COLOR`, `isTTY`, global mode). */
function restoreRuntimeEnv() {
	setGlobalColorMode(undefined);
	if (originalNoColor === undefined) {
		delete process.env.NO_COLOR;
	} else {
		process.env.NO_COLOR = originalNoColor;
	}
	Object.defineProperty(process.stdout, "isTTY", {
		configurable: true,
		value: originalStdoutIsTTY,
	});
}

beforeEach(restoreRuntimeEnv);
afterEach(restoreRuntimeEnv);

// ────────────────────────────────────────────────────────────────────────────
// resolveColorCapability — mode resolution
// ────────────────────────────────────────────────────────────────────────────

describe("resolveColorCapability", () => {
	describe("always mode", () => {
		it("returns true regardless of overrides", () => {
			expect(resolveColorCapability("always")).toBe(true);
		});

		it("returns true even when TTY is false", () => {
			expect(
				resolveColorCapability("always", { isTTY: false, noColor: undefined }),
			).toBe(true);
		});

		it("returns true even when NO_COLOR is set", () => {
			expect(
				resolveColorCapability("always", { isTTY: false, noColor: "1" }),
			).toBe(true);
		});
	});

	describe("never mode", () => {
		it("returns false regardless of overrides", () => {
			expect(resolveColorCapability("never")).toBe(false);
		});

		it("returns false even when TTY is true", () => {
			expect(
				resolveColorCapability("never", { isTTY: true, noColor: undefined }),
			).toBe(false);
		});

		it("returns false even when environment supports color", () => {
			expect(resolveColorCapability("never", { isTTY: true })).toBe(false);
		});
	});

	describe("auto mode", () => {
		it("returns true when TTY and NO_COLOR not set", () => {
			expect(
				resolveColorCapability("auto", { isTTY: true, noColor: undefined }),
			).toBe(true);
		});

		it("returns false when not a TTY", () => {
			expect(
				resolveColorCapability("auto", { isTTY: false, noColor: undefined }),
			).toBe(false);
		});

		it("returns false when NO_COLOR is set to non-empty string", () => {
			expect(
				resolveColorCapability("auto", { isTTY: true, noColor: "1" }),
			).toBe(false);
		});

		it("returns true when NO_COLOR is empty string (per no-color.org)", () => {
			expect(resolveColorCapability("auto", { isTTY: true, noColor: "" })).toBe(
				true,
			);
		});

		it("returns false when both non-TTY and NO_COLOR set", () => {
			expect(
				resolveColorCapability("auto", { isTTY: false, noColor: "true" }),
			).toBe(false);
		});

		it("returns false when TTY is not provided (defaults to false)", () => {
			expect(resolveColorCapability("auto", { noColor: undefined })).toBe(
				false,
			);
		});

		it("accepts term / colorTerm overrides for full env isolation", () => {
			// Regression: overrides type once excluded `term` / `colorTerm`,
			// so callers couldn't isolate from `TERM=dumb` in the ambient env.
			expect(
				resolveColorCapability("auto", {
					isTTY: true,
					noColor: undefined,
					term: "dumb",
					colorTerm: undefined,
				}),
			).toBe(false);
			expect(
				resolveColorCapability("auto", {
					isTTY: true,
					noColor: undefined,
					term: "xterm-256color",
					colorTerm: undefined,
				}),
			).toBe(true);
		});
	});
});

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

		it.each([
			"DUMB",
			"Dumb",
			"dUmB",
		])('TTY + TERM=%s (case-insensitive) → "none"', (term) => {
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
	});
});

// ────────────────────────────────────────────────────────────────────────────
// resolveTrueColorCapability — truecolor capability detection
// ────────────────────────────────────────────────────────────────────────────

describe("resolveTrueColorCapability", () => {
	describe("always mode", () => {
		it("returns true regardless of overrides", () => {
			expect(resolveTrueColorCapability("always")).toBe(true);
		});

		it("returns true even without truecolor env vars", () => {
			expect(
				resolveTrueColorCapability("always", {
					isTTY: false,
					noColor: "1",
					colorTerm: undefined,
					term: undefined,
				}),
			).toBe(true);
		});
	});

	describe("never mode", () => {
		it("returns false regardless of overrides", () => {
			expect(resolveTrueColorCapability("never")).toBe(false);
		});

		it("returns false even with truecolor env vars", () => {
			expect(
				resolveTrueColorCapability("never", {
					isTTY: true,
					noColor: undefined,
					colorTerm: "truecolor",
				}),
			).toBe(false);
		});
	});

	describe("auto mode", () => {
		it("returns true when TTY + COLORTERM=truecolor", () => {
			expect(
				resolveTrueColorCapability("auto", {
					isTTY: true,
					noColor: undefined,
					colorTerm: "truecolor",
				}),
			).toBe(true);
		});

		it("returns true when TTY + COLORTERM=24bit", () => {
			expect(
				resolveTrueColorCapability("auto", {
					isTTY: true,
					noColor: undefined,
					colorTerm: "24bit",
				}),
			).toBe(true);
		});

		it("returns true when TTY + TERM contains truecolor", () => {
			expect(
				resolveTrueColorCapability("auto", {
					isTTY: true,
					noColor: undefined,
					colorTerm: undefined,
					term: "xterm-truecolor",
				}),
			).toBe(true);
		});

		it("returns true when TTY + TERM contains 24bit", () => {
			expect(
				resolveTrueColorCapability("auto", {
					isTTY: true,
					noColor: undefined,
					colorTerm: undefined,
					term: "xterm-24bit",
				}),
			).toBe(true);
		});

		it("returns true when TTY + TERM contains -direct", () => {
			expect(
				resolveTrueColorCapability("auto", {
					isTTY: true,
					noColor: undefined,
					colorTerm: undefined,
					term: "xterm-256color-direct",
				}),
			).toBe(true);
		});

		it("returns false when not a TTY", () => {
			expect(
				resolveTrueColorCapability("auto", {
					isTTY: false,
					noColor: undefined,
					colorTerm: "truecolor",
				}),
			).toBe(false);
		});

		it("returns false when NO_COLOR is set", () => {
			expect(
				resolveTrueColorCapability("auto", {
					isTTY: true,
					noColor: "1",
					colorTerm: "truecolor",
				}),
			).toBe(false);
		});

		it("returns false when TTY but no truecolor env vars", () => {
			expect(
				resolveTrueColorCapability("auto", {
					isTTY: true,
					noColor: undefined,
					colorTerm: undefined,
					term: "xterm-256color",
				}),
			).toBe(false);
		});

		it("returns false when TTY but COLORTERM is something else", () => {
			expect(
				resolveTrueColorCapability("auto", {
					isTTY: true,
					noColor: undefined,
					colorTerm: "256color",
					term: undefined,
				}),
			).toBe(false);
		});

		it("TERM check is case-insensitive", () => {
			expect(
				resolveTrueColorCapability("auto", {
					isTTY: true,
					noColor: undefined,
					colorTerm: undefined,
					term: "xterm-TRUECOLOR",
				}),
			).toBe(true);
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
		expect(s.red.blue("text")).toBe(
			"\x1b[31m\x1b[34mtext\x1b[39m\x1b[31m\x1b[39m",
		);
	});

	it("apply() applies arbitrary pair", () => {
		expect(s.apply("text", codes.italic)).toBe("\x1b[3mtext\x1b[23m");
	});

	it("apply() works with composed styles", () => {
		const boldRed = composeStyles(codes.bold, codes.red);
		expect(s.apply("error", boldRed)).toBe(
			"\x1b[1m\x1b[31merror\x1b[39m\x1b[22m",
		);
	});

	it("handles empty string", () => {
		expect(s.bold("")).toBe("");
		expect(s.red("")).toBe("");
	});

	it("preserves nesting behavior", () => {
		const inner = s.blue("sky");
		const outer = s.red(`roses ${inner} are red`);
		expect(outer).toBe(
			"\x1b[31mroses \x1b[34msky\x1b[39m\x1b[31m are red\x1b[39m",
		);
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

	it("bold returns plain text", () => {
		expect(s.bold("text")).toBe("text");
	});

	it("dim returns plain text", () => {
		expect(s.dim("text")).toBe("text");
	});

	it("italic returns plain text", () => {
		expect(s.italic("text")).toBe("text");
	});

	it("underline returns plain text", () => {
		expect(s.underline("text")).toBe("text");
	});

	it("inverse returns plain text", () => {
		expect(s.inverse("text")).toBe("text");
	});

	it("hidden returns plain text", () => {
		expect(s.hidden("text")).toBe("text");
	});

	it("strikethrough returns plain text", () => {
		expect(s.strikethrough("text")).toBe("text");
	});

	it("foreground colors return plain text", () => {
		expect(s.black("text")).toBe("text");
		expect(s.red("text")).toBe("text");
		expect(s.green("text")).toBe("text");
		expect(s.yellow("text")).toBe("text");
		expect(s.blue("text")).toBe("text");
		expect(s.magenta("text")).toBe("text");
		expect(s.cyan("text")).toBe("text");
		expect(s.white("text")).toBe("text");
		expect(s.gray("text")).toBe("text");
	});

	it("bright foreground colors return plain text", () => {
		expect(s.brightRed("text")).toBe("text");
		expect(s.brightGreen("text")).toBe("text");
		expect(s.brightYellow("text")).toBe("text");
		expect(s.brightBlue("text")).toBe("text");
		expect(s.brightMagenta("text")).toBe("text");
		expect(s.brightCyan("text")).toBe("text");
		expect(s.brightWhite("text")).toBe("text");
	});

	it("background colors return plain text", () => {
		expect(s.bgBlack("text")).toBe("text");
		expect(s.bgRed("text")).toBe("text");
		expect(s.bgGreen("text")).toBe("text");
		expect(s.bgYellow("text")).toBe("text");
		expect(s.bgBlue("text")).toBe("text");
		expect(s.bgMagenta("text")).toBe("text");
		expect(s.bgCyan("text")).toBe("text");
		expect(s.bgWhite("text")).toBe("text");
	});

	it("bright background colors return plain text", () => {
		expect(s.bgBrightBlack("text")).toBe("text");
		expect(s.bgBrightRed("text")).toBe("text");
		expect(s.bgBrightGreen("text")).toBe("text");
		expect(s.bgBrightYellow("text")).toBe("text");
		expect(s.bgBrightBlue("text")).toBe("text");
		expect(s.bgBrightMagenta("text")).toBe("text");
		expect(s.bgBrightCyan("text")).toBe("text");
		expect(s.bgBrightWhite("text")).toBe("text");
	});

	it("apply() returns plain text for any pair", () => {
		expect(s.apply("text", codes.bold)).toBe("text");
		expect(s.apply("text", codes.red)).toBe("text");
		expect(s.apply("text", codes.bgBlue)).toBe("text");
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
			// biome-ignore lint/suspicious/noExplicitAny: testing immutability
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
		// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escape sequences
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
		expect(s.bg("text", [0, 128, 255])).toBe(
			"\x1b[48;2;0;128;255mtext\x1b[49m",
		);
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

	it("lets the global color override force colors on", () => {
		process.env.NO_COLOR = "1";
		Object.defineProperty(process.stdout, "isTTY", {
			configurable: true,
			value: false,
		});
		setGlobalColorMode("always");

		expect(getGlobalColorMode()).toBe("always");
		expect(red("text")).toBe("\x1b[31mtext\x1b[39m");
		expect(style.colorsEnabled).toBe(true);
	});

	it('global color override "never" disables all ANSI (colors and modifiers)', () => {
		// Matches `createStyle({ mode: "never" })` and the ColorMode
		// docstring. For color-only suppression (modifiers preserved), use
		// `NO_COLOR=1` in the environment with the global mode left at
		// `"auto"`.
		Object.defineProperty(process.stdout, "isTTY", {
			configurable: true,
			value: true,
		});
		setGlobalColorMode("never");

		expect(red("text")).toBe("text");
		expect(bold("text")).toBe("text");
		expect(style.enabled).toBe(false);
		expect(style.colorsEnabled).toBe(false);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Runtime style cache — TERM / COLORTERM invalidation
// ────────────────────────────────────────────────────────────────────────────
//
// Regression: the runtime cache once keyed only on (mode, isTTY, NO_COLOR),
// so changing `TERM` or `COLORTERM` between calls did not re-resolve
// `style.colorDepth`. Docs promise per-call re-resolution — these tests
// pin the contract.

describe("runtime style cache — TERM/COLORTERM invalidation", () => {
	const originalTerm = process.env.TERM;
	const originalColorTerm = process.env.COLORTERM;

	function restoreVar(
		name: "TERM" | "COLORTERM",
		original: string | undefined,
	) {
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
