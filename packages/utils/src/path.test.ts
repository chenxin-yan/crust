/**
 * @module-tag windows
 */
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vite-plus/test";

import { expandHome, isWithin, resolvePathLike, resolveUserPath } from "./path.ts";

describe("isWithin", () => {
	it("distinguishes descendants from sibling paths with the same prefix", () => {
		const parent = join("tmp", "skills");
		expect(isWithin(parent, join(parent, "authored"))).toBe(true);
		expect(isWithin(parent, join("tmp", "skills-backup"))).toBe(false);
	});
});

describe("expandHome", () => {
	it("replaces only a leading ~ and leaves the rest for the filesystem", () => {
		expect(expandHome("~/a/../b")).toBe(`${homedir()}/a/../b`);
		expect(expandHome("a/../b")).toBe("a/../b");
	});
});

describe("resolveUserPath", () => {
	it("resolves a relative path against the working directory", () => {
		expect(resolveUserPath(join("a", "b"))).toBe(join(process.cwd(), "a", "b"));
	});

	it("expands a leading ~ before a forward slash or the platform separator", () => {
		expect(resolveUserPath("~")).toBe(homedir());
		expect(resolveUserPath("~/a")).toBe(join(homedir(), "a"));
		expect(resolveUserPath(`~${sep}a`)).toBe(join(homedir(), "a"));
	});

	it("keeps ~user and an inner ~ literal", () => {
		expect(resolveUserPath("~user/a")).toBe(join(process.cwd(), "~user", "a"));
		expect(resolveUserPath("a/~")).toBe(join(process.cwd(), "a", "~"));
	});

	it("rejects an empty path", () => {
		expect(() => resolveUserPath("")).toThrow("Path cannot be empty");
	});
});

describe("resolvePathLike", () => {
	it("resolves a relative string against the working directory and keeps ~ literal", () => {
		expect(resolvePathLike(join("a", "b"))).toBe(join(process.cwd(), "a", "b"));
		expect(resolvePathLike("~/a")).toBe(join(process.cwd(), "~", "a"));
	});

	it("converts a file: URL object and leaves a file: string literal", () => {
		const dir = resolve("a");
		expect(resolvePathLike(pathToFileURL(dir))).toBe(dir);
		expect(resolvePathLike("file:a")).toBe(join(process.cwd(), "file:a"));
	});

	it("rejects a URL that is not file: and an empty string", () => {
		expect(() => resolvePathLike(new URL("https://example.com/a"))).toThrow(
			'Path URL must use the file: protocol, got "https:".',
		);
		expect(() => resolvePathLike("")).toThrow("Path cannot be empty");
	});
});
