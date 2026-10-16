import { describe, expect, it } from "vite-plus/test";

import { linkCode } from "./hyperlinks.ts";
import { createStyle } from "./index.ts";

describe("hyperlinks", () => {
	it("supports the id parameter", () => {
		const pair = linkCode("https://crustjs.com/docs", { id: "docs-link" });
		expect(pair).toEqual({
			open: "\x1b]8;id=docs-link;https://crustjs.com/docs\x1b\\",
			close: "\x1b]8;;\x1b\\",
		});
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
			overrides: { isTTY: true, noColor: "1", forceColor: undefined },
		});
		expect(s.link("Crust", "https://crustjs.com")).toBe(
			"\x1b]8;;https://crustjs.com\x1b\\Crust\x1b]8;;\x1b\\",
		);
	});

	it("suppresses hyperlinks when auto mode is not a TTY", () => {
		const s = createStyle({
			mode: "auto",
			overrides: { isTTY: false, noColor: undefined, forceColor: undefined },
		});
		expect(s.link("Crust", "https://crustjs.com")).toBe("Crust");
	});
});

describe("linkCode error messages", () => {
	it("linkCode rejects URLs with spaces and echoes the URL", () => {
		// linkCode validates pairs; facade validation is covered below.
		expect(() => linkCode("https://example.com/with space")).toThrow(
			'Invalid hyperlink URL: "https://example.com/with space" must contain only printable ASCII characters without spaces.',
		);
	});

	it("linkCode rejects non-printable IDs and echoes the value", () => {
		expect(() => linkCode("https://example.com", { id: "bad\x00id" })).toThrow(
			'Invalid hyperlink id: "bad\\u0000id" must contain only printable ASCII characters.',
		);
	});

	it("linkCode rejects ID with reserved char (no echo, message names char)", () => {
		// The reserved-char message is intentionally short — the constraint
		// (`":"` and `";"` are reserved by OSC 8) is the actionable part.
		expect(() => linkCode("https://example.com", { id: "has;reserved" })).toThrow(
			'":" and ";" are reserved by the OSC 8 format.',
		);
	});
});

describe("style.link validates URLs even when hyperlinks are suppressed", () => {
	it("throws on bad URL with hyperlinks disabled (mode='never')", () => {
		const s = createStyle({ mode: "never" });
		expect(() => s.link("docs", "https://example.com/with space")).toThrow(/Invalid hyperlink URL/);
	});
});
