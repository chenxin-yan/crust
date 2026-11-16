// Source-level checks for rules a behavioral test cannot prove by absence, and for the docs
// statements a rule requires.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import * as api from "../src/index.ts";

const srcDir = join(import.meta.dirname, "..", "src");
const sources = readdirSync(srcDir)
	.filter((file) => file.endsWith(".ts") && !file.includes(".test"))
	.map((file) => ({ file, text: readFileSync(join(srcDir, file), "utf8") }));

const filesMatching = (pattern: RegExp) =>
	sources.filter(({ text }) => pattern.test(text)).map(({ file }) => file);

describe("library source", () => {
	it("never exits the process", () => {
		expect(filesMatching(/process\.exit/)).toEqual([]);
	});

	it("never uses Math.random", () => {
		expect(filesMatching(/Math\.random/)).toEqual([]);
	});

	it("never weakens TLS verification", () => {
		expect(
			filesMatching(/rejectUnauthorized|NODE_TLS_REJECT_UNAUTHORIZED|checkServerIdentity/),
		).toEqual([]);
	});

	it("reads the environment only to pick a login mode", () => {
		expect(filesMatching(/process\.env|Bun\.env|import\.meta\.env/)).toEqual([
			"login-mode.ts",
			"types.ts",
		]);
		expect(readFileSync(join(srcDir, "types.ts"), "utf8").match(/process\.env/g)).toHaveLength(1);
	});

	it("offers no password grant, credential form or embedded browser", () => {
		expect(
			Object.keys(api).filter((name) => /password|username|webview|embedded/i.test(name)),
		).toEqual([]);
		expect(
			filesMatching(/["']password["']|grant_type:\s*["'](?!authorization_code|refresh_token)/),
		).toEqual([]);
	});

	it("sets nonce nowhere; it is only a reserved name", () => {
		const uses = sources.flatMap(({ file, text }) =>
			text
				.split("\n")
				.filter((line) => line.includes('"nonce"'))
				.map((line) => `${file}: ${line.trim()}`),
		);
		expect(uses).toEqual(['endpoint.ts: "nonce",']);
	});

	it("never reads an id_token", () => {
		const code = sources.map(({ file, text }) => ({
			file,
			lines: text
				.split("\n")
				.filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line) && line.includes("id_token")),
		}));
		// The redaction list is the only mention outside comments.
		expect(code.filter(({ lines }) => lines.length > 0)).toEqual([
			{ file: "display.ts", lines: ['\t"id_token",'] },
		]);
	});
});

describe("auth module page", () => {
	it("tells CLIs to register as a public client", () => {
		const page = readFileSync(
			join(import.meta.dirname, "../../../apps/docs/content/docs/modules/auth.mdx"),
			"utf8",
		);
		expect(page).toContain("### Public clients");
		expect(page).toContain("as a **public client** (token endpoint authentication `none`)");
	});
});
