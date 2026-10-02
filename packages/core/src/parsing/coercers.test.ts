import { homedir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { coerceJson, coercePath, coerceUrl } from "./coercers.ts";

describe("coerceUrl", () => {
	it("returns a URL instance for a valid https URL", () => {
		const url = coerceUrl("https://example.com", "--base");
		expect(url).toBeInstanceOf(URL);
		expect(url.href).toBe("https://example.com/");
	});

	it("throws CrustError(PARSE) naming the target, with a missing-protocol hint for non-URLs", () => {
		expect(() => coerceUrl("not-a-url", "--base")).toThrow(
			expect.objectContaining({
				code: "PARSE",
				message:
					'Invalid URL for --base: "not-a-url" (missing protocol — e.g. https://example.com)',
				cause: expect.any(TypeError),
			}),
		);
	});

	it("omits the missing-protocol hint when the input already has a scheme", () => {
		// `https://[bad` parses as a URL with a scheme but invalid syntax;
		// telling the user they're missing a protocol would be misleading.
		expect(() => coerceUrl("https://[bad", "--base")).toThrow(
			expect.objectContaining({ code: "PARSE", message: 'Invalid URL for --base: "https://[bad"' }),
		);
	});

	it("accepts file:// URLs", () => {
		const url = coerceUrl("file:///usr/local/bin", "--base");
		expect(url.protocol).toBe("file:");
	});
});

describe("coercePath", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("resolves a relative path against process.cwd()", () => {
		const got = coercePath("./foo", "--out");
		expect(got).toBe(resolve(process.cwd(), "./foo"));
	});

	it("expands a leading ~ to the user's home directory", () => {
		const got = coercePath("~/foo", "--out");
		expect(got).toBe(resolve(homedir(), "foo"));
	});

	it("inserts a home directory containing $ patterns literally", () => {
		const home = resolve("/home/a$&b$'c");
		vi.stubEnv("HOME", home);
		vi.stubEnv("USERPROFILE", home);
		expect(coercePath("~/foo", "--out")).toBe(resolve(home, "foo"));
	});

	it("throws CrustError(PARSE) naming the target on empty input", () => {
		expect(() => coercePath("", "<dir>")).toThrow(
			expect.objectContaining({ code: "PARSE", message: "Path for <dir> cannot be empty" }),
		);
	});

	it("leaves an already-absolute path absolute", () => {
		expect(coercePath("/absolute", "--out")).toBe("/absolute");
	});

	it("allows .. traversal (no sandbox)", () => {
		const got = coercePath("../sibling", "--out");
		expect(got).toBe(resolve(process.cwd(), "../sibling"));
	});
});

describe("coerceJson", () => {
	it("parses a JSON object", () => {
		expect(coerceJson('{"k":1}', "--data")).toEqual({ k: 1 });
	});

	it("throws CrustError(PARSE) naming the target on invalid JSON", () => {
		expect(() => coerceJson("not json", "--data")).toThrow(
			expect.objectContaining({
				code: "PARSE",
				message: expect.stringMatching(/^Invalid JSON for --data: .+\. Tip: /),
				cause: expect.any(SyntaxError),
			}),
		);
	});
});
