// Source-level checks for rules a behavioral test cannot prove by absence, and for the docs
// statements a rule requires.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import * as api from "../src/oauth.ts";

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

	// One helper reads the client's variables; client.test.ts checks which ones a call reads.
	it("reads the environment only to pick a login mode, for the client's env token and profile variable, and for the D-Bus session bus", () => {
		expect(filesMatching(/process\.env|Bun\.env|import\.meta\.env/)).toEqual([
			"client.ts",
			"keyring.ts",
			"login-mode.ts",
			"types.ts",
		]);
		expect(readFileSync(join(srcDir, "client.ts"), "utf8").match(/process\.env/g)).toHaveLength(1);
		expect(readFileSync(join(srcDir, "types.ts"), "utf8").match(/process\.env/g)).toHaveLength(1);
		expect(readFileSync(join(srcDir, "keyring.ts"), "utf8").match(/process\.env\.\w+/g)).toEqual([
			"process.env.DBUS_SESSION_BUS_ADDRESS",
			"process.env.XDG_RUNTIME_DIR",
		]);
	});

	// The browser launcher, the one process auth starts, lives in @crustjs/utils (`openUrl`).
	it("never runs a keyring command, and loads the optional keyring module only on use", () => {
		expect(filesMatching(/child_process|\bspawn\(|\bexec(File)?\(|secret-tool|"security"/)).toEqual(
			[],
		);
		expect(filesMatching(/["']@napi-rs\/keyring["']/)).toEqual(["keyring.ts"]);
		const keyring = readFileSync(join(srcDir, "keyring.ts"), "utf8");
		expect(keyring).not.toMatch(/^import[^;]*@napi-rs\/keyring/m);
		expect(keyring).toMatch(/try \{\s*napi = await import\("@napi-rs\/keyring"\);\s*\} catch/);
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

describe("entry points", () => {
	it("the root exports the client surface only", async () => {
		const index = readFileSync(join(srcDir, "index.ts"), "utf8");
		const names = [...index.matchAll(/export (?:type )?\{([^}]*)\}/g)].flatMap(([, list]) =>
			list!
				.split(",")
				.map((name) => name.replace(/^\s*type\s+/, "").trim())
				.filter(Boolean),
		);
		expect(names.sort()).toEqual([
			"AuthClient",
			"AuthError",
			"AuthErrorCode",
			"AuthProfile",
			"AuthStatus",
			"AuthToken",
			"AuthWarning",
			"BrowserLoginPrompt",
			"CallbackPageView",
			"CreateAuthOptions",
			"DeviceLoginPrompt",
			"LoginOptions",
			"LogoutResult",
			"ProfileAuthClient",
			"ProfileAuthStatus",
			"ProfileClient",
			"ProfilesOptions",
			"createAuth",
		]);
		expect(index).not.toMatch(/export \*/);
		expect(Object.keys(await import("../src/index.ts")).sort()).toEqual([
			"AuthError",
			"createAuth",
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
