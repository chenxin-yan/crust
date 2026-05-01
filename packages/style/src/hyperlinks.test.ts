import { describe, expect, it } from "bun:test";
import { createStyle, link, linkCode, setGlobalColorMode } from "./index.ts";

describe("hyperlinks", () => {
	it("creates OSC 8 link pairs", () => {
		const pair = linkCode("https://crustjs.com");
		expect(pair).toEqual({
			open: "\x1b]8;;https://crustjs.com\x1b\\",
			close: "\x1b]8;;\x1b\\",
		});
	});

	it("supports the id parameter", () => {
		const pair = linkCode("https://crustjs.com/docs", { id: "docs-link" });
		expect(pair).toEqual({
			open: "\x1b]8;id=docs-link;https://crustjs.com/docs\x1b\\",
			close: "\x1b]8;;\x1b\\",
		});
	});

	it("rejects URLs containing spaces", () => {
		expect(() => linkCode("https://example.com/foo bar")).toThrow(
			/Invalid hyperlink URL/,
		);
	});

	it("wraps text in OSC 8 sequences", () => {
		const s = createStyle({ mode: "always" });
		expect(s.link("Crust docs", "https://crustjs.com")).toBe(
			"\x1b]8;;https://crustjs.com\x1b\\Crust docs\x1b]8;;\x1b\\",
		);
	});

	it("returns empty text unchanged", () => {
		expect(link("", "https://crustjs.com")).toBe("");
	});

	it("reopens the outer hyperlink after an inner hyperlink closes", () => {
		const s = createStyle({ mode: "always" });
		const nested = s.link(
			`outer ${s.link("inner", "https://crustjs.com/inner")} outer`,
			"https://crustjs.com/outer",
		);
		expect(nested).toBe(
			"\x1b]8;;https://crustjs.com/outer\x1b\\outer \x1b]8;;https://crustjs.com/inner\x1b\\inner\x1b]8;;\x1b\\\x1b]8;;https://crustjs.com/outer\x1b\\ outer\x1b]8;;\x1b\\",
		);
	});

	it("composes with ANSI styles", () => {
		const s = createStyle({ mode: "always" });
		expect(s.red(s.link("Crust", "https://crustjs.com"))).toBe(
			"\x1b[31m\x1b]8;;https://crustjs.com\x1b\\Crust\x1b]8;;\x1b\\\x1b[39m",
		);
	});
});

describe("createStyle().link", () => {
	it("emits hyperlinks in always mode", () => {
		const s = createStyle({ mode: "always" });
		expect(s.link("Crust", "https://crustjs.com")).toBe(
			"\x1b]8;;https://crustjs.com\x1b\\Crust\x1b]8;;\x1b\\",
		);
	});

	it("emits hyperlinks in auto mode even when NO_COLOR is set", () => {
		const s = createStyle({
			mode: "auto",
			overrides: { isTTY: true, noColor: "1" },
		});
		expect(s.link("Crust", "https://crustjs.com")).toBe(
			"\x1b]8;;https://crustjs.com\x1b\\Crust\x1b]8;;\x1b\\",
		);
	});

	it("suppresses hyperlinks when auto mode is not a TTY", () => {
		const s = createStyle({
			mode: "auto",
			overrides: { isTTY: false, noColor: undefined },
		});
		expect(s.link("Crust", "https://crustjs.com")).toBe("Crust");
	});

	it("suppresses hyperlinks in never mode", () => {
		const s = createStyle({ mode: "never" });
		expect(s.link("Crust", "https://crustjs.com")).toBe("Crust");
	});
});

describe("runtime link export", () => {
	it("delegates through the runtime style facade", () => {
		setGlobalColorMode("always");
		try {
			expect(link("Crust", "https://crustjs.com")).toBe(
				"\x1b]8;;https://crustjs.com\x1b\\Crust\x1b]8;;\x1b\\",
			);
		} finally {
			setGlobalColorMode(undefined);
		}
	});

	it('suppresses hyperlinks when global color mode is "never"', () => {
		// `setGlobalColorMode("never")` matches `createStyle({ mode: "never" })`:
		// no ANSI of any kind — colors, modifiers, AND hyperlinks. NO_COLOR
		// (env var) is the knob for color-only suppression.
		setGlobalColorMode("never");
		try {
			expect(link("Crust", "https://crustjs.com")).toBe("Crust");
		} finally {
			setGlobalColorMode(undefined);
		}
	});
});
