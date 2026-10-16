import { Writable } from "node:stream";
import { stripVTControlCharacters } from "node:util";

import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { createPromptIO, renderPrompt } from "../testing.ts";
import { password } from "./password.ts";
import { tick, waitForScreen } from "./test-helpers.ts";

// ────────────────────────────────────────────────────────────────────────────
// Masked rendering
// ────────────────────────────────────────────────────────────────────────────

describe("password — masked rendering", () => {
	it("renders one mask character per code point", async () => {
		const prompt = renderPrompt(password, { message: "Password?" });

		await tick();
		prompt.type("😀😀");
		await tick();
		prompt.keys("left");
		await tick();

		expect(prompt.screen()).toBe("┃ Password?\n  *│*");

		prompt.keys("return");
		expect(await prompt.answer).toBe("😀😀");
	});

	it("supports custom mask character", async () => {
		const prompt = renderPrompt(password, { message: "Password?", mask: "●" });

		await tick();
		prompt.type("x");
		await tick();
		prompt.type("y");
		await tick();

		// Custom mask character should appear in output
		expect(prompt.screen()).toContain("●");

		prompt.keys("return");
		const result = await prompt.answer;
		expect(result).toBe("xy");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// No message
// ────────────────────────────────────────────────────────────────────────────

describe("password — no message", () => {
	it("renders default message before and after submission", async () => {
		const prompt = renderPrompt(password, {});

		await tick();
		expect(prompt.screen()).toContain("Enter a password");
		expect(prompt.screen()).not.toContain("undefined");

		prompt.type("s");
		await tick();
		prompt.type("e");
		await tick();
		prompt.type("c");
		await tick();
		prompt.keys("return");

		const result = await prompt.answer;
		expect(result).toBe("sec");
		expect(prompt.screen()).toContain("Enter a password");
		expect(prompt.screen()).not.toContain("undefined");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Secrecy — raw value never appears in rendered output
// ────────────────────────────────────────────────────────────────────────────
//
// Inspect every write, not just the final fake screen: a later masked repaint
// must not hide a transient leak. Validator messages here contain no secret.

describe("password — secrecy", () => {
	// None occurs in prompt chrome, validation messages, or emitted ANSI controls.
	const SECRET = "qzxvjk";

	function recordedIO() {
		const harness = createPromptIO();
		let transcript = "";
		const output = Object.assign(
			new Writable({
				write(chunk, _encoding, callback) {
					transcript += chunk.toString();
					harness.io.output.write(chunk);
					callback();
				},
			}),
			{ columns: 80, isTTY: true },
		);
		return {
			...harness,
			io: { input: harness.io.input, output },
			assertSecretAbsent() {
				for (const char of SECRET) {
					expect(transcript).not.toContain(char);
					expect(stripVTControlCharacters(transcript)).not.toContain(char);
				}
			},
		};
	}

	it("never renders the raw value while typing or after submission", async () => {
		const prompt = recordedIO();
		const answer = password({ message: "Password?" }, prompt.io);

		await tick();
		for (const ch of SECRET) {
			prompt.type(ch);
			await tick();
			prompt.assertSecretAbsent();
		}
		prompt.keys("return");
		expect(await answer).toBe(SECRET);
		expect(prompt.screen()).toBe("✓ Password? ****");
		prompt.assertSecretAbsent();
	});

	it("never renders the raw value when schema validation rejects", async () => {
		const prompt = recordedIO();
		const answer = password(
			{
				message: "Password?",
				schema: z
					.string()
					.min(12, "too short")
					.transform((value) => `parsed:${value}`),
			},
			prompt.io,
		);

		await tick();
		for (const ch of SECRET) {
			prompt.type(ch);
			await tick();
			prompt.assertSecretAbsent();
		}
		prompt.keys("return");
		// Schema validation is async; a fixed tick races the error render on slow runners.
		await waitForScreen(prompt, "too short");

		expect(prompt.screen()).toContain("too short");
		prompt.assertSecretAbsent();

		// Resolve the prompt cleanly with a long-enough valid value.
		for (let i = 0; i < SECRET.length; i++) {
			prompt.keys("backspace");
		}
		prompt.type(SECRET.repeat(2));
		prompt.keys("return");
		expect(await answer).toBe(`parsed:${SECRET.repeat(2)}`);
		expect(prompt.screen()).toBe("✓ Password? ****");
		prompt.assertSecretAbsent();
	});
});
