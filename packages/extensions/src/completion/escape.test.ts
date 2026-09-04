import { describe, expect, it } from "bun:test";

import {
	assertSafeBinName,
	assertSafeChoiceValue,
	assertSafeIdentifier,
	bashSingleQuote,
	fishSingleQuote,
	sanitizeFreeText,
	zshArgsDescription,
	zshDescribeField,
} from "./escape.ts";

describe("assertSafeIdentifier", () => {
	it("accepts simple identifiers", () => {
		expect(assertSafeIdentifier("build", "command")).toBe("build");
		expect(assertSafeIdentifier("my-cli", "command")).toBe("my-cli");
		expect(assertSafeIdentifier("a.b.c", "command")).toBe("a.b.c");
		expect(assertSafeIdentifier("h", "short flag")).toBe("h");
	});

	it.each([
		["empty", ""],
		["leading hyphen", "-flag"],
		["leading dot", ".hidden"],
		["whitespace", "two words"],
		["single quote", "it's"],
		["double quote", 'a"b'],
		["semicolon", "a;b"],
		["dollar", "a$b"],
		["backtick", "a`b"],
		["parenthesis", "a(b"],
		["newline", "a\nb"],
		["NUL", "a\0b"],
		["bracket", "a[b"],
		["star", "a*b"],
	])("rejects %s", (_label, value) => {
		expect(() => assertSafeIdentifier(value, "name")).toThrow(/invalid name/);
	});
});

describe("assertSafeBinName", () => {
	it("accepts simple binary names", () => {
		expect(assertSafeBinName("mycli")).toBe("mycli");
		expect(assertSafeBinName("my-cli")).toBe("my-cli");
		expect(assertSafeBinName("crust.bin")).toBe("crust.bin");
	});

	it.each([
		["empty", ""],
		["dot", "."],
		["dotdot", ".."],
		["forward slash", "../pwn"],
		["forward slash mid", "foo/bar"],
		["backslash", "foo\\bar"],
		["space", "foo bar"],
		["semicolon", "foo;rm"],
		["newline", "foo\necho"],
		["NUL", "foo\0bar"],
		["leading hyphen", "-mycli"],
	])("rejects %s", (_label, value) => {
		expect(() => assertSafeBinName(value)).toThrow();
	});
});

describe("assertSafeChoiceValue", () => {
	it("accepts realistic choice values", () => {
		for (const v of ["browser", "us-east-1", "node@20", "text/plain", "1.0.0", "a:b", "a+b"]) {
			expect(assertSafeChoiceValue(v)).toBe(v);
		}
	});

	it.each([
		["whitespace", "two words"],
		["single quote", "it's"],
		["dollar", "$pwd"],
		["backtick", "`whoami`"],
		["semicolon", "a;b"],
		["pipe", "a|b"],
		["parenthesis", "a(b)"],
		["newline", "a\nb"],
		["empty", ""],
		["leading hyphen is treated as flag-ish", "-bad"],
	])("rejects %s", (_label, value) => {
		expect(() => assertSafeChoiceValue(value)).toThrow(/unsupported choice value/);
	});
});

describe("sanitizeFreeText", () => {
	it("strips controls but keeps ordinary printable text", () => {
		expect(sanitizeFreeText("hello world")).toBe("hello world");
		// Tabs are preserved (descriptions occasionally use them).
		expect(sanitizeFreeText("a\tb")).toBe("a\tb");
	});

	it("replaces NUL, CR, LF, and other C0/C1 controls with a space", () => {
		expect(sanitizeFreeText("a\nb")).toBe("a b");
		expect(sanitizeFreeText("a\rb\nc")).toBe("a b c");
		expect(sanitizeFreeText("a\0b")).toBe("a b");
		expect(sanitizeFreeText("a\x1bb")).toBe("a b"); // ESC
		expect(sanitizeFreeText("a\x7fb")).toBe("a b"); // DEL
	});
});

describe("bashSingleQuote", () => {
	it("wraps in single quotes", () => {
		expect(bashSingleQuote("hello")).toBe("'hello'");
	});

	it("close-and-reopens around embedded single quotes", () => {
		expect(bashSingleQuote("it's")).toBe("'it'\\''s'");
	});

	it('leaves $ ` \\ " alone (inside single quotes they are literal)', () => {
		expect(bashSingleQuote('a$b`c\\d"e')).toBe(`'a$b\`c\\d"e'`);
	});
});

describe("zshArgsDescription / zshDescribeField", () => {
	it("zshArgsDescription escapes [ ] : \\ ' and drops newlines", () => {
		expect(zshArgsDescription("a:b")).toBe("a\\:b");
		expect(zshArgsDescription("a[b]c")).toBe("a\\[b\\]c");
		expect(zshArgsDescription("a\\b")).toBe("a\\\\b");
		expect(zshArgsDescription("it's")).toBe("it'\\''s");
		expect(zshArgsDescription("a\nb")).toBe("a b");
	});

	it("zshDescribeField escapes the colon separator and backslash", () => {
		expect(zshDescribeField("a:b")).toBe("a\\:b");
		expect(zshDescribeField("a\\b")).toBe("a\\\\b");
		expect(zshDescribeField("a\nb")).toBe("a b");
	});
});

describe("fishSingleQuote", () => {
	it("wraps in single quotes", () => {
		expect(fishSingleQuote("hello")).toBe("'hello'");
	});

	it("escapes \\ before '", () => {
		// Order matters: backslash must be doubled BEFORE single-quote
		// escaping, otherwise `\` introduced by the apostrophe escape
		// would itself get doubled.
		expect(fishSingleQuote("it's")).toBe("'it\\'s'");
		expect(fishSingleQuote("a\\b")).toBe("'a\\\\b'");
		expect(fishSingleQuote("a\\'b")).toBe("'a\\\\\\'b'");
	});
});
