import { describe, expect, it } from "bun:test";
import { isBinary } from "./isBinary.ts";

// ────────────────────────────────────────────────────────────────────────────
// isBinary()
// ────────────────────────────────────────────────────────────────────────────

describe("isBinary", () => {
	it("returns false for a text buffer", () => {
		const buffer = Buffer.from("Hello, world!\nThis is plain text.");
		expect(isBinary(buffer)).toBe(false);
	});

	it("returns true for a buffer containing null bytes", () => {
		const buffer = Buffer.from([0x48, 0x65, 0x00, 0x6c, 0x6f]);
		expect(isBinary(buffer)).toBe(true);
	});

	it("returns false for an empty buffer", () => {
		const buffer = Buffer.alloc(0);
		expect(isBinary(buffer)).toBe(false);
	});

	it("detects a null byte at the very start", () => {
		const buffer = Buffer.from([0x00, 0x41, 0x42]);
		expect(isBinary(buffer)).toBe(true);
	});

	it("detects a null byte within the first 8192 bytes", () => {
		const buffer = Buffer.alloc(8192, 0x41); // all 'A'
		buffer[8191] = 0x00;
		expect(isBinary(buffer)).toBe(true);
	});

	it("ignores null bytes beyond the first 8192 bytes", () => {
		const buffer = Buffer.alloc(16384, 0x41); // all 'A'
		buffer[8192] = 0x00; // null byte just past the scan window
		expect(isBinary(buffer)).toBe(false);
	});

	it("returns false for a buffer of only printable ASCII", () => {
		const text = "abcdefghijklmnopqrstuvwxyz0123456789\n\t ";
		const buffer = Buffer.from(text);
		expect(isBinary(buffer)).toBe(false);
	});

	it("returns false for a buffer with UTF-8 multibyte characters", () => {
		const buffer = Buffer.from("こんにちは世界 🌍");
		expect(isBinary(buffer)).toBe(false);
	});
});
