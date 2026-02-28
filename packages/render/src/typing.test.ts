import { describe, expect, it } from "bun:test";
import { renderMarkdown } from "./renderMarkdown.ts";
import {
	applyTypingFrame,
	createTypingMarkdownRenderer,
	type TypingFrame,
} from "./typing.ts";

describe("createTypingMarkdownRenderer", () => {
	it("produces deterministic final output via appended committed frames", () => {
		const md = "# Title\n\nThis is **bold** text.\n\n- one\n- two\n";
		const renderer = createTypingMarkdownRenderer({ style: { mode: "never" } });

		let committed = "";
		for (const ch of md) {
			const frame = renderer.write(ch);
			committed += frame.append;
		}

		committed += renderer.end().append;
		expect(committed).toBe(renderMarkdown(md, { style: { mode: "never" } }));
	});

	it("keeps mutable preview while markdown tail is incomplete", () => {
		const renderer = createTypingMarkdownRenderer({ style: { mode: "never" } });
		const chunk = "**sdfsdf sdfdfd";

		let last: TypingFrame = { append: "", preview: "", done: false };
		for (const ch of chunk) {
			last = renderer.write(ch);
		}

		expect(last.append).toBe("");
		expect(last.preview).toContain("sdfsdf sdfdfd");
		expect(last.done).toBe(false);
	});

	it("clears preview on end()", () => {
		const renderer = createTypingMarkdownRenderer({ style: { mode: "never" } });
		renderer.write("partial");
		const endFrame = renderer.end();
		expect(endFrame.preview).toBe("");
		expect(endFrame.done).toBe(true);
	});
});

describe("applyTypingFrame", () => {
	it("returns cursor-clear patch when replacing existing preview", () => {
		const first = applyTypingFrame(
			{ append: "", preview: "line1\nline2", done: false },
			{ previewRows: 0, previewStartsWithNewline: false },
		);
		expect(first.delta).toBe("line1\nline2");
		expect(first.state.previewRows).toBe(2);
		expect(first.state.previewStartsWithNewline).toBe(false);

		const second = applyTypingFrame(
			{ append: "", preview: "next", done: false },
			first.state,
		);
		expect(second.delta).toBe("\r\u001b[2K\u001b[1A\r\u001b[2Knext");
		expect(second.state.previewRows).toBe(1);
		expect(second.state.previewStartsWithNewline).toBe(false);
	});

	it("restores one extra row when previous preview started with newline", () => {
		const next = applyTypingFrame(
			{ append: "", preview: "abc", done: false },
			{ previewRows: 2, previewStartsWithNewline: true },
		);
		expect(next.delta).toBe("\r\u001b[2K\u001b[1A\r\u001b[2K\u001b[1A\rabc");
	});
});
