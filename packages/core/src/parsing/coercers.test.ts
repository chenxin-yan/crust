import { homedir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { coerceJson, coercePath, coerceUrl } from "./coercers.ts";

describe("coerceUrl", () => {
	it("throws CrustError(PARSE) naming the target, with a missing-protocol hint for non-URLs", () => {
		expect(() => coerceUrl("not-a-url", "--base")).toThrow(
			expect.objectContaining({
				code: "PARSE",
				message: "Invalid URL for --base (missing protocol — e.g. https://example.com).",
				// The native error can quote the input (Bun does), so it is not the cause.
				cause: undefined,
			}),
		);
	});

	it("omits the missing-protocol hint when the input already has a scheme", () => {
		// `https://[bad` parses as a URL with a scheme but invalid syntax;
		// telling the user they're missing a protocol would be misleading.
		expect(() => coerceUrl("https://[bad", "--base")).toThrow(
			expect.objectContaining({ code: "PARSE", message: "Invalid URL for --base." }),
		);
	});
});

describe("coercePath", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
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
});

describe("coerceJson", () => {
	it("throws CrustError(PARSE) naming the target on invalid JSON", () => {
		expect(() => coerceJson("not json", "--data")).toThrow(
			expect.objectContaining({
				code: "PARSE",
				message:
					"Invalid JSON for --data. Tip: wrap JSON in single quotes on the command line, e.g. --flag '{\"k\":1}'",
				// Newer engines quote a snippet of the input in the SyntaxError, so it is dropped.
				cause: undefined,
			}),
		);
	});
});
