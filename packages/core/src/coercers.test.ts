import { describe, expect, it } from "bun:test";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { coerceJson, coercePath, coerceUrl } from "./coercers.ts";
import { CrustError } from "./errors.ts";

describe("coerceUrl", () => {
	it("returns a URL instance for a valid https URL", () => {
		const url = coerceUrl("https://example.com");
		expect(url).toBeInstanceOf(URL);
		expect(url.href).toBe("https://example.com/");
	});

	it("throws CrustError(PARSE) with a missing-protocol hint for non-URLs", () => {
		try {
			coerceUrl("not-a-url");
			expect.unreachable("coerceUrl should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			const e = err as CrustError;
			expect(e.code).toBe("PARSE");
			expect(e.message).toContain("missing protocol");
			expect(e.message).toContain("not-a-url");
		}
	});

	it("omits the missing-protocol hint when the input already has a scheme", () => {
		// `https://[bad` parses as a URL with a scheme but invalid syntax;
		// telling the user they're missing a protocol would be misleading.
		expect(() => coerceUrl("https://[bad")).toThrow(CrustError);
		expect(() => coerceUrl("https://[bad")).not.toThrow(/missing protocol/);
	});

	it("throws CrustError(PARSE) on empty input", () => {
		expect(() => coerceUrl("")).toThrow(CrustError);
	});

	it("accepts file:// URLs", () => {
		const url = coerceUrl("file:///usr/local/bin");
		expect(url.protocol).toBe("file:");
	});

	it("accepts IPv6-bracketed hosts", () => {
		const url = coerceUrl("https://[::1]:8080/");
		expect(url.hostname).toBe("[::1]");
		expect(url.port).toBe("8080");
	});
});

describe("coercePath", () => {
	it("resolves a relative path against process.cwd()", () => {
		const got = coercePath("./foo");
		expect(got).toBe(resolve(process.cwd(), "./foo"));
	});

	it("expands a leading ~ to the user's home directory", () => {
		const got = coercePath("~/foo");
		expect(got).toBe(resolve(homedir(), "foo"));
	});

	it("throws CrustError(PARSE) on empty input", () => {
		try {
			coercePath("");
			expect.unreachable("coercePath should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			const e = err as CrustError;
			expect(e.code).toBe("PARSE");
			expect(e.message).toContain("empty");
		}
	});

	it("leaves an already-absolute path absolute", () => {
		expect(coercePath("/absolute")).toBe("/absolute");
	});

	it("allows .. traversal (no sandbox)", () => {
		const got = coercePath("../sibling");
		expect(got).toBe(resolve(process.cwd(), "../sibling"));
	});
});

describe("coerceJson", () => {
	it("parses a JSON object", () => {
		expect(coerceJson('{"k":1}')).toEqual({ k: 1 });
	});

	it("throws CrustError(PARSE) on invalid JSON", () => {
		try {
			coerceJson("not json");
			expect.unreachable("coerceJson should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			const e = err as CrustError;
			expect(e.code).toBe("PARSE");
			expect(e.message).toContain("Invalid JSON");
		}
	});

	it("parses a JSON string literal", () => {
		expect(coerceJson('"hello"')).toBe("hello");
	});

	it("parses a JSON number", () => {
		expect(coerceJson("42")).toBe(42);
	});

	it("throws CrustError(PARSE) on empty input", () => {
		expect(() => coerceJson("")).toThrow(CrustError);
	});
});
