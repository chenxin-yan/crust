import { describe, expect, it } from "vite-plus/test";

import type { KeypressEvent } from "./renderer.ts";
import { handleTextEdit } from "./textEdit.ts";

function key(name: string, char = "", mods: Partial<KeypressEvent> = {}): KeypressEvent {
	return { name, char, ctrl: false, meta: false, shift: false, ...mods };
}

describe("handleTextEdit — supplementary code points", () => {
	it("inserts a non-BMP character and advances the UTF-16 cursor by its length", () => {
		expect(handleTextEdit(key("", "😀"), "ab", 1)).toEqual({ text: "a😀b", cursorPos: 3 });
	});

	it("backspace and delete remove the whole surrogate pair", () => {
		expect(handleTextEdit(key("backspace"), "a😀b", 3)).toEqual({ text: "ab", cursorPos: 1 });
		expect(handleTextEdit(key("delete"), "a😀b", 1)).toEqual({ text: "ab", cursorPos: 1 });
	});

	it("left and right step over the whole surrogate pair", () => {
		expect(handleTextEdit(key("left"), "a😀b", 3)).toEqual({ text: "a😀b", cursorPos: 1 });
		expect(handleTextEdit(key("right"), "a😀b", 1)).toEqual({ text: "a😀b", cursorPos: 3 });
	});

	it("rejects multi-code-point chunks, lone surrogates, and modified keys", () => {
		expect(handleTextEdit(key("", "ab"), "", 0)).toBeNull();
		expect(handleTextEdit(key("", "\ud83d"), "", 0)).toBeNull();
		expect(handleTextEdit(key("", "😀", { ctrl: true }), "", 0)).toBeNull();
		expect(handleTextEdit(key("", "😀", { meta: true }), "", 0)).toBeNull();
	});
});
