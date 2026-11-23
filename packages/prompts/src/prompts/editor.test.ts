import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { setTimeout } from "node:timers/promises";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { NonInteractiveError } from "../core/renderer.ts";
import { createPromptIO } from "../testing.ts";
import { editor } from "./editor.ts";
import { nonTTYIO } from "./test-helpers.ts";

const fixture = mkdtempSync(join(tmpdir(), "crust-editor-test-"));
const script = join(fixture, "fake-editor.mjs");
// Records the file it was given, then appends to it, fails, or waits to be stopped.
writeFileSync(
	script,
	`import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const file = process.argv[2];
writeFileSync(process.env.EDITOR_SEEN, file + "\\n" + readFileSync(file, "utf8"));
if (process.env.EDITOR_MODE === "fail") process.exit(3);
if (process.env.EDITOR_MODE === "hang") setInterval(() => {}, 1000);
else appendFileSync(file, " edited");
`,
);
const fakeEditor = `"${process.execPath}" "${script}"`;
const seenFile = join(fixture, "seen.txt");

/** The file the fake editor was given, and the text it held when the editor started. */
function seen(): { file: string; text: string } {
	const [file = "", ...text] = readFileSync(seenFile, "utf8").split("\n");
	return { file, text: text.join("\n") };
}

beforeEach(() => {
	rmSync(seenFile, { force: true });
	vi.stubEnv("EDITOR_SEEN", seenFile);
	vi.stubEnv("VISUAL", fakeEditor);
	vi.stubEnv("EDITOR", "");
});

afterEach(() => {
	vi.unstubAllEnvs();
});

afterAll(() => {
	rmSync(fixture, { recursive: true, force: true });
});

describe("editor", () => {
	it("returns the edited text of a temporary file named filename, then removes it", async () => {
		const text = await editor({ initial: "hello", filename: "notes.md" }, createPromptIO().io);

		expect(text).toBe("hello edited");
		expect(seen().text).toBe("hello");
		expect(basename(seen().file)).toBe("notes.md");
		expect(existsSync(dirname(seen().file))).toBe(false);
	});

	it("prefers $VISUAL, then $EDITOR", async () => {
		vi.stubEnv("EDITOR", "exit 7");
		expect(await editor({}, createPromptIO().io)).toBe(" edited");

		vi.stubEnv("VISUAL", "");
		vi.stubEnv("EDITOR", fakeEditor);
		expect(await editor({ initial: "x" }, createPromptIO().io)).toBe("x edited");
	});

	it("fails like any prompt without a terminal, before starting the editor", async () => {
		await expect(editor({}, nonTTYIO())).rejects.toBeInstanceOf(NonInteractiveError);
		expect(existsSync(seenFile)).toBe(false);
	});

	it("fails when neither variable names an editor", async () => {
		vi.stubEnv("VISUAL", "");
		await expect(editor({}, createPromptIO().io)).rejects.toThrow("$VISUAL or $EDITOR");
	});

	it("fails on a non-zero exit status and removes the file", async () => {
		vi.stubEnv("EDITOR_MODE", "fail");
		await expect(editor({}, createPromptIO().io)).rejects.toThrow("exited with status 3");
		expect(existsSync(dirname(seen().file))).toBe(false);
	});

	it("stops the editor and rejects with the reason when the signal aborts", async () => {
		vi.stubEnv("EDITOR_MODE", "hang");
		const controller = new AbortController();
		const reason = new Error("cancelled");
		const edited = editor({}, { ...createPromptIO().io, signal: controller.signal });
		while (!existsSync(seenFile)) await setTimeout(10);
		controller.abort(reason);

		await expect(edited).rejects.toBe(reason);
		expect(existsSync(dirname(seen().file))).toBe(false);
	});
});
