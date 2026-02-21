import { describe, expect, it } from "bun:test";
import * as codes from "./ansiCodes.ts";
import { resolveCapability } from "./capability.ts";
import { createStyle } from "./createStyle.ts";
import { composeStyles } from "./styleEngine.ts";

// ────────────────────────────────────────────────────────────────────────────
// resolveCapability — mode resolution
// ────────────────────────────────────────────────────────────────────────────

describe("resolveCapability", () => {
	describe("always mode", () => {
		it("returns true regardless of overrides", () => {
			expect(resolveCapability("always")).toBe(true);
		});

		it("returns true even when TTY is false", () => {
			expect(
				resolveCapability("always", { isTTY: false, noColor: undefined }),
			).toBe(true);
		});

		it("returns true even when NO_COLOR is set", () => {
			expect(resolveCapability("always", { isTTY: false, noColor: "1" })).toBe(
				true,
			);
		});
	});

	describe("never mode", () => {
		it("returns false regardless of overrides", () => {
			expect(resolveCapability("never")).toBe(false);
		});

		it("returns false even when TTY is true", () => {
			expect(
				resolveCapability("never", { isTTY: true, noColor: undefined }),
			).toBe(false);
		});

		it("returns false even when environment supports color", () => {
			expect(resolveCapability("never", { isTTY: true })).toBe(false);
		});
	});

	describe("auto mode", () => {
		it("returns true when TTY and NO_COLOR not set", () => {
			expect(
				resolveCapability("auto", { isTTY: true, noColor: undefined }),
			).toBe(true);
		});

		it("returns false when not a TTY", () => {
			expect(
				resolveCapability("auto", { isTTY: false, noColor: undefined }),
			).toBe(false);
		});

		it("returns false when NO_COLOR is set to non-empty string", () => {
			expect(resolveCapability("auto", { isTTY: true, noColor: "1" })).toBe(
				false,
			);
		});

		it("returns false when NO_COLOR is empty string (per no-color.org)", () => {
			expect(resolveCapability("auto", { isTTY: true, noColor: "" })).toBe(
				false,
			);
		});

		it("returns false when both non-TTY and NO_COLOR set", () => {
			expect(resolveCapability("auto", { isTTY: false, noColor: "true" })).toBe(
				false,
			);
		});

		it("returns false when TTY is not provided (defaults to false)", () => {
			expect(resolveCapability("auto", { noColor: undefined })).toBe(false);
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

	it("disables color when not a TTY", () => {
		const s = createStyle({
			mode: "auto",
			overrides: { isTTY: false, noColor: undefined },
		});
		expect(s.enabled).toBe(false);
		expect(s.bold("text")).toBe("text");
	});

	it("disables color when NO_COLOR is set", () => {
		const s = createStyle({
			mode: "auto",
			overrides: { isTTY: true, noColor: "1" },
		});
		expect(s.enabled).toBe(false);
		expect(s.bold("text")).toBe("text");
	});

	it("disables color when NO_COLOR is empty string", () => {
		const s = createStyle({
			mode: "auto",
			overrides: { isTTY: true, noColor: "" },
		});
		expect(s.enabled).toBe(false);
		expect(s.red("text")).toBe("text");
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
		expect(Object.isFrozen(style)).toBe(true);
	});

	it("is importable from barrel", async () => {
		const { style } = await import("./index.ts");
		expect(typeof style.bold).toBe("function");
		expect(typeof style.enabled).toBe("boolean");
	});
});
