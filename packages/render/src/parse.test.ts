import { describe, expect, it } from "bun:test";
import { parseMd } from "./parse.ts";

describe("parseMd", () => {
	it("should parse a simple paragraph into a root with a paragraph child", () => {
		const tree = parseMd("Hello, world!");

		expect(tree.type).toBe("root");
		expect(tree.children).toHaveLength(1);
		expect(tree.children[0]?.type).toBe("paragraph");
	});

	it("should parse a GFM table into a table node", () => {
		const input = [
			"| Name | Age |",
			"| ---- | --- |",
			"| Alice | 30 |",
			"| Bob   | 25 |",
		].join("\n");

		const tree = parseMd(input);

		expect(tree.type).toBe("root");
		expect(tree.children).toHaveLength(1);
		expect(tree.children[0]?.type).toBe("table");
	});

	it("should parse a task list into listItem nodes with checked property", () => {
		const input = ["- [x] Done", "- [ ] Not done", "- Regular item"].join("\n");

		const tree = parseMd(input);

		expect(tree.type).toBe("root");
		expect(tree.children).toHaveLength(1);

		const list = tree.children[0];
		expect(list?.type).toBe("list");

		if (list?.type === "list") {
			expect(list.children).toHaveLength(3);

			const checkedItem = list.children[0];
			expect(checkedItem?.type).toBe("listItem");
			expect(checkedItem?.checked).toBe(true);

			const uncheckedItem = list.children[1];
			expect(uncheckedItem?.type).toBe("listItem");
			expect(uncheckedItem?.checked).toBe(false);

			const regularItem = list.children[2];
			expect(regularItem?.type).toBe("listItem");
			expect(regularItem?.checked).toBeNull();
		}
	});

	it("should parse strikethrough into a delete node", () => {
		const tree = parseMd("This has ~~strikethrough~~ text.");

		expect(tree.type).toBe("root");
		expect(tree.children).toHaveLength(1);

		const paragraph = tree.children[0];
		expect(paragraph?.type).toBe("paragraph");

		if (paragraph?.type === "paragraph") {
			const deleteNode = paragraph.children.find(
				(child) => child.type === "delete",
			);
			expect(deleteNode).toBeDefined();
			expect(deleteNode?.type).toBe("delete");
		}
	});

	it("should parse autolinks correctly", () => {
		const tree = parseMd("Visit <https://example.com> for more info.");

		expect(tree.type).toBe("root");
		expect(tree.children).toHaveLength(1);

		const paragraph = tree.children[0];
		expect(paragraph?.type).toBe("paragraph");

		if (paragraph?.type === "paragraph") {
			const linkNode = paragraph.children.find(
				(child) => child.type === "link",
			);
			expect(linkNode).toBeDefined();
			if (linkNode?.type === "link") {
				expect(linkNode.url).toBe("https://example.com");
			}
		}
	});

	it("should parse headings correctly", () => {
		const tree = parseMd("# Heading 1\n\n## Heading 2");

		expect(tree.children).toHaveLength(2);
		expect(tree.children[0]?.type).toBe("heading");
		expect(tree.children[1]?.type).toBe("heading");

		const h1 = tree.children[0];
		const h2 = tree.children[1];

		if (h1?.type === "heading") {
			expect(h1.depth).toBe(1);
		}
		if (h2?.type === "heading") {
			expect(h2.depth).toBe(2);
		}
	});

	it("should parse fenced code blocks", () => {
		const input = "```typescript\nconst x = 1;\n```";

		const tree = parseMd(input);

		expect(tree.children).toHaveLength(1);
		expect(tree.children[0]?.type).toBe("code");

		const codeBlock = tree.children[0];
		if (codeBlock?.type === "code") {
			expect(codeBlock.lang).toBe("typescript");
			expect(codeBlock.value).toBe("const x = 1;");
		}
	});

	it("should parse a complex GFM document with multiple node types", () => {
		const input = [
			"# Title",
			"",
			"A paragraph with **bold** and *italic*.",
			"",
			"| Col A | Col B |",
			"| ----- | ----- |",
			"| 1     | 2     |",
			"",
			"- [x] Task done",
			"- [ ] Task pending",
			"",
			"~~removed~~",
		].join("\n");

		const tree = parseMd(input);

		const types = tree.children.map((child) => child.type);
		expect(types).toContain("heading");
		expect(types).toContain("paragraph");
		expect(types).toContain("table");
		expect(types).toContain("list");
	});
});
